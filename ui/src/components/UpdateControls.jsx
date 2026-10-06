import UpdateProgress from "@/components/UpdateProgress.jsx";
import Button from "@/components/ui/Button.jsx";
import Modal from "@/components/ui/Modal.jsx";
import { useColors } from "@/hooks/useColors";
import { useUpdate } from "@/hooks/useUpdate.jsx";

export function UpdateConsentDialog() {
    const {
        enabled,
        status,
        remote_version,
        error,
        defer,
        install,
        session,
        active,
        dismiss,
        dialog_open,
        close_dialog,
    } = useUpdate();
    const is_available =
        enabled && !session && (status === "available" || (dialog_open && status === "deferred"));
    const show_update = is_available || session != null || (enabled && dialog_open);

    return (
        <Modal
            title={
                <h2 className="text-lg">CAT Control update{is_available ? " available" : ""}</h2>
            }
            button={<span aria-hidden="true" />}
            external_open={show_update}
            external_close={show_update}
            on_cancel={() => {
                close_dialog();
                if (is_available) defer();
                else if (session && !active) dismiss();
            }}
            on_apply={
                is_available
                    ? () => {
                          install();
                          return false;
                      }
                    : null
            }
            apply_text="Update"
            cancel_text="Later"
            footer={
                session && !active ? (
                    <Button color="red" on_click={dismiss}>
                        Dismiss
                    </Button>
                ) : !session && !is_available ? (
                    <Button color="red" on_click={close_dialog}>
                        Close
                    </Button>
                ) : null
            }
            modal_style={{ width: "24rem", maxWidth: "calc(100vw - 2rem)" }}
        >
            {session ? (
                <UpdateProgress />
            ) : (
                <p className="p-4 text-sm">
                    {is_available
                        ? `Version ${remote_version ?? ""} is ready to install.`
                        : (message_for(status, error) ?? "Checking for CAT Control updates…")}
                </p>
            )}
        </Modal>
    );
}

function message_for(status, error) {
    const messages = {
        loading: "Checking for CAT Control updates…",
        checking: "Checking for CAT Control updates…",
        current: "CAT Control is up to date.",
        newer_local: "Your installed CAT Control is newer than the available release.",
        unavailable: "CAT Control update service is unavailable.",
        malformed: "CAT Control update information is unavailable.",
        deferred: "CAT Control update available.",
        requested: "Preparing the update request…",
        request_unconfirmed:
            "Waiting for confirmation of the install request. Do not start another installer.",
        downloading: "Downloading CAT Control…",
        verifying: "Verifying the download…",
        waiting_for_local_port: "Waiting for the original local port…",
        reconnecting: "Reconnecting to CAT Control…",
        recovering: "Restarting CAT Control after the installer did not complete…",
        updated: "CAT Control restarted with the verified update.",
        installing: "Installing CAT Control…",
        reboot_required: "Restart Windows to finish installing CAT Control.",
        unsupported: "Automatic updates are not supported on this platform.",
        failed: error ?? "CAT Control update failed.",
    };
    return messages[status] ?? null;
}

export default function UpdateControls({ on_check = null }) {
    const { dev_mode } = useColors();
    const {
        enabled,
        status,
        local_version,
        remote_version,
        error,
        check,
        retry,
        allow_same_version,
        set_allow_same_version,
        session,
        active,
    } = useUpdate();
    if (!enabled) return null;

    const message = message_for(status, error);
    const busy = Boolean(active) || session?.installer_outcome === "unconfirmed";

    return (
        <section aria-live="polite" className="mt-4 rounded-lg border border-blue-300 p-4">
            <h2 className="text-lg font-semibold">CAT Control updates</h2>
            {local_version && <p>Installed version: {local_version}</p>}
            {remote_version && <p>Available version: {remote_version}</p>}
            {message && <p>{message}</p>}
            {dev_mode && (
                <label className="mt-3 flex items-center gap-2">
                    <input
                        type="checkbox"
                        checked={allow_same_version}
                        disabled={busy}
                        onChange={event => set_allow_same_version(event.target.checked)}
                    />
                    Allow same-version updates (testing only)
                </label>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
                <Button
                    disabled={busy || status === "loading" || status === "checking"}
                    on_click={() => {
                        on_check?.();
                        check();
                    }}
                >
                    Check for updates
                </Button>
                {status === "failed" && !busy && <Button on_click={retry}>Retry update</Button>}
                {status === "unsupported" && (
                    <a
                        className="rounded-lg bg-blue-600 p-2 text-sm font-medium text-white"
                        href="/catserver/download"
                        download
                    >
                        Download manually
                    </a>
                )}
            </div>
        </section>
    );
}
