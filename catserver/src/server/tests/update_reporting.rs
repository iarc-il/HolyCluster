use std::sync::{Arc, Mutex};

use axum::{
    Router, body::Body, extract::Request, http::StatusCode, response::Response, routing::any,
};
use sentry::{Client, ClientOptions};
use sha2::{Digest, Sha256};
use tracing_subscriber::layer::SubscriberExt;

use super::{
    RadioConfig, RadioManager, RotatorConfig, RotatorManager, ServerConfig, TestDir, spawn_app,
};
use crate::{
    tracing_setup::{sentry_event_filter, sentry_options},
    updater::UpdateService,
};

#[derive(Default)]
struct LocalTransport(Mutex<Vec<Vec<u8>>>);

impl sentry::Transport for LocalTransport {
    fn send_envelope(&self, envelope: sentry::Envelope) {
        let mut bytes = Vec::new();
        envelope.to_writer(&mut bytes).unwrap();
        self.0.lock().unwrap().push(bytes);
    }
}

async fn exercise_failure(case: &'static str) {
    let directory = TestDir::new();
    let bytes = b"not a package";
    let interrupted = if case == "artifact_body" {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let task = tokio::spawn(async move {
            tokio::time::timeout(std::time::Duration::from_secs(3), async move {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                while !request.ends_with(b"\r\n\r\n") {
                    assert!(request.len() < 4096);
                    request.push(socket.read_u8().await.unwrap());
                }
                socket
                    .write_all(
                        b"HTTP/1.1 200 OK\r\nContent-Length: 13\r\nConnection: close\r\n\r\nnot",
                    )
                    .await
                    .unwrap();
                socket.shutdown().await.unwrap();
            })
            .await
            .unwrap();
        });
        Some((format!("http://{address}/artifact"), task))
    } else {
        None
    };
    let refused = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let refused_url = format!("http://{}/request", refused.local_addr().unwrap());
    let artifact_url = if case == "artifact_connect" {
        refused_url.clone()
    } else {
        interrupted
            .as_ref()
            .map(|(url, _)| url.clone())
            .unwrap_or_else(|| "/artifact".into())
    };
    let backend = spawn_app(Router::new().fallback(any(move |request: Request| {
        let artifact_url = artifact_url.clone();
        async move {
            if request.uri().path() == "/manifest" {
                if matches!(case, "manifest_http" | "failure_status_write") {
                    return Response::builder().status(503).header("x-request-id", "manifest-trace").header("set-cookie", "first=value").header("set-cookie", "second=value").body(Body::from("x".repeat(20 * 1024))).unwrap();
                }
                if case == "manifest_decode" {
                    return Response::new(Body::from("not JSON"));
                }
                let digest = if case == "artifact_hash" { "0".repeat(64) } else { format!("{:x}", Sha256::digest(bytes)) };
                let manifest = serde_json::json!({"schema_version": 1, "releases": [{
                    "version": "catserver-v9.0.0", "platform": if cfg!(windows) { "windows" } else { "linux" },
                    "architecture": if case == "manifest_acceptance" { "unsupported" } else { "x86_64" },
                    "artifact": {"url": artifact_url, "name": if cfg!(windows) { "update.msi" } else { "update.AppImage" }, "size": bytes.len(), "sha256": digest}
                }]});
                Response::new(Body::from(manifest.to_string()))
            } else {
                assert_eq!(request.uri().path(), "/artifact");
                if case == "artifact_http" {
                    Response::builder().status(503).header("x-request-id", "artifact-trace").header("x-native", axum::http::HeaderValue::from_bytes(&[0xff]).unwrap()).body(Body::from(vec![0xff; 20 * 1024])).unwrap()
                } else {
                    Response::new(Body::from(bytes.as_slice()))
                }
            }
        }
    }))).await;
    let config = RadioConfig::platform_default();
    let radio = RadioManager::new(config.clone(), config.effective_backend()).unwrap();
    let (sender, _) = tokio::sync::broadcast::channel(10);
    let manifest_url = if case == "manifest_connect" {
        refused_url
    } else {
        format!("http://{}/manifest", backend.address)
    };
    let updater = UpdateService::with_data_dir(
        reqwest::Url::parse(&manifest_url).unwrap(),
        "1.2.0",
        directory.path().to_owned(),
    )
    .unwrap();
    #[cfg(windows)]
    if matches!(case, "helper_staging" | "helper_handoff") {
        std::fs::write(
            directory.path().join("state.json"),
            r#"{"state":"downloaded","available_version":"9.0.0","diagnostic":null}"#,
        )
        .unwrap();
        if case == "helper_staging" {
            std::fs::write(directory.path().join("helpers"), b"blocked").unwrap();
        }
    }
    if case == "staging_create" {
        std::fs::write(directory.path().join("staging"), b"blocked").unwrap();
    }
    if matches!(case, "failure_status_write" | "status_write") {
        std::fs::create_dir(directory.path().join("state.json")).unwrap();
    }
    if case == "staging_file_create" {
        std::fs::create_dir_all(directory.path().join(if cfg!(windows) {
            "staging/9.0.0-windows-msi.part"
        } else {
            "staging/9.0.0-linux-appimage.part"
        }))
        .unwrap();
    }
    let rotator = RotatorManager::new(RotatorConfig::unconfigured()).unwrap();
    use crate::server::{
        availability_trace::AvailabilityTrace, rotator_configuration::RotatorConfiguration,
    };
    // Do not reconcile the user's persisted update state in this test.
    let state = crate::server::state::AppState {
        server_config: ServerConfig {
            dns: backend.address.to_string(),
            is_using_ssl: false,
            local_port: 3000,
        },
        radio_configuration: crate::server::radio_configuration::production(radio.clone()),
        rotator_configuration: RotatorConfiguration::new(rotator.clone()),
        radio: radio.clone(),
        rotator,
        updater,
        sender,
        release_downloads: Arc::new(tokio::sync::Semaphore::new(2)),
        http_client: hyper_util::client::legacy::Client::builder(
            hyper_util::rt::TokioExecutor::new(),
        )
        .build(hyper_tls::HttpsConnector::new()),
        upstream_http_trace: AvailabilityTrace::new("http"),
        upstream_websocket_trace: AvailabilityTrace::new("websocket"),
        upstream_upgrade_trace: AvailabilityTrace::new("proxy-upgrade"),
    };
    #[cfg(windows)]
    let missing_helper = directory.path().join("missing-helper.exe");
    let persisted_updater = state.updater.clone();
    let app = Router::new()
        .route(
            "/operation",
            axum::routing::post(move |axum::extract::State(state)| {
                #[cfg(windows)]
                let missing_helper = missing_helper.clone();
                async move {
                    crate::server::update::run(state, move |updater| {
                        #[cfg(windows)]
                        if case == "helper_launch" {
                            return crate::updater::spawn_update_helper(
                                &missing_helper,
                                &missing_helper.with_extension("json"),
                            )
                            .map(|_| updater.status());
                        }
                        #[cfg(windows)]
                        if matches!(case, "helper_staging" | "helper_handoff") {
                            // The test executable rejects --apply-update before any installer can run.
                            updater.start_install()?;
                            return Ok(updater.status());
                        }
                        if matches!(
                            case,
                            "manifest_http"
                                | "failure_status_write"
                                | "status_write"
                                | "manifest_connect"
                                | "manifest_decode"
                                | "manifest_acceptance"
                        ) {
                            updater.check()
                        } else {
                            updater.download()
                        }
                    })
                    .await
                }
            }),
        )
        .route("/status", axum::routing::get(crate::server::update::status))
        .with_state(state);
    let server = spawn_app(app).await;
    drop(refused);
    // Allow the helper's two ten-second handoff waits to finish.
    let timeout = if case == "helper_handoff" { 30 } else { 5 };
    let response = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(timeout))
        .build()
        .unwrap()
        .post(format!("http://{}/operation", server.address))
        .send()
        .await
        .unwrap_or_else(|error| panic!("{case}: {error:?}"));
    assert_eq!(response.status(), StatusCode::BAD_GATEWAY, "{case}");
    let payload: serde_json::Value = serde_json::from_str(&response.text().await.unwrap()).unwrap();
    assert_eq!(payload["state"], "failed", "{case}");
    if matches!(
        case,
        "manifest_http" | "artifact_http" | "failure_status_write"
    ) {
        let diagnostic = payload["diagnostic"].as_str().unwrap();
        assert!(diagnostic.contains("503"));
        assert_eq!(diagnostic.matches("HTTP status server error").count(), 1);
        assert!(
            !diagnostic.contains("update HTTP operation failed"),
            "{diagnostic}"
        );
        if case != "failure_status_write" {
            assert_eq!(
                persisted_updater.status().diagnostic.as_deref(),
                Some(diagnostic)
            );
            let stored: serde_json::Value = serde_json::from_slice(
                &std::fs::read(directory.path().join("state.json")).unwrap(),
            )
            .unwrap();
            assert_eq!(stored["diagnostic"], diagnostic);
            let status = reqwest::get(format!("http://{}/status", server.address))
                .await
                .unwrap()
                .text()
                .await
                .unwrap();
            let status: serde_json::Value = serde_json::from_str(&status).unwrap();
            assert_eq!(status["diagnostic"], diagnostic);
        }
    }
    radio.shutdown().await.unwrap();
    if let Some((_, task)) = interrupted {
        task.await.unwrap();
    }
}

