use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};

#[derive(Deserialize)]
struct UiConfigPolicy {
    connection_kind_by_port_type: BTreeMap<String, String>,
    network_pathname_token: String,
    pathname_tokens: BTreeSet<String>,
    serial_labels: BTreeMap<String, String>,
}

#[derive(Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "snake_case")]
enum UiConfigSupport {
    FullyConfigurable,
    PartiallyConfigurable,
    UnsupportedPortFlow,
}

#[derive(Serialize)]
struct ModelUiConfigReport {
    id: String,
    manufacturer: String,
    model: String,
    port_type: String,
    support: UiConfigSupport,
    unsupported_tokens: Vec<String>,
}

fn policy() -> UiConfigPolicy {
    serde_json::from_str(include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../shared/hamlib_ui_config_policy.json"
    )))
    .expect("Hamlib UI config policy is valid JSON")
}

fn support_for(
    policy: &UiConfigPolicy,
    port_type: &str,
    tokens: impl IntoIterator<Item = String>,
) -> (UiConfigSupport, Vec<String>) {
    let Some(connection_kind) = policy.connection_kind_by_port_type.get(port_type) else {
        return (
            UiConfigSupport::UnsupportedPortFlow,
            tokens.into_iter().collect(),
        );
    };
    let mut unsupported_tokens: Vec<String> = match connection_kind.as_str() {
        "serial" => tokens
            .into_iter()
            .filter(|token| !policy.serial_labels.contains_key(token))
            .collect(),
        "network" => tokens
            .into_iter()
            .filter(|token| token != &policy.network_pathname_token)
            .collect(),
        "none" => tokens
            .into_iter()
            .filter(|token| !policy.pathname_tokens.contains(token))
            .collect(),
        _ => panic!("unknown UI connection kind: {connection_kind}"),
    };
    unsupported_tokens.sort();
    let support = if unsupported_tokens.is_empty() {
        UiConfigSupport::FullyConfigurable
    } else {
        UiConfigSupport::PartiallyConfigurable
    };
    (support, unsupported_tokens)
}

fn port_type_name(port_type: hamlib::RigPortType) -> String {
    serde_json::to_value(port_type)
        .expect("Hamlib port type serializes")
        .as_str()
        .expect("Hamlib port type serializes as text")
        .to_owned()
}

#[test]
fn classifies_ui_config_support_from_the_shared_policy() {
    let policy = policy();
    assert_eq!(
        support_for(
            &policy,
            "serial",
            ["rig_pathname".into(), "serial_speed".into()],
        ),
        (UiConfigSupport::FullyConfigurable, Vec::new())
    );
    assert_eq!(
        support_for(&policy, "network", ["pathname".into()]),
        (
            UiConfigSupport::PartiallyConfigurable,
            vec!["pathname".into()]
        )
    );
    assert_eq!(
        support_for(&policy, "usb", ["rig_pathname".into()]),
        (UiConfigSupport::FullyConfigurable, Vec::new())
    );
    assert_eq!(
        support_for(&policy, "packet", ["rig_pathname".into()]),
        (
            UiConfigSupport::UnsupportedPortFlow,
            vec!["rig_pathname".into()]
        )
    );
}

#[test]
fn reports_every_hamlib_model_ui_config_support() {
    let policy = policy();
    let catalog = hamlib::Catalog::load().expect("Hamlib catalog loads");
    let mut report: Vec<ModelUiConfigReport> = catalog
        .models()
        .iter()
        .map(|model| {
            let port_type = port_type_name(model.port_type());
            let tokens = catalog
                .describe_model(model.id())
                .unwrap_or_else(|error| {
                    panic!(
                        "{} {} (model {}) has no UI config metadata: {error}",
                        model.manufacturer(),
                        model.model(),
                        model.id()
                    )
                })
                .into_iter()
                .map(|descriptor| descriptor.token().as_str().to_owned());
            let (support, unsupported_tokens) = support_for(&policy, &port_type, tokens);
            ModelUiConfigReport {
                id: model.id().to_string(),
                manufacturer: model.manufacturer().into(),
                model: model.model().into(),
                port_type,
                support,
                unsupported_tokens,
            }
        })
        .collect();
    report.sort_by(|left, right| {
        (&left.manufacturer, &left.model, &left.id).cmp(&(
            &right.manufacturer,
            &right.model,
            &right.id,
        ))
    });
    println!(
        "{}",
        serde_json::to_string_pretty(&report).expect("UI config report serializes")
    );
}
