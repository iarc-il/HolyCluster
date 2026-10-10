use super::spawn_catserver;
use axum::http::StatusCode;

#[tokio::test]
async fn local_readiness_does_not_depend_on_the_remote_backend() {
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
        .await
        .unwrap();
    let unavailable = listener.local_addr().unwrap();
    drop(listener);
    let catserver = spawn_catserver(unavailable).await;
    let response = reqwest::get(format!("http://{}/api/ready", catserver.address))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let ready: serde_json::Value = serde_json::from_str(&response.text().await.unwrap()).unwrap();
    assert!(ready["version"].is_string());
    assert!(ready["instance_id"].is_string());
    assert!(ready["update_id"].is_null());
    assert_eq!(ready["verified"], false);
    let running_version = ready["version"].as_str().unwrap().to_owned();
    for (expected_version, verified) in [(running_version, true), ("999.0.0".into(), false)] {
        let reservation = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .unwrap();
        let port = reservation.local_addr().unwrap().port();
        drop(reservation);
        let (restarted, _) = super::spawn_catserver_with_restart(
            unavailable,
            Some(crate::updater::RestartContext {
                id: "transaction".into(),
                port,
                expected_version,
                state_path: Default::default(),
            }),
        )
        .await;
        let response = reqwest::get(format!("http://{}/api/ready", restarted.address))
            .await
            .unwrap();
        let resumed: serde_json::Value =
            serde_json::from_str(&response.text().await.unwrap()).unwrap();
        assert_eq!(resumed["update_id"], "transaction");
        assert_eq!(resumed["verified"], verified);
        assert_ne!(resumed["instance_id"], ready["instance_id"]);
        assert_eq!(restarted.address.port(), port);
    }
}