#[test]
fn update_failures_retain_the_failing_boundary_in_the_envelope() {
    let transport = Arc::new(LocalTransport::default());
    let client = Arc::new(Client::from(ClientOptions {
        transport: Some(Arc::new(transport.clone())),
        server_name: Some("fabricated-update-workstation".into()),
        ..sentry_options(Some("http://public@127.0.0.1:1/1")).unwrap()
    }));
    let hub = Arc::new(sentry::Hub::new(
        Some(client),
        Arc::new(sentry::Scope::default()),
    ));
    let subscriber = tracing_subscriber::Registry::default()
        .with(sentry::integrations::tracing::layer().event_filter(sentry_event_filter));
    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let cases = [
        ("manifest_http", "manifest_http_status"),
        ("artifact_http", "artifact_http_status"),
        ("manifest_connect", "manifest_request"),
        ("artifact_connect", "artifact_request"),
        ("manifest_decode", "manifest_decode"),
        ("manifest_acceptance", "manifest_acceptance"),
        ("artifact_body", "artifact_read"),
        ("staging_create", "staging_create"),
        ("staging_file_create", "staging_file_create"),
        ("status_write", "status_write"),
        ("artifact_hash", "artifact_checksum"),
        ("package_format", "package_validation"),
        ("failure_status_write", "manifest_http_status"),
        #[cfg(windows)]
        ("helper_staging", "stage_update_helper"),
        #[cfg(windows)]
        ("helper_launch", "start_update_helper"),
        #[cfg(windows)]
        ("helper_handoff", "helper_handoff"),
    ];
    sentry::Hub::run(hub, || {
        tracing::subscriber::with_default(subscriber, || {
            runtime.block_on(async {
                for (case, _) in cases {
                    exercise_failure(case).await;
                }
            });
        })
    });
    let envelopes = transport.0.lock().unwrap();
    assert_eq!(envelopes.len(), cases.len());
    let mut missing = Vec::new();
    for ((case, expected), bytes) in cases.into_iter().zip(envelopes.iter()) {
        let output = std::str::from_utf8(bytes).unwrap();
        assert!(!output.contains("server_name"));
        let event: serde_json::Value =
            serde_json::from_str(output.lines().nth(2).unwrap()).unwrap();
        assert_eq!(event["release"], env!("VERSION"));
        assert_eq!(event["environment"], env!("CATSERVER_SENTRY_ENVIRONMENT"));
        assert_eq!(event["message"], "Update request failed");
        let fields = &event["contexts"]["Rust Tracing Fields"];
        let evidence: serde_json::Value =
            serde_json::from_str(fields["failure_evidence"].as_str().unwrap()).unwrap();
        let update: serde_json::Value =
            serde_json::from_str(fields["update_evidence"].as_str().unwrap()).unwrap();
        assert!(update.get("failure").is_none());
        assert!(update.get("operation").is_some());
        assert!(update.get("state_before").is_some());
        assert!(update.get("state_after").is_some());
        if fields["error_stage"] != expected || evidence["stage"] != expected {
            missing.push((case, expected));
        }
        if matches!(
            case,
            "manifest_http" | "artifact_http" | "failure_status_write"
        ) {
            assert!(
                !fields["error"]
                    .as_str()
                    .unwrap()
                    .contains("response_headers")
            );
            assert_eq!(evidence["http_status"], 503, "{case}");
            assert_eq!(evidence["http"]["method"], "GET", "{case}");
            if case == "artifact_http" {
                assert_eq!(
                    evidence["http"]["failed_response_body"],
                    serde_json::json!({"bytes": vec![255; 16 * 1024]})
                );
                assert!(
                    evidence["http"]["response_headers"]
                        .as_array()
                        .unwrap()
                        .contains(&serde_json::json!(["x-native", {"bytes": [255]}]))
                );
            } else {
                assert_eq!(
                    evidence["http"]["failed_response_body"]
                        .as_str()
                        .unwrap()
                        .len(),
                    16 * 1024
                );
            }
            assert!(
                evidence["http"]["response_headers"]
                    .to_string()
                    .contains("x-request-id"),
                "{case}"
            );
            assert_eq!(evidence["http"]["attempt"], 1);
            assert_eq!(evidence["http"]["retry_count"], 0);
            assert!(
                evidence["destination"]
                    .as_str()
                    .unwrap()
                    .starts_with("http://127.0.0.1:")
            );
        }
        if matches!(case, "manifest_connect" | "artifact_connect") {
            assert!(
                evidence["cause_categories"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .any(|category| category == "network_connect"),
                "{case}: {evidence}"
            );
        }
        #[cfg(windows)]
        if case == "helper_launch" {
            assert_eq!(fields["io_error_kind"], "NotFound");
            assert_eq!(fields["os_error_code"], 2);
        }
        if case == "failure_status_write" {
            assert!(output.contains("cannot persist update failure status"));
        }
        if cfg!(target_os = "linux") && matches!(case, "artifact_body" | "package_format") {
            assert!(
                evidence["io_summary"]
                    .as_str()
                    .unwrap()
                    .contains("UnexpectedEof"),
                "{case}: {evidence}"
            );
        }
        if cfg!(target_os = "linux") && matches!(case, "staging_file_create" | "status_write") {
            assert_eq!(fields["os_error_code"], 21, "{case}");
        }
    }
    assert!(missing.is_empty(), "Missing failure boundary: {missing:?}");
}
