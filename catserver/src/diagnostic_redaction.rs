//! Only redact the local home directory and Sentry's machine-name field.
//! All other diagnostic fields and text pass through unchanged.

use directories::BaseDirs;
use sentry::protocol::{Breadcrumb, Event};
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;

struct HomePrefix {
    value: String,
    url_encoded: bool,
}

pub(crate) struct Redactions {
    home_prefixes: Vec<HomePrefix>,
    case_insensitive: bool,
    native_home: Option<std::path::PathBuf>,
}

impl Redactions {
    pub(crate) fn current() -> Self {
        Self::from_home(BaseDirs::new().map(|dirs| dirs.home_dir().to_path_buf()))
    }

    fn from_home(home: Option<std::path::PathBuf>) -> Self {
        let mut redactions = Self::new(
            home.as_ref()
                .and_then(|home| home.to_str())
                .map(str::to_owned),
        );
        redactions.native_home = home;
        redactions
    }

    fn new(home: Option<String>) -> Self {
        let native_home = home.as_ref().map(std::path::PathBuf::from);
        let mut home_prefixes = Vec::new();
        let mut case_insensitive = false;
        if let Some(home) = home {
            let home = home.trim_end_matches(['/', '\\']);
            // Never replace a filesystem root or an empty directory.
            if std::path::Path::new(home).parent().is_some()
                && !(home.len() == 2 && home.ends_with(':'))
            {
                case_insensitive = home.starts_with(r"\\") || home.as_bytes().get(1) == Some(&b':');
                let mut roots = vec![home.to_owned()];
                if home.as_bytes().get(1) == Some(&b':') {
                    roots.push(format!(r"\\?\{home}"));
                } else if let Some(unc) = home.strip_prefix(r"\\") {
                    roots.push(format!(r"\\?\UNC\{unc}"));
                }
                for root in roots {
                    home_prefixes.push(HomePrefix {
                        value: root.clone(),
                        url_encoded: false,
                    });
                    if case_insensitive {
                        home_prefixes.push(HomePrefix {
                            value: root.replace('\\', "/"),
                            url_encoded: false,
                        });
                    }
                    // Reuse JSON's escaping rules for nested tracing fields,
                    // including quotes and control characters, not just slashes.
                    let mut escaped = root;
                    for _ in 0..3 {
                        let quoted = serde_json::to_string(&escaped).expect("strings serialize");
                        escaped = quoted[1..quoted.len() - 1].to_owned();
                        home_prefixes.push(HomePrefix {
                            value: escaped.clone(),
                            url_encoded: false,
                        });
                    }
                }
                // Encode only the actual home; leave unrelated URL text alone.
                let path = if case_insensitive {
                    home.replace('\\', "/")
                } else {
                    home.to_owned()
                };
                let encoded = encoded_path(&path);
                home_prefixes.push(HomePrefix {
                    value: encoded,
                    url_encoded: true,
                });
            }
        }
        home_prefixes.sort_by_key(|prefix| std::cmp::Reverse(prefix.value.len()));
        home_prefixes.dedup_by(|a, b| a.value == b.value && a.url_encoded == b.url_encoded);
        Self {
            home_prefixes,
            case_insensitive,
            native_home,
        }
    }

    fn text(&self, text: &str) -> String {
        let mut result = text.to_owned();
        for prefix in &self.home_prefixes {
            let comparable = if prefix.url_encoded {
                canonical_percent_escapes(&result)
            } else {
                result.clone()
            };
            let haystack = if self.case_insensitive {
                comparable.to_ascii_lowercase()
            } else {
                comparable
            };
            let needle = if self.case_insensitive {
                prefix.value.to_ascii_lowercase()
            } else {
                prefix.value.clone()
            };
            let mut output = String::new();
            let mut cursor = 0;
            for (start, _) in haystack.match_indices(&needle) {
                let end = start + prefix.value.len();
                let before = result[..start].chars().next_back();
                let after = result[end..].chars().next();
                let starts_path = before
                    .is_none_or(|c| !c.is_alphanumeric() && !matches!(c, '_' | '-' | '.' | '\\'));
                let ends_directory = after.is_none_or(|c| {
                    c.is_whitespace()
                        || matches!(
                            c,
                            '/' | '\\' | '\'' | '"' | ')' | ']' | '}' | ',' | ';' | ':' | '?' | '#'
                        )
                });
                // A literal '%' in a filesystem name is not an escape.
                // Match URL-encoded spellings only inside file URLs, and raw
                // spellings outside them, so another account is not redacted.
                if starts_path
                    && ends_directory
                    && prefix.url_encoded == follows_file_scheme(&result[..start])
                {
                    output.push_str(&result[cursor..start]);
                    output.push('~');
                    cursor = end;
                }
            }
            output.push_str(&result[cursor..]);
            result = output;
        }
        result
    }

