use crate::{update_progress::SessionStore, update_status_server::StatusServer};
use std::{fs, sync::Arc, time::Duration};

#[test]
fn helper_status_is_independent_of_the_original_port_and_rejects_untrusted_requests() {
    let occupied = std::net::TcpListener::bind(("127.0.0.1", 0)).unwrap();
    let port = occupied.local_addr().unwrap().port();
    let directory =
        std::env::temp_dir().join(format!("holy-update-status-{}", uuid::Uuid::new_v4()));
    let session = SessionStore::create(
        directory.join("session.json"),
        "transaction".into(),
        port,
        format!("http://localhost:{port}"),
        "1.3.0".into(),
        100,
    )
    .unwrap();
    let server = StatusServer::start(Arc::clone(&session)).unwrap();
    let snapshot = session.snapshot();
    let endpoint = snapshot.helper_url.unwrap();
    assert_ne!(
        reqwest::Url::parse(&endpoint).unwrap().port().unwrap(),
        port
    );
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()
        .unwrap();
    assert_eq!(client.get(&endpoint).send().unwrap().status(), 403);
    assert_eq!(
        client
            .get(&endpoint)
            .header("Origin", "https://untrusted.example")
            .header("X-HolyCluster-Update", &snapshot.capability)
            .send()
            .unwrap()
            .status(),
        403
    );
    assert_eq!(
        client
            .get(&endpoint)
            .header("Origin", &snapshot.origin)
            .header("Host", "untrusted.example")
            .header("X-HolyCluster-Update", &snapshot.capability)
            .send()
            .unwrap()
            .status(),
        403
    );
    let preflight = client
        .request(reqwest::Method::OPTIONS, &endpoint)
        .header("Origin", &snapshot.origin)
        .header("Access-Control-Request-Method", "GET")
        .send()
        .unwrap();
    assert_eq!(preflight.status(), 204);
    assert_eq!(
        preflight.headers()["access-control-allow-origin"],
        snapshot.origin
    );
    session.phase("installing").unwrap();
    let response = client
        .get(&endpoint)
        .header("Origin", &snapshot.origin)
        .header("X-HolyCluster-Update", &snapshot.capability)
        .send()
        .unwrap();
    assert_eq!(response.status(), 200);
    let payload: serde_json::Value = serde_json::from_str(&response.text().unwrap()).unwrap();
    assert_eq!(payload["phase"], "installing");
    assert_eq!(payload["id"], "transaction");
    assert_eq!(client.post(&endpoint).send().unwrap().status(), 405);
    session.phase("failed").unwrap();
    let response = client
        .get(&endpoint)
        .header("Origin", &snapshot.origin)
        .header("X-HolyCluster-Update", &snapshot.capability)
        .send()
        .unwrap();
    assert_eq!(response.status(), 200);
    drop(response);
    server.await_acknowledgment(Duration::from_millis(100));
    drop(server);
    assert!(client.get(&endpoint).send().is_err());
    fs::remove_dir_all(directory).unwrap();
}
