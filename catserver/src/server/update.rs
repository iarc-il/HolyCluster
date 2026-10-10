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
    run(state, move |updater| {
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

pub(super) async fn run(
    state: AppState,
    action: impl FnOnce(crate::updater::UpdateService) -> anyhow::Result<UpdateStatus> + Send + 'static,
) -> (StatusCode, Json<UpdateResponse>) {
    let updater = state.updater.clone();
    match tokio::task::spawn_blocking(move || updater.exclusive(|| action(updater.clone()))).await {
        Ok(Ok(status)) => (StatusCode::OK, response(&state.updater, status)),
        Ok(Err(error)) => failed_status(&state.updater, error),
        Err(error) => failed_status(&state.updater, error.into()),
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
        Ok(Err(error)) => failed_status(&state.updater, error),
        Err(error) => failed_status(&state.updater, error.into()),
    }
}

pub(super) fn restart_message(session: Option<crate::update_progress::UpdateSession>) -> Message {
    Message::Text(serde_json::json!({"version": 1, "type": "update", "event": "restarting", "session": session}).to_string().into())
}

fn failed_status(
    updater: &crate::updater::UpdateService,
    error: anyhow::Error,
) -> (StatusCode, Json<UpdateResponse>) {
    if error.is::<crate::updater::UpdateBusy>() {
        return (StatusCode::CONFLICT, response(updater, updater.status()));
    }
    let error_stage = error
        .chain()
        .find_map(|cause| match cause.to_string().as_str() {
            "cannot stage update helper" => Some("stage_update_helper"),
            "cannot start detached update helper" => Some("start_update_helper"),
            _ => None,
        })
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
    tracing::error!(
        ?error,
        error_stage,
        io_error_kind,
        os_error_code,
        "Update request failed"
    );
    let status = updater
        .record_failure(error.to_string())
        .unwrap_or(UpdateStatus {
            state: UpdateState::Failed,
            available_version: None,
            diagnostic: Some(error.to_string()),
        });
    (StatusCode::BAD_GATEWAY, response(updater, status))
}