    pub(crate) fn path(&self, path: &std::path::Path) -> std::path::PathBuf {
        self.native_home
            .as_ref()
            .filter(|home| home.parent().is_some())
            .and_then(|home| path.strip_prefix(home).ok())
            .map(|suffix| std::path::Path::new("~").join(suffix))
            .unwrap_or_else(|| path.to_path_buf())
    }

    fn value(&self, value: &mut Value) {
        match value {
            Value::String(text) => *text = self.text(text),
            Value::Array(values) => values.iter_mut().for_each(|value| self.value(value)),
            Value::Object(fields) => {
                let original = std::mem::take(fields);
                let reserved: std::collections::HashSet<_> = original.keys().cloned().collect();
                for (key, mut value) in original {
                    self.value(&mut value);
                    let redacted = self.text(&key);
                    let mut target = redacted.clone();
                    if redacted != key {
                        // Keep existing keys and every value if normalization
                        // produces a collision. Only rename the redacted key.
                        let mut suffix = 2;
                        while fields.contains_key(&target) || reserved.contains(&target) {
                            target = format!("{redacted} [redacted path {suffix}]");
                            suffix += 1;
                        }
                    }
                    fields.insert(target, value);
                }
            }
            _ => {}
        }
    }

    fn redact<T: Serialize + DeserializeOwned>(&self, input: T) -> Option<T> {
        // Traverse the serialized protocol, including stack frames and future
        // context fields, rather than keeping a list of permitted SDK fields.
        let mut value = serde_json::to_value(input).ok()?;
        self.value(&mut value);
        serde_json::from_value(value).ok()
    }

