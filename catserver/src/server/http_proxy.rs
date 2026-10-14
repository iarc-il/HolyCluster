use std::convert::Infallible;

use axum::{
    body::Body,
    extract::{Request, State},
    http::{HeaderMap, HeaderName, HeaderValue, Method, StatusCode, header},
    response::{IntoResponse, Response},
};
use hyper::upgrade::OnUpgrade;
use hyper_util::rt::TokioIo;
use sha2::{Digest, Sha256};
use tower::{ServiceExt, service_fn};
use tower_http::services::ServeDir;

use super::{availability_trace::AvailabilityTrace, state::AppState};

pub(super) async fn proxy(
    State(state): State<AppState>,
    mut request: Request<Body>,
) -> Response<Body> {
    let release_request = is_release_path(request.uri().path());
    if release_request {
        // A localhost URL can outlive the upstream that originally answered it.
        for name in [
            header::IF_NONE_MATCH,
            header::IF_MODIFIED_SINCE,
            header::IF_RANGE,
        ] {
            request.headers_mut().remove(name);
        }
        request
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    }
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
            state.upstream_http_trace.available();
            if response.status() == StatusCode::SWITCHING_PROTOCOLS
                && let Some(downstream_upgrade) = downstream_upgrade
            {
                tokio::spawn(tunnel_upgrades(
                    downstream_upgrade,
                    hyper::upgrade::on(&mut response),
                    state.upstream_upgrade_trace.clone(),
                ));
                return response.map(Body::new);
            }
            remove_hop_by_hop_headers(response.headers_mut());
            if release_request {
                prevent_release_caching(response.headers_mut(), &state.server_config);
            }
            response.map(Body::new)
        }
        Err(error) => {
            state.upstream_http_trace.unavailable(&error);
            let mut response = (StatusCode::BAD_GATEWAY, Body::empty()).into_response();
            if release_request {
                prevent_release_caching(response.headers_mut(), &state.server_config);
            }
            response
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

fn is_release_path(path: &str) -> bool {
    path == "/catserver" || path.starts_with("/catserver/")
}

fn prevent_release_caching(headers: &mut HeaderMap, config: &super::ServerConfig) {
    for name in [header::ETAG, header::LAST_MODIFIED, header::EXPIRES] {
        headers.remove(name);
    }
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    // Separate browser download identities when a localhost port changes upstreams.
    // Hash the origin so credentials or operator-specific hosts are not exposed.
    let origin = config.build_uri("http", "/").to_string();
    let identity = format!("{:x}", Sha256::digest(origin.as_bytes()));
    headers.insert(
        "x-catserver-upstream",
        identity.parse().expect("SHA-256 is a valid header"),
    );
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

async fn tunnel_upgrades(
    downstream: OnUpgrade,
    upstream: OnUpgrade,
    availability: AvailabilityTrace,
) {
    let (downstream, upstream) = match tokio::try_join!(downstream, upstream) {
        Ok(upgrades) => upgrades,
        Err(error) => {
            availability.unavailable(&error);
            return;
        }
    };
    availability.available();
    let mut downstream = TokioIo::new(downstream);
    let mut upstream = TokioIo::new(upstream);
    if let Err(error) = tokio::io::copy_bidirectional(&mut downstream, &mut upstream).await {
        availability.unavailable(&error);
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
