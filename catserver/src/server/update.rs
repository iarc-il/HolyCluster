use axum::{Json, extract::State, http::StatusCode};

use crate::updater::UpdateStatus;

use super::state::AppState;

pub(super) async fn status(State(state): State<AppState>) -> Json<UpdateStatus> {
    Json(state.updater.status())
}

pub(super) async fn run(
    state: AppState,
    action: impl FnOnce(crate::updater::UpdateService) -> anyhow::Result<UpdateStatus> + Send + 'static,
) -> (StatusCode, Json<UpdateStatus>) {
    let updater = state.updater.clone();
    match tokio::task::spawn_blocking(move || action(updater)).await {
        Ok(Ok(status)) => (StatusCode::OK, Json(status)),
        Ok(Err(error)) => failed_status(&state.updater, error),
        Err(error) => failed_status(&state.updater, error.into()),
    }
}

pub(super) async fn install(State(state): State<AppState>) -> (StatusCode, Json<UpdateStatus>) {
    let updater = state.updater.clone();
    let result = tokio::task::spawn_blocking(move || {
        updater.download()?;
        updater.start_install()?;
        Ok::<_, anyhow::Error>(updater.status())
    })
    .await;
    match result {
        Ok(Ok(status)) => {
            let _ = state.sender.send(crate::tray_icon::UserEvent::Quit);
            (StatusCode::ACCEPTED, Json(status))
        }
        Ok(Err(error)) => failed_status(&state.updater, error),
        Err(error) => failed_status(&state.updater, error.into()),
    }
}

fn failed_status(
    updater: &crate::updater::UpdateService,
    error: anyhow::Error,
) -> (StatusCode, Json<UpdateStatus>) {
    let status = updater
        .record_failure(error.to_string())
        .unwrap_or(UpdateStatus {
            state: crate::updater::UpdateState::Failed,
            available_version: None,
            diagnostic: Some(error.to_string()),
        });
    (StatusCode::BAD_GATEWAY, Json(status))
}
