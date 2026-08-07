use std::convert::Infallible;

use axum::{
    body::Body,
    extract::{Request, State},
    http::{HeaderMap, HeaderName, Method, StatusCode, header},
    response::{IntoResponse, Response},
};
use hyper::upgrade::OnUpgrade;
use hyper_util::rt::TokioIo;
use tower::{ServiceExt, service_fn};
use tower_http::services::ServeDir;

use super::state::AppState;

pub(super) async fn proxy(
    State(state): State<AppState>,
    mut request: Request<Body>,
) -> Response<Body> {
    let uri = state.server_config.build_uri(
        "http",
        request
            .uri()
            .path_and_query()
            .map_or("", |path| path.as_str()),
    );
    let is_upgrade = is_upgrade_request(&request);
    let downstream_upgrade = is_upgrade.then(|| hyper::upgrade::on(&mut request));
    *request.uri_mut() = uri;
    if !is_upgrade {
        remove_hop_by_hop_headers(request.headers_mut());
    }
    request.headers_mut().remove(header::HOST);
    match state.http_client.request(request).await {
        Ok(mut response) => {
            if response.status() == StatusCode::SWITCHING_PROTOCOLS
                && let Some(downstream_upgrade) = downstream_upgrade
            {
                tokio::spawn(tunnel_upgrades(
                    downstream_upgrade,
                    hyper::upgrade::on(&mut response),
                ));
                return response.map(Body::new);
            }
            remove_hop_by_hop_headers(response.headers_mut());
            response.map(Body::new)
        }
        Err(error) => {
            tracing::error!(?error, "Upstream request failed");
            (StatusCode::BAD_GATEWAY, Body::empty()).into_response()
        }
    }
}

pub(super) async fn local_ui(
    State(state): State<AppState>,
    request: Request<Body>,
) -> Response<Body> {
    if matches!(*request.method(), Method::GET | Method::HEAD) && !is_upgrade_request(&request) {
        let ui_dir = state.ui_dir.clone().expect("local UI directory is missing");
        let fallback_state = state.clone();
        let service = ServeDir::new(ui_dir).fallback(service_fn(move |request| {
            let state = fallback_state.clone();
            async move { Ok::<_, Infallible>(proxy(State(state), request).await) }
        }));
        return match service.oneshot(request).await {
            Ok(response) => response.map(Body::new),
            Err(error) => match error {},
        };
    }
    proxy(State(state), request).await
}

fn is_upgrade_request(request: &Request<Body>) -> bool {
    request.headers().contains_key(header::UPGRADE)
        && request
            .headers()
            .get_all(header::CONNECTION)
            .iter()
            .filter_map(|value| value.to_str().ok())
            .flat_map(|value| value.split(','))
            .any(|value| value.trim().eq_ignore_ascii_case("upgrade"))
}

async fn tunnel_upgrades(downstream: OnUpgrade, upstream: OnUpgrade) {
    let (downstream, upstream) = match tokio::try_join!(downstream, upstream) {
        Ok(upgrades) => upgrades,
        Err(error) => {
            tracing::error!(?error, "Failed to establish proxy upgrade");
            return;
        }
    };
    let mut downstream = TokioIo::new(downstream);
    let mut upstream = TokioIo::new(upstream);
    if let Err(error) = tokio::io::copy_bidirectional(&mut downstream, &mut upstream).await {
        tracing::error!(?error, "Upgraded proxy connection failed");
    }
}

fn remove_hop_by_hop_headers(headers: &mut HeaderMap) {
    let connection_headers = headers
        .get_all(header::CONNECTION)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .filter_map(|name| HeaderName::from_bytes(name.trim().as_bytes()).ok())
        .collect::<Vec<_>>();
    for name in connection_headers {
        headers.remove(name);
    }
    for name in [
        header::CONNECTION,
        HeaderName::from_static("keep-alive"),
        header::PROXY_AUTHENTICATE,
        header::PROXY_AUTHORIZATION,
        header::TE,
        header::TRAILER,
        header::TRANSFER_ENCODING,
        header::UPGRADE,
    ] {
        headers.remove(name);
    }
}
