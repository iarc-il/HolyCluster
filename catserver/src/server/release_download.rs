use std::io::Seek;

use anyhow::{Context, Result, ensure};
use axum::{
    body::{Body, Bytes},
    extract::Request,
    http::{Method, StatusCode, header},
    response::{IntoResponse, Response},
};
use http_body_util::BodyExt;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

use super::state::AppState;
use crate::updater::{AppRelease, ReleaseManifest};

pub(super) fn is_artifact_path(path: &str) -> bool {
    path == "/catserver/download"
        || path.starts_with("/catserver/download/")
        || path.starts_with("/catserver/artifacts/")
}

pub(super) async fn download(state: &AppState, request: Request<Body>) -> Response {
    if !matches!(*request.method(), Method::GET | Method::HEAD) {
        return StatusCode::METHOD_NOT_ALLOWED.into_response();
    }
    // Never forward partial or conditional requests. Inspect the complete package
    // before sending any bytes, including for HEAD and attempted resumptions.
    let path = request.uri().path().to_owned();
    let head = request.method() == Method::HEAD;
    drop(request);
    let result = match tokio::time::timeout(
        std::time::Duration::from_secs(120),
        inspected_response(state, &path, head),
    )
    .await
    {
        Ok(result) => result,
        Err(error) => Err(error.into()),
    };
    match result {
        Ok(response) => response,
        Err(error) => {
            tracing::warn!(error = %error, "Release download failed validation or timed out");
            (StatusCode::BAD_GATEWAY, "Release package unavailable").into_response()
        }
    }
}

async fn upstream(state: &AppState, path: &str) -> Result<hyper::Response<hyper::body::Incoming>> {
    let request = Request::builder()
        .method(Method::GET)
        .uri(state.server_config.build_uri("http", path))
        .header(header::CACHE_CONTROL, "no-cache")
        .header(header::ACCEPT_ENCODING, "identity")
        .body(Body::empty())?;
    let response = state.http_client.request(request).await?;
    ensure!(
        response.status() == StatusCode::OK,
        "release upstream did not return a full response"
    );
    ensure!(
        response
            .headers()
            .get_all(header::CONTENT_ENCODING)
            .iter()
            .all(|value| value.as_bytes().eq_ignore_ascii_case(b"identity")),
        "unexpected release content encoding"
    );
    Ok(response)
}

async fn inspected_response(state: &AppState, path: &str, head: bool) -> Result<Response> {
    let permit = state.release_downloads.clone().acquire_owned().await?;
    let mut metadata = upstream(state, "/catserver/releases/latest").await?;
    let mut bytes = Vec::new();
    while let Some(frame) = metadata.body_mut().frame().await {
        if let Ok(data) = frame?.into_data() {
            ensure!(
                bytes.len() + data.len() <= 1024 * 1024,
                "release metadata exceeds size limit"
            );
            bytes.extend_from_slice(&data);
        }
    }
    let manifest: ReleaseManifest = serde_json::from_slice(&bytes)?;
    ensure!(manifest.schema_version == 1, "unsupported release manifest");
    let mut matches = manifest
        .releases
        .into_iter()
        .filter(|release| matches_request(path, release));
    let release = matches
        .next()
        .context("release artifact is not in the current manifest")?;
    ensure!(matches.next().is_none(), "ambiguous release artifact");
    let artifact = &release.artifact;
    let extension = match release.platform.as_str() {
        "windows" => ".msi",
        "linux" => ".AppImage",
        _ => anyhow::bail!("unsupported release platform"),
    };
    ensure!(
        release.architecture == "x86_64",
        "unsupported release architecture"
    );
    ensure!(
        artifact
            .name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte)),
        "unsafe artifact name"
    );
    ensure!(
        artifact.name == format!("{}-{}-x86_64{extension}", release.version, release.platform),
        "inconsistent artifact name"
    );
    ensure!(
        artifact.url == format!("/catserver/artifacts/{}", artifact.name),
        "inconsistent artifact location"
    );
    ensure!(
        artifact.size > 0 && artifact.size <= holy_artifact_validator::MAX_PACKAGE_SIZE,
        "artifact exceeds size limit"
    );
    ensure!(
        artifact.sha256.len() == 64 && artifact.sha256.bytes().all(|byte| byte.is_ascii_hexdigit()),
        "invalid artifact digest"
    );

    let mut response = upstream(state, &artifact.url).await?;
    // Anonymous files are removed by the OS, even if CATServer is killed.
    let mut snapshot = tempfile::tempfile()?;
    let mut output = tokio::fs::File::from_std(snapshot.try_clone()?);
    let mut total = 0u64;
    let mut hash = Sha256::new();
    while let Some(frame) = response.body_mut().frame().await {
        if let Ok(data) = frame?.into_data() {
            total = total
                .checked_add(data.len() as u64)
                .context("artifact size overflow")?;
            ensure!(total <= artifact.size, "artifact exceeds declared size");
            hash.update(&data);
            output.write_all(&data).await?;
        }
    }
    output.flush().await?;
    drop(output);
    ensure!(
        total == artifact.size && format!("{:x}", hash.finalize()) == artifact.sha256,
        "artifact does not match manifest"
    );
    let snapshot = tokio::task::spawn_blocking(move || -> Result<_> {
        holy_artifact_validator::validate_open_package(
            snapshot.try_clone()?,
            &release.platform,
            &release.version,
        )?;
        snapshot.rewind()?;
        Ok((snapshot, release, permit))
    })
    .await??;
    let (snapshot, release, permit) = snapshot;
    let body = if head {
        Body::empty()
    } else {
        let file = tokio::fs::File::from_std(snapshot);
        // The stream owns the private validated snapshot, including on disconnect.
        Body::from_stream(futures_util::stream::try_unfold(
            (file, permit),
            |(mut file, permit)| async move {
                let mut bytes = vec![0; 64 * 1024];
                let count = file.read(&mut bytes).await?;
                if count == 0 {
                    return Ok::<_, std::io::Error>(None);
                }
                bytes.truncate(count);
                Ok(Some((Bytes::from(bytes), (file, permit))))
            },
        ))
    };
    Ok(Response::builder()
        .header(header::CONTENT_TYPE, "application/octet-stream")
        .header(header::CONTENT_LENGTH, release.artifact.size)
        .header(
            header::CONTENT_DISPOSITION,
            format!("attachment; filename=\"{}\"", release.artifact.name),
        )
        .header(header::ACCEPT_RANGES, "none")
        .header("x-content-type-options", "nosniff")
        .body(body)?)
}

fn matches_request(path: &str, release: &AppRelease) -> bool {
    match path {
        "/catserver/download" => release.platform == "windows" && release.architecture == "x86_64",
        _ if path.starts_with("/catserver/download/") => {
            path == format!(
                "/catserver/download/{}/{}",
                release.platform, release.architecture
            )
        }
        _ => path == format!("/catserver/artifacts/{}", release.artifact.name),
    }
}
