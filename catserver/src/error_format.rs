pub(crate) fn diagnostic(error: &anyhow::Error) -> String {
    let mut messages = Vec::new();
    for cause in error.chain() {
        if cause.is::<crate::desktop::BrowserLaunchError>()
            || cause.is::<crate::application::InstanceContactFailure>()
            || cause.is::<crate::updater::UpdateHttpFailure>()
        {
            continue;
        }
        let message = cause.to_string();
        if messages.last() != Some(&message) {
            messages.push(message);
        }
    }
    messages.join(": ")
}

pub(crate) struct TerminalError(pub(crate) anyhow::Error);

impl std::fmt::Display for TerminalError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(&diagnostic(&self.0))
    }
}

impl std::fmt::Debug for TerminalError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        std::fmt::Display::fmt(self, formatter)
    }
}

impl std::error::Error for TerminalError {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        Some(self.0.as_ref())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_keeps_context_and_skips_only_adjacent_duplicates() {
        let error = anyhow::anyhow!("cause")
            .context("cause")
            .context("context")
            .context("context")
            .context("cause");
        assert_eq!(diagnostic(&error), "cause: context: cause");
        assert_eq!(
            diagnostic(&anyhow::anyhow!("browser launch failed")),
            "browser launch failed"
        );
    }

    #[test]
    fn terminal_error_keeps_browser_source_and_hides_carrier() {
        let error = crate::desktop::launch_commands("http://localhost", "test", vec![])
            .unwrap_err()
            .context("Could not open browser");
        let error = TerminalError(error);
        let expected = "Could not open browser: no browser launcher available";
        assert_eq!(format!("{error:?}"), expected);
        assert_eq!(error.to_string(), expected);
        assert!(
            error
                .0
                .chain()
                .any(|cause| cause.is::<crate::desktop::BrowserLaunchError>())
        );
        assert!(error.0.chain().any(|cause| cause.is::<std::io::Error>()));
        assert!(std::error::Error::source(&error).is_some());
        assert!(
            crate::tracing_setup::failure_evidence(&error.0, "termination")["browser"].is_object()
        );
    }
}