    pub(crate) fn event(&self, mut event: Event<'static>) -> Option<Event<'static>> {
        // The contexts integration automatically adds the local hostname here.
        event.server_name = None;
        self.redact(event)
    }

    pub(crate) fn breadcrumb(&self, breadcrumb: Breadcrumb) -> Option<Breadcrumb> {
        self.redact(breadcrumb)
    }
}

fn follows_file_scheme(text: &str) -> bool {
    let text = text.trim_end_matches('/');
    let Some(start) = text.len().checked_sub("file:".len()) else {
        return false;
    };
    text.get(start..)
        .is_some_and(|scheme| scheme.eq_ignore_ascii_case("file:"))
        && text[..start]
            .chars()
            .next_back()
            .is_none_or(|ch| !ch.is_alphanumeric() && !matches!(ch, '_' | '-' | '.'))
}

fn encoded_path(path: &str) -> String {
    // from_directory_path uses the host OS's path syntax. These diagnostic
    // spellings can use either OS, so encode their segments with the same URL
    // library instead. Supplying segments also escapes literal '%' correctly.
    // A hierarchical URL supplies the encoder only; it is never requested.
    let mut url = reqwest::Url::parse("https://redaction.invalid/").expect("valid static URL");
    path.split('/')
        .map(|segment| {
            // This is text encoding, not path resolution. The URL setter skips
            // dot segments, so retain their literal spelling instead.
            if matches!(segment, "." | "..") {
                return segment.to_owned();
            }
            url.path_segments_mut()
                .expect("hierarchical URLs support path segments")
                .clear()
                .push(segment);
            url.path()[1..].to_owned()
        })
        .collect::<Vec<_>>()
        .join("/")
}

// URL escapes are case-insensitive, but Unix path components are not.
fn canonical_percent_escapes(text: &str) -> String {
    let mut remaining = 0;
    text.chars()
        .map(|ch| {
            if ch == '%' {
                remaining = 2;
                ch
            } else if remaining > 0 {
                remaining -= 1;
                ch.to_ascii_uppercase()
            } else {
                ch
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use sentry::protocol::{Context, Exception, Frame, Stacktrace};
    use std::collections::BTreeMap;

    #[cfg(unix)]
    #[test]
    fn explicit_native_paths_replace_only_the_home_prefix() {
        use std::{ffi::OsString, os::unix::ffi::OsStringExt, path::PathBuf};
        let path = |bytes: &[u8]| PathBuf::from(OsString::from_vec(bytes.to_vec()));
        let redactions = Redactions::from_home(Some(path(b"/home/operator-\xff")));
        assert_eq!(
            redactions.path(&path(b"/home/operator-\xff/file-\xfe")),
            path(b"~/file-\xfe")
        );
        for bytes in [
            b"/home/operator-\xfe/file".as_slice(),
            b"/home/operator-\xff-other/file",
        ] {
            assert_eq!(redactions.path(&path(bytes)), path(bytes));
        }
    }

    #[cfg(windows)]
    #[test]
    fn explicit_native_paths_preserve_unpaired_units() {
        use std::{ffi::OsString, os::windows::ffi::OsStringExt, path::PathBuf};
        let home = PathBuf::from(OsString::from_wide(
            &r"C:\Users\operator-"
                .encode_utf16()
                .chain([0xd800])
                .collect::<Vec<_>>(),
        ));
        let suffix = OsString::from_wide(&[b'f' as u16, 0xdc00]);
        let redactions = Redactions::from_home(Some(home.clone()));
        assert_eq!(
            redactions.path(&home.join(&suffix)),
            PathBuf::from("~").join(suffix)
        );
    }

    #[test]
    fn opaque_native_payloads_are_not_path_scanned() {
        let redactions = Redactions::new(Some("/home/operator".into()));
        let payload = serde_json::json!({"bytes": b"/home/operator/\xff", "unix_bytes": b"/home/operator/\xfe", "windows_utf16": [67, 58, 92, 0xd800]});
        let mut event = Event::default();
        event.extra.insert("opaque".into(), payload.clone());
        assert_eq!(redactions.event(event).unwrap().extra["opaque"], payload);
    }

    #[test]
    fn replaces_only_the_actual_home_directory_prefix() {
        let redactions = Redactions::new(Some("/home/alice".into()));
        assert_eq!(
            redactions.text("cannot read /home/alice/.config/holycluster/radio.json: denied"),
            "cannot read ~/.config/holycluster/radio.json: denied"
        );
        assert_eq!(
            redactions.text("home=/home/alice; file:///home/alice/update.AppImage"),
            "home=~; file://~/update.AppImage"
        );
        for untouched in [
            "/home/alice-other/radio.json",
            "/home/alice.backup",
            "/opt/cache/home/alice/file",
            "/home/bob/radio.json",
            "Alice: unknown backend error 1603",
        ] {
            assert_eq!(redactions.text(untouched), untouched);
        }
        assert_eq!(
            Redactions::new(Some("/".into())).text("/etc/radio.json"),
            "/etc/radio.json"
        );
    }

    #[test]
    fn handles_windows_paths_forward_slashes_and_escaped_tracing_text() {
        let redactions = Redactions::new(Some(r"C:\Users\Alice".into()));
        assert_eq!(
            redactions.text(r"cannot read c:\users\ALICE\radio.json"),
            r"cannot read ~\radio.json"
        );
        assert_eq!(
            redactions.text("C:/Users/Alice/AppData/radio.json"),
            "~/AppData/radio.json"
        );
        assert_eq!(
            redactions.text(r#"Read("C:\\Users\\Alice\\radio.json")"#),
            r#"Read("~\\radio.json")"#
        );
        let nested =
            serde_json::json!({"error": format!("{:?}", r"C:\Users\Alice\radio.json")}).to_string();
        let redacted = redactions.text(&nested);
        assert!(!redacted.contains("Alice"));
        assert!(redacted.contains("radio.json"));
        assert_eq!(
            redactions.text(r"C:\Users\Alice-other\file"),
            r"C:\Users\Alice-other\file"
        );
    }

    #[test]
    fn handles_verbatim_windows_paths_and_escaped_representations() {
        let redactions = Redactions::new(Some(r"C:\Users\Alice".into()));
        let path = r"\\?\C:\Users\Alice\radio.json";
        assert_eq!(redactions.text(path), r"~\radio.json");
        assert_eq!(redactions.text(&format!("{path:?}")), r#""~\\radio.json""#);
        let unc = Redactions::new(Some(r"\\server\profiles\Alice".into()));
        assert_eq!(
            unc.text(r"\\?\UNC\server\profiles\Alice\radio.json"),
            r"~\radio.json"
        );
    }

    #[test]
    fn handles_url_encoded_home_names_without_decoding_unrelated_text() {
        let redactions = Redactions::new(Some("/home/Alïce Smith".into()));
        assert_eq!(
            redactions.text("file:///home/Al%C3%AFce%20Smith/radio.json"),
            "file://~/radio.json"
        );
        assert_eq!(
            redactions.text("file:///home/Al%c3%Afce%20Smith/radio.json"),
            "file://~/radio.json"
        );
        let other = "file:///home/al%C3%AFce%20Smith/radio.json?keep=%2f";
        assert_eq!(redactions.text(other), other);
        let windows = Redactions::new(Some(r"C:\Users\Alice Smith".into()));
        assert_eq!(
            windows.text("file:///C:/Users/Alice%20Smith/radio.json"),
            "file:///~/radio.json"
        );
    }

    #[test]
    fn url_encoding_preserves_literal_percent_and_path_separators() {
        assert_eq!(encoded_path("/home/Alice Smith"), "/home/Alice%20Smith");
        assert_eq!(
            encoded_path("C:/Users/Alice Smith"),
            "C:/Users/Alice%20Smith"
        );
        assert_eq!(
            encoded_path("//server/profiles/Alice Smith"),
            "//server/profiles/Alice%20Smith"
        );
        assert_eq!(
            encoded_path("/home/a/../Alice Smith/"),
            "/home/a/../Alice%20Smith/"
        );
        let redactions = Redactions::new(Some("/home/Alice%20Smith".into()));
        assert_eq!(
            redactions.text("file:///home/Alice%2520Smith/radio.json"),
            "file://~/radio.json"
        );
        let other = "file:///home/Alice%20Smith/radio.json";
        assert_eq!(redactions.text(other), other);
        assert_eq!(
            redactions.text("cannot open /home/Alice%20Smith/radio.json"),
            "cannot open ~/radio.json"
        );
        let spaces = Redactions::new(Some("/home/Alice Smith".into()));
        let literal_percent = "/home/Alice%20Smith/radio.json";
        assert_eq!(spaces.text(literal_percent), literal_percent);
        assert_eq!(
            spaces.text("FILE:///home/Alice%20Smith/radio.json"),
            "FILE://~/radio.json"
        );
    }

    #[test]
    fn json_escaping_handles_quotes_in_home_names() {
        let home = "/home/Alice\"Smith";
        let redactions = Redactions::new(Some(home.into()));
        let debug = format!("{:?}", format!("{home}/radio.json"));
        assert_eq!(redactions.text(&debug), "\"~/radio.json\"");
        let nested = serde_json::json!({"error": debug}).to_string();
        let redacted = redactions.text(&nested);
        assert!(!redacted.contains("Alice"));
        assert!(redacted.contains("radio.json"));
        assert!(serde_json::from_str::<Value>(&redacted).is_ok());
    }

    #[test]
    fn redacts_diagnostic_keys_without_losing_colliding_entries() {
        let redactions = Redactions::new(Some("/home/alice".into()));
        let mut value = serde_json::json!({
            "/home/alice/radio.json": "read failed",
            "~/radio.json": "existing alias",
            "~/radio.json [redacted path 2]": "existing suffix",
            "unchanged": {"/home/alice/rotator.json": "write failed"}
        });
        redactions.value(&mut value);
        assert_eq!(value["~/radio.json"], "existing alias");
        assert_eq!(value["~/radio.json [redacted path 2]"], "existing suffix");
        assert_eq!(value["~/radio.json [redacted path 3]"], "read failed");
        assert_eq!(value["unchanged"]["~/rotator.json"], "write failed");
        assert_eq!(value.as_object().unwrap().len(), 4);
        assert!(!value.to_string().contains("/home/alice"));
    }

    #[test]
    fn preserves_every_other_event_field_and_unknown_diagnostics() {
        let redactions = Redactions::new(Some("/home/alice".into()));
        let event = Event {
            server_name: Some("personal-workstation".into()),
            message: Some("New backend failed: status 1603; arbitrary details".into()),
            contexts: BTreeMap::from([
                (
                    "new-context".into(),
                    Context::Other(BTreeMap::from([(
                        "unknown-field".into(),
                        serde_json::json!({"nested": [1, true, "new value"]}),
                    )])),
                ),
                (
                    "os".into(),
                    Context::Os(Box::new(sentry::protocol::OsContext {
                        name: Some("Unlisted OS".into()),
                        version: Some("rolling-2026-beta".into()),
                        kernel_version: Some("custom-kernel".into()),
                        ..Default::default()
                    })),
                ),
            ]),
            tags: BTreeMap::from([("action".into(), "NewAction".into())]),
            extra: BTreeMap::from([("new-field".into(), "retain this".into())]),
            exception: vec![Exception {
                ty: "NewError".into(),
                value: Some("Full unknown cause".into()),
                ..Default::default()
            }]
            .into(),
            ..Default::default()
        };
        let mut expected = serde_json::to_value(&event).unwrap();
        expected.as_object_mut().unwrap().remove("server_name");
        let actual = redactions.event(event).unwrap();
        assert_eq!(serde_json::to_value(actual).unwrap(), expected);
    }

    #[test]
    fn redacts_paths_throughout_events_without_dropping_stacks_or_causes() {
        let redactions = Redactions::new(Some("/home/alice".into()));
        let mut event = Event {
            message: Some("cannot open /home/alice/radio.json".into()),
            ..Default::default()
        };
        event.extra.insert(
            "nested".into(),
            serde_json::json!({"paths": ["/home/alice/download.msi", "/tmp/keep-me"]}),
        );
        event.exception = vec![Exception {
            ty: "ReadError".into(),
            value: Some("read /home/alice/radio.json: error 5".into()),
            stacktrace: Some(Stacktrace {
                frames: vec![Frame {
                    filename: Some("source.rs".into()),
                    abs_path: Some("/home/alice/project/source.rs".into()),
                    lineno: Some(42),
                    ..Default::default()
                }],
                ..Default::default()
            }),
            ..Default::default()
        }]
        .into();
        let event = redactions.event(event).unwrap();
        assert_eq!(event.message.as_deref(), Some("cannot open ~/radio.json"));
        assert_eq!(event.extra["nested"]["paths"][0], "~/download.msi");
        assert_eq!(event.extra["nested"]["paths"][1], "/tmp/keep-me");
        let exception = &event.exception[0];
        assert_eq!(
            exception.value.as_deref(),
            Some("read ~/radio.json: error 5")
        );
        let frame = &exception.stacktrace.as_ref().unwrap().frames[0];
        assert_eq!(frame.abs_path.as_deref(), Some("~/project/source.rs"));
        assert_eq!(frame.lineno, Some(42));
        assert_eq!(frame.filename.as_deref(), Some("source.rs"));
    }

    #[test]
    fn keeps_unknown_breadcrumbs_and_their_data() {
        let redactions = Redactions::new(Some("/home/alice".into()));
        let breadcrumb = Breadcrumb {
            message: Some("NewAction failed in /home/alice/plugin".into()),
            category: Some("new.category".into()),
            data: BTreeMap::from([("new-field".into(), "arbitrary error details".into())]),
            ..Default::default()
        };
        let breadcrumb = redactions.breadcrumb(breadcrumb).unwrap();
        assert_eq!(
            breadcrumb.message.as_deref(),
            Some("NewAction failed in ~/plugin")
        );
        assert_eq!(breadcrumb.category.as_deref(), Some("new.category"));
        assert_eq!(breadcrumb.data["new-field"], "arbitrary error details");
    }
}
