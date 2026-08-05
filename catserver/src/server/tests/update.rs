use axum::Router;

use super::{spawn_app, spawn_catserver};

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
