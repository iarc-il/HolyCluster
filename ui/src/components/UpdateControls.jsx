import Button from "@/components/ui/Button.jsx";
import Modal from "@/components/ui/Modal.jsx";
import { useUpdate } from "@/hooks/useUpdate.jsx";

export function UpdateConsentDialog() {
    const { status, remote_version, defer, install } = useUpdate();
    const is_available = status === "available";

    return (
        <Modal
            title={<h2 className="text-xl">CAT Control update available</h2>}
            button={<span aria-hidden="true" />}
            external_open={is_available}
            on_cancel={() => defer()}
            on_apply={() => {
                install();
                return true;
            }}
            apply_text="Update"
            cancel_text="Later"
            modal_style={{ width: "30rem" }}
        >
            <p className="p-4">Version {remote_version ?? ""} is ready to install.</p>
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
        deferred: "CAT Control update available. You chose to install it later.",
        installing: "Installing CAT Control. The connection may close while it restarts.",
        unsupported: "Automatic updates are not supported on this platform.",
        failed: error ?? "CAT Control update failed.",
    };
    return messages[status] ?? null;
}

export default function UpdateControls() {
    const { status, local_version, remote_version, error, check, install, retry } = useUpdate();
    const message = message_for(status, error);
    const can_install = status === "available" || status === "deferred";

    return (
        <section aria-live="polite" className="mt-4 rounded-lg border border-blue-300 p-4">
            <h2 className="text-lg font-semibold">CAT Control updates</h2>
            {local_version && <p>Installed version: {local_version}</p>}
            {remote_version && <p>Available version: {remote_version}</p>}
            {message && <p>{message}</p>}
            <div className="mt-3 flex flex-wrap gap-2">
                <Button disabled={status === "loading" || status === "checking"} on_click={check}>
                    Check for updates
                </Button>
                {can_install && <Button on_click={install}>Install update</Button>}
                {status === "failed" && <Button on_click={retry}>Retry update</Button>}
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
