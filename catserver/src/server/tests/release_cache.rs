use axum::{
    Router,
    body::Body,
    extract::Request,
    http::{HeaderValue, StatusCode},
    response::Response,
    routing::any,
};

use super::{spawn_app, spawn_catserver};
use sha2::{Digest, Sha256};

#[tokio::test]
async fn release_proxy_overrides_upstream_cache_policy_and_conditional_requests() {
    let upstream = spawn_app(Router::new().fallback(any(|request: Request| async move {
        assert!(!request.headers().contains_key("if-none-match"));
        assert!(!request.headers().contains_key("if-modified-since"));
        assert!(!request.headers().contains_key("if-range"));
        assert_eq!(request.headers()["cache-control"], "no-cache");
        let mut response = Response::new(Body::from("fresh response"));
        for (name, value) in [
            ("cache-control", "public, max-age=31536000, immutable"),
            ("etag", "\"old-backend\""),
            ("x-catserver-upstream", "untrusted-upstream-value"),
            ("last-modified", "Sat, 10 Oct 2026 16:19:13 GMT"),
            ("expires", "Wed, 14 Oct 2027 11:05:25 GMT"),
        ] {
            response
                .headers_mut()
                .insert(name, HeaderValue::from_static(value));
        }
        if request.uri().path().ends_with("missing") {
            *response.status_mut() = StatusCode::NOT_FOUND;
        }
        response
    })))
    .await;
    let catserver = spawn_catserver(upstream.address).await;
    for path in [
        "/catserver/releases/latest",
        "/catserver/artifacts/test.msi",
        "/catserver/download",
        "/catserver/missing",
    ] {
        let response = reqwest::Client::new()
            .get(format!("http://{}{path}", catserver.address))
            .header("if-none-match", "\"old-backend\"")
            .header("if-modified-since", "Sat, 10 Oct 2026 16:19:13 GMT")
            .header("if-range", "\"old-backend\"")
            .send()
            .await
            .unwrap();
        assert_eq!(response.headers()["cache-control"], "no-store");
        assert_eq!(
            response.headers()["x-catserver-upstream"],
            format!(
                "{:x}",
                Sha256::digest(format!("http://{}/", upstream.address).as_bytes())
            )
        );
        for header in ["etag", "last-modified", "expires"] {
            assert!(!response.headers().contains_key(header));
        }
        assert_eq!(response.text().await.unwrap(), "fresh response");
    }
}

#[tokio::test]
async fn unavailable_release_upstream_also_returns_no_store() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    drop(listener);
    let catserver = spawn_catserver(address).await;
    let response = reqwest::get(format!(
        "http://{}/catserver/releases/latest",
        catserver.address
    ))
    .await
    .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
    assert_eq!(response.headers()["cache-control"], "no-store");
}
