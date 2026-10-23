use axum::{
    Json,
    extract::{State, ws::Message},
    http::{HeaderMap, StatusCode},
};

use super::state::AppState;
use crate::updater::{UpdateState, UpdateStatus};

#[derive(Default, serde::Deserialize)]
pub(super) struct UpdateOptions {
    #[serde(default)]
    dev_mode: bool,
}

#[derive(serde::Serialize)]
pub(super) struct UpdateResponse {
    #[serde(flatten)]
    status: UpdateStatus,
    session: Option<crate::update_progress::UpdateSession>,
}

fn response(updater: &crate::updater::UpdateService, status: UpdateStatus) -> Json<UpdateResponse> {
    Json(UpdateResponse {
        status,
        session: updater.session(),
    })
}

pub(super) async fn check(
    State(state): State<AppState>,
    options: Option<Json<UpdateOptions>>,
) -> (StatusCode, Json<UpdateResponse>) {
    let dev_mode = options
        .map(|Json(options)| options.dev_mode)
        .unwrap_or(false);
    run_operation(state, "check", move |updater| {
        updater.with_dev_mode(dev_mode).check()
    })
    .await
}

pub(super) async fn ready(State(state): State<AppState>) -> Json<crate::updater::LocalReadiness> {
    Json(state.updater.readiness())
}

pub(super) async fn status(State(state): State<AppState>) -> Json<UpdateResponse> {
    response(&state.updater, state.updater.status())
}

#[cfg(test)]
pub(super) async fn run(
    state: AppState,
    action: impl FnOnce(crate::updater::UpdateService) -> anyhow::Result<UpdateStatus> + Send + 'static,
) -> (StatusCode, Json<UpdateResponse>) {
    run_operation(state, "update_request", action).await
}

pub(super) async fn run_operation(
    state: AppState,
    operation: &'static str,
    action: impl FnOnce(crate::updater::UpdateService) -> anyhow::Result<UpdateStatus> + Send + 'static,
) -> (StatusCode, Json<UpdateResponse>) {
    let before = serde_json::json!({"operation": operation, "state_before": state.updater.status(), "session_before": state.updater.session(), "attempt": 1, "retry_count": 0});
    let started = std::time::Instant::now();
    let updater = state.updater.clone();
    match tokio::task::spawn_blocking(move || updater.exclusive(|| action(updater.clone()))).await {
        Ok(Ok(status)) => (StatusCode::OK, response(&state.updater, status)),
        Ok(Err(error)) => failed_status(&state.updater, error, before, started),
        Err(error) => failed_status(&state.updater, error.into(), before, started),
    }
}

pub(super) async fn install(
    State(state): State<AppState>,
    headers: HeaderMap,
    options: Option<Json<UpdateOptions>>,
) -> (StatusCode, Json<UpdateResponse>) {
    let port = state.server_config.local_port;
    let origins = [
        format!("http://127.0.0.1:{port}"),
        format!("http://localhost:{port}"),
    ];
    let hosts = [format!("127.0.0.1:{port}"), format!("localhost:{port}")];
    let origin = headers.get("origin").and_then(|value| value.to_str().ok());
    let host = headers.get("host").and_then(|value| value.to_str().ok());
    if !hosts.iter().any(|allowed| Some(allowed.as_str()) == host)
        || origin.is_some_and(|origin| !origins.iter().any(|allowed| allowed == origin))
    {
        return (
            StatusCode::FORBIDDEN,
            response(&state.updater, state.updater.status()),
        );
    }
    let origin = origin
        .map(str::to_owned)
        .unwrap_or_else(|| format!("http://{}", host.unwrap()));
    let dev_mode = options
        .map(|Json(options)| options.dev_mode)
        .unwrap_or(false);
    let updater = state
        .updater
        .clone()
        .with_dev_mode(dev_mode)
        .with_origin(origin);
    let before = serde_json::json!({"operation": "install", "state_before": updater.status(), "session_before": updater.session(), "attempt": 1, "retry_count": 0});
    let started = std::time::Instant::now();
    let result = tokio::task::spawn_blocking(move || {
        updater.exclusive(|| {
            let status = updater.download()?;
            if status.state == UpdateState::Downloaded {
                updater.start_install()?;
            }
            Ok(updater.status())
        })
    })
    .await;
    match result {
        Ok(Ok(status)) if status.state == UpdateState::Installing => {
            if let Err(error) = state
                .sender
                .send(crate::tray_icon::UserEvent::update_shutdown())
            {
                tracing::error!(?error, "Could not request catserver shutdown for update");
            }
            (StatusCode::ACCEPTED, response(&state.updater, status))
        }
        Ok(Ok(status)) => (StatusCode::OK, response(&state.updater, status)),
        Ok(Err(error)) => failed_status(&state.updater, error, before, started),
        Err(error) => failed_status(&state.updater, error.into(), before, started),
    }
}

pub(super) fn restart_message(session: Option<crate::update_progress::UpdateSession>) -> Message {
    Message::Text(serde_json::json!({"version": 1, "type": "update", "event": "restarting", "session": session}).to_string().into())
}

fn failed_status(
    updater: &crate::updater::UpdateService,
    error: anyhow::Error,
    mut evidence: serde_json::Value,
    started: std::time::Instant,
) -> (StatusCode, Json<UpdateResponse>) {
    if error.is::<crate::updater::UpdateBusy>() {
        return (StatusCode::CONFLICT, response(updater, updater.status()));
    }
    let error_stage = error
        .chain()
        .filter_map(|cause| cause.downcast_ref::<crate::updater::UpdateFailure>())
        .last()
        .map(|failure| failure.stage.name())
        .unwrap_or("update_request");
    let io_error = error
        .chain()
        .find_map(|cause| cause.downcast_ref::<std::io::Error>());
    let io_error_kind = match io_error.map(std::io::Error::kind) {
        Some(std::io::ErrorKind::NotFound) => "NotFound",
        Some(std::io::ErrorKind::PermissionDenied) => "PermissionDenied",
        Some(std::io::ErrorKind::AlreadyExists) => "AlreadyExists",
        Some(std::io::ErrorKind::WouldBlock) => "WouldBlock",
        Some(std::io::ErrorKind::InvalidInput) => "InvalidInput",
        Some(_) => "Other",
        None => "NotApplicable",
    };
    let os_error_code = io_error.and_then(std::io::Error::raw_os_error).unwrap_or(0);
    let diagnostic = crate::error_format::diagnostic(&error);
    let status = updater
        .record_failure(diagnostic.clone())
        .unwrap_or(UpdateStatus {
            state: UpdateState::Failed,
            available_version: None,
            diagnostic: Some(diagnostic),
        });
    evidence["state_after"] = serde_json::json!(status);
    evidence["session_after"] = serde_json::json!(updater.session());
    evidence["elapsed_ms"] = (started.elapsed().as_millis() as u64).into();
    tracing::error!(
        ?error,
        update_evidence = %evidence,
        error_stage,
        failure_evidence = %serde_json::json!(crate::tracing_setup::failure_evidence(&error, error_stage)),
        io_error_kind,
        os_error_code,
        "Update request failed"
    );
    (StatusCode::BAD_GATEWAY, response(updater, status))
}
