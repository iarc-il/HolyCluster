use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{Request, WebSocketUpgrade, ws::Message},
    http::{HeaderMap, HeaderValue, Method, StatusCode, Uri, header},
    response::Response,
    routing::any,
};
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::{connect_async, tungstenite::client::IntoClientRequest};

use super::{spawn_app, spawn_catserver};

#[tokio::test]
async fn proxies_arbitrary_paths_and_queries() {
    let upstream = spawn_app(Router::new().fallback(any(|request: Request| async move {
        let path = request
            .uri()
            .path_and_query()
            .map_or("", |value| value.as_str())
            .to_owned();
        let mut response = Response::new(Body::from(path));
        *response.status_mut() = StatusCode::CREATED;
        response
            .headers_mut()
            .insert("x-upstream", HeaderValue::from_static("true"));
        response
    })))
    .await;
    let catserver = spawn_catserver(upstream.address).await;
    let response = reqwest::get(format!(
        "http://{}/future/endpoint?first=1&second=two",
        catserver.address
    ))
    .await
    .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    assert_eq!(response.headers()["x-upstream"], "true");
    assert_eq!(
        response.text().await.unwrap(),
        "/future/endpoint?first=1&second=two"
    );
}

#[tokio::test]
async fn preserves_request_method_headers_and_body() {
    let upstream = spawn_app(Router::new().fallback(any(|request: Request| async move {
        let method = request.method().clone();
        let test_header = request
            .headers()
            .get("x-test-request")
            .cloned()
            .unwrap_or_else(|| HeaderValue::from_static("missing"));
        let host = request.headers().get("host").cloned().unwrap();
        let hop_header = if request.headers().contains_key("x-request-hop") {
            "present"
        } else {
            "removed"
        };
        let body = to_bytes(request.into_body(), usize::MAX).await.unwrap();
        let mut response = Response::new(Body::from(body));
        response
            .headers_mut()
            .insert("x-received-method", method.as_str().parse().unwrap());
        response
            .headers_mut()
            .insert("x-received-request-header", test_header);
        response.headers_mut().insert("x-received-host", host);
        response
            .headers_mut()
            .insert("x-request-hop-status", HeaderValue::from_static(hop_header));
        response
            .headers_mut()
            .insert("connection", HeaderValue::from_static("x-response-hop"));
        response
            .headers_mut()
            .insert("x-response-hop", HeaderValue::from_static("removed"));
        response
    })))
    .await;
    let catserver = spawn_catserver(upstream.address).await;
    let response = reqwest::Client::new()
        .request(
            Method::PATCH,
            format!("http://{}/future/endpoint", catserver.address),
        )
        .header("x-test-request", "preserved")
        .header("connection", "x-request-hop")
        .header("x-request-hop", "removed")
        .body("request body")
        .send()
        .await
        .unwrap();
    assert_eq!(response.headers()["x-received-method"], "PATCH");
    assert_eq!(response.headers()["x-received-request-header"], "preserved");
    assert_eq!(
        response.headers()["x-received-host"],
        upstream.address.to_string()
    );
    assert_eq!(response.headers()["x-request-hop-status"], "removed");
    assert!(!response.headers().contains_key("x-response-hop"));
    assert_eq!(response.text().await.unwrap(), "request body");
}

#[tokio::test]
async fn returns_bad_gateway_when_upstream_is_unavailable() {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let upstream = listener.local_addr().unwrap();
    drop(listener);
    let catserver = spawn_catserver(upstream).await;
    assert_eq!(
        reqwest::get(format!("http://{}/unavailable", catserver.address))
            .await
            .unwrap()
            .status(),
        StatusCode::BAD_GATEWAY
    );
}

#[tokio::test]
async fn tunnels_arbitrary_websocket_upgrades() {
    let upstream = spawn_app(Router::new().fallback(any(
        |websocket: WebSocketUpgrade, uri: Uri, headers: HeaderMap| async move {
            websocket
                .protocols(["test-protocol"])
                .on_upgrade(move |mut socket| async move {
                    socket
                        .send(Message::Text(
                            format!(
                                "{} {}",
                                uri.path_and_query().unwrap(),
                                headers["x-test-request"].to_str().unwrap()
                            )
                            .into(),
                        ))
                        .await
                        .unwrap();
                    while let Some(Ok(message)) = socket.recv().await {
                        socket.send(message).await.unwrap();
                    }
                })
        },
    )))
    .await;
    let catserver = spawn_catserver(upstream.address).await;
    for path in [
        "/future_socket?token=abc",
        "/submit_spot?token=abc",
        "/spots_ws?token=abc",
    ] {
        let mut request = format!("ws://{}{path}", catserver.address)
            .into_client_request()
            .unwrap();
        request
            .headers_mut()
            .insert("x-test-request", HeaderValue::from_static("preserved"));
        request.headers_mut().insert(
            header::SEC_WEBSOCKET_PROTOCOL,
            HeaderValue::from_static("test-protocol"),
        );
        let (mut socket, response) = connect_async(request).await.unwrap();
        assert_eq!(
            response.headers()[header::SEC_WEBSOCKET_PROTOCOL],
            "test-protocol"
        );
        assert_eq!(
            socket.next().await.unwrap().unwrap().into_text().unwrap(),
            format!("{path} preserved")
        );
        socket
            .send(tokio_tungstenite::tungstenite::Message::Binary(
                vec![1, 2, 3].into(),
            ))
            .await
            .unwrap();
        assert_eq!(
            socket.next().await.unwrap().unwrap().into_data(),
            vec![1, 2, 3]
        );
        socket.close(None).await.unwrap();
    }
}
