use axum::{
    Router, body::Body, extract::Request, http::StatusCode, response::Response, routing::any,
};
use sha2::{Digest, Sha256};

use super::{TestServer, spawn_app, spawn_catserver};

const MSI: &[u8] =
    include_bytes!("../../../../backend/shared/artifact-validator/fixtures/valid-windows.msi");
const APPIMAGE: &[u8] =
    include_bytes!("../../../../backend/shared/artifact-validator/fixtures/valid-linux.AppImage");

async fn backend(
    platform: &str,
    bytes: &'static [u8],
    version: &str,
    mutate: fn(&mut serde_json::Value),
) -> (TestServer, String) {
    backend_response(platform, bytes, version, mutate, |_| {}).await
}

async fn backend_response(
    platform: &str,
    bytes: &'static [u8],
    version: &str,
    mutate: fn(&mut serde_json::Value),
    modify: fn(&mut Response<Body>),
) -> (TestServer, String) {
    let extension = if platform == "windows" {
        ".msi"
    } else {
        ".AppImage"
    };
    let name = format!("{version}-{platform}-x86_64{extension}");
    let location = format!("/catserver/artifacts/{name}");
    let mut manifest = serde_json::json!({
        "schema_version": 1,
        "releases": [{
            "version": version, "platform": platform, "architecture": "x86_64",
            "artifact": {"name": name, "location": location, "size": bytes.len(), "sha256": format!("{:x}", Sha256::digest(bytes))}
        }]
    });
    mutate(&mut manifest);
    let metadata = manifest.to_string();
    let artifact_path = location.clone();
    let server = spawn_app(Router::new().fallback(any(move |request: Request| {
        let metadata = metadata.clone();
        let artifact_path = artifact_path.clone();
        async move {
            assert_eq!(request.method(), "GET");
            assert_eq!(request.headers()["cache-control"], "no-cache");
            for header in ["range", "if-range", "if-none-match", "if-modified-since"] {
                assert!(!request.headers().contains_key(header));
            }
            let body = match request.uri().path() {
                "/catserver/releases/latest" => Body::from(metadata),
                path if path == artifact_path => Body::from(bytes),
                _ => {
                    return Response::builder()
                        .status(StatusCode::NOT_FOUND)
                        .body(Body::empty())
                        .unwrap();
                }
            };
            let mut response = Response::builder()
                .header("cache-control", "public, max-age=31536000, immutable")
                .header("etag", "\"stale\"")
                .header("content-type", "application/x-msi")
                .header("content-disposition", "attachment; filename=untrusted.msi")
                .body(body)
                .unwrap();
            if request.uri().path() == artifact_path {
                modify(&mut response);
            }
            response
        }
    })))
    .await;
    (server, location)
}

#[tokio::test]
async fn valid_packages_are_inspected_before_serving_including_aliases_range_and_head() {
    for (platform, bytes) in [("windows", MSI), ("linux", APPIMAGE)] {
        let (upstream, location) = backend(platform, bytes, "catserver-v1.2.3", |_| {}).await;
        let catserver = spawn_catserver(upstream.address).await;
        let client = reqwest::Client::new();
        let alias = format!("/catserver/download/{platform}/x86_64");
        let mut paths = vec![location, alias];
        if platform == "windows" {
            paths.push("/catserver/download".into());
        }
        for path in paths {
            let response = client
                .get(format!("http://{}{path}", catserver.address))
                .header("range", "bytes=0-7")
                .header("if-range", "\"stale\"")
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(response.headers()["cache-control"], "no-store");
            assert_eq!(response.headers()["accept-ranges"], "none");
            assert!(!response.headers().contains_key("etag"));
            assert!(
                !response.headers()["content-disposition"]
                    .to_str()
                    .unwrap()
                    .contains("untrusted")
            );
            assert_eq!(response.bytes().await.unwrap().as_ref(), bytes);
            let response = client
                .head(format!("http://{}{path}", catserver.address))
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), StatusCode::OK);
            assert_eq!(
                response.headers()["content-length"],
                bytes.len().to_string()
            );
            assert!(response.bytes().await.unwrap().is_empty());
        }
    }
}

#[tokio::test]
async fn platform_swaps_are_rejected_even_with_matching_size_and_checksum() {
    for (platform, bytes) in [("windows", APPIMAGE), ("linux", MSI)] {
        let (upstream, location) = backend(platform, bytes, "catserver-v1.2.3", |_| {}).await;
        let catserver = spawn_catserver(upstream.address).await;
        let response = reqwest::get(format!("http://{}{location}", catserver.address))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        assert_eq!(response.headers()["cache-control"], "no-store");
        assert_eq!(
            response.text().await.unwrap(),
            "Release package unavailable"
        );
    }
}

#[tokio::test]
async fn wrong_package_version_is_rejected_before_any_artifact_bytes() {
    for (platform, bytes) in [("windows", MSI), ("linux", APPIMAGE)] {
        let (upstream, location) = backend(platform, bytes, "catserver-v1.2.4", |_| {}).await;
        let catserver = spawn_catserver(upstream.address).await;
        let response = reqwest::get(format!("http://{}{location}", catserver.address))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        assert_eq!(
            response.text().await.unwrap(),
            "Release package unavailable"
        );
    }
}

#[tokio::test]
async fn partial_redirected_encoded_and_truncated_upstream_packages_are_rejected() {
    let changes: [fn(&mut Response<Body>); 4] = [
        |response| *response.status_mut() = StatusCode::PARTIAL_CONTENT,
        |response| {
            *response.status_mut() = StatusCode::FOUND;
            response.headers_mut().insert(
                "location",
                "https://example.invalid/installer".parse().unwrap(),
            );
        },
        |response| {
            response
                .headers_mut()
                .insert("content-encoding", "gzip".parse().unwrap());
        },
        |response| *response.body_mut() = Body::from(&MSI[..MSI.len() - 1]),
    ];
    for change in changes {
        let (upstream, location) =
            backend_response("windows", MSI, "catserver-v1.2.3", |_| {}, change).await;
        let catserver = spawn_catserver(upstream.address).await;
        let response = reqwest::get(format!("http://{}{location}", catserver.address))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        assert_eq!(
            response.text().await.unwrap(),
            "Release package unavailable"
        );
    }
}

#[tokio::test]
async fn invalid_hash_and_oversized_declarations_fail_closed() {
    let changes: [fn(&mut serde_json::Value); 2] = [
        |manifest| manifest["releases"][0]["artifact"]["sha256"] = "0".repeat(64).into(),
        |manifest| {
            manifest["releases"][0]["artifact"]["size"] =
                (holy_artifact_validator::MAX_PACKAGE_SIZE + 1).into()
        },
    ];
    for change in changes {
        let (upstream, location) = backend("windows", MSI, "catserver-v1.2.3", change).await;
        let catserver = spawn_catserver(upstream.address).await;
        let response = reqwest::get(format!("http://{}{location}", catserver.address))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_GATEWAY);
        assert_eq!(response.headers()["cache-control"], "no-store");
    }
}
