use axum::Router;

use super::{spawn_app, spawn_catserver};

#[tokio::test]
async fn update_mutations_preserve_an_active_transaction() {
    use super::{
        RadioConfig, RadioManager, RotatorConfig, RotatorManager, ServerConfig, TestDir, UserEvent,
    };
    use crate::{update_progress::SessionStore, updater::UpdateService};
    let directory = TestDir::new();
    let config = RadioConfig::platform_default();
    let (sender, _) = tokio::sync::broadcast::channel::<UserEvent>(10);
    let mut state = crate::server::state::AppState::new(
        ServerConfig {
            dns: "127.0.0.1:1".into(),
            is_using_ssl: false,
            local_port: 3000,
        },
        RadioManager::new(config.clone(), config.effective_backend(false)).unwrap(),
        RotatorManager::new(RotatorConfig::unconfigured()).unwrap(),
        sender,
        None,
    )
    .unwrap();
    state.updater = UpdateService::with_data_dir(
        reqwest::Url::parse("http://127.0.0.1:1/manifest").unwrap(),
        "1.2.0",
        directory.path().to_owned(),
    )
    .unwrap();
    let store = SessionStore::create(
        directory.path().join("session.json"),
        "active".into(),
        3000,
        "http://localhost:3000".into(),
        "1.3.0".into(),
        100,
    )
    .unwrap();
    let app = Router::new()
        .route("/check", axum::routing::post(crate::server::update::check))
        .route(
            "/retry",
            axum::routing::post(|axum::extract::State(state)| {
                crate::server::update::run(state, |updater| updater.retry())
            }),
        )
        .with_state(state);
    let server = spawn_app(app).await;
    for action in ["check", "retry"] {
        let response = reqwest::Client::new()
            .post(format!("http://{}/{action}", server.address))
            .send()
            .await
            .unwrap();
        assert_eq!(response.status(), 409);
        let payload: serde_json::Value =
            serde_json::from_str(&response.text().await.unwrap()).unwrap();
        assert_eq!(payload["session"]["id"], "active");
        assert_eq!(payload["session"]["phase"], "downloading");
        assert_eq!(store.snapshot().phase, "downloading");
    }
}

#[tokio::test]
async fn update_status_is_available_on_the_loopback_server() {
    let upstream = spawn_app(Router::new()).await;
    let catserver = spawn_catserver(upstream.address).await;
    let response = reqwest::get(format!("http://{}/api/update", catserver.address))
        .await
        .unwrap();
    assert!(response.status().is_success());
    let status: serde_json::Value = serde_json::from_str(&response.text().await.unwrap()).unwrap();
    assert_eq!(status["state"], "idle");
}
