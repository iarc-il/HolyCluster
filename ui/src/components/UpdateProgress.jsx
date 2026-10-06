import ProgressBar from "@/components/ui/ProgressBar.jsx";
import { useUpdate } from "@/hooks/useUpdate.jsx";
import { format_bytes } from "@/utils/format_bytes.js";
import { useEffect, useState } from "react";

const labels = {
    requested: "Preparing update request",
    downloading: "Downloading",
    verifying: "Verifying the download",
    waiting_for_parent: "Waiting for CAT Control to stop",
    awaiting_permission: "Awaiting Windows permission",
    installing: "Installing",
    waiting_for_local_port: "Waiting for the original local port",
    reconnecting: "Reconnecting",
    recovering: "Restarting CAT Control after the installer did not complete",
    updated: "Updated",
    permission_cancelled: "Windows permission was canceled",
    failed: "Update failed",
    restart_failed: "CAT Control could not restart after the installation attempt",
    reboot_required: "Restart Windows to finish installation",
};

export default function UpdateProgress() {
    const { session, active, status, error, reconnect, dismiss, local_version } = useUpdate();
    const [now, set_now] = useState(Date.now());
    useEffect(() => {
        if (!session || !active) return;
        const timer = setInterval(() => set_now(Date.now()), 1000);
        return () => clearInterval(timer);
    }, [session?.started, active]);
    if (!session) return null;
    const phase = session.verified
        ? "updated"
        : session.phase === "updated"
          ? "reconnecting"
          : session.phase;
    const seconds = Math.max(0, Math.floor((now - session.started) / 1000));
    return (
        <section role="status" aria-live="polite" className="space-y-2 p-4 text-sm">
            <strong className="font-medium">{labels[phase] ?? "Waiting for confirmation"}</strong>
            {session.expected_version && <span> — {session.expected_version}</span>}
            {phase === "downloading" && session.total > 0 ? (
                <div>
                    <ProgressBar
                        label="Download progress"
                        max={session.total}
                        value={session.downloaded ?? 0}
                        className="w-full"
                    />
                    <span>
                        {format_bytes(session.downloaded ?? 0)} / {format_bytes(session.total)}
                    </span>
                </div>
            ) : active ? (
                <ProgressBar label="Update in progress" className="w-full" />
            ) : null}
            {status === "request_unconfirmed" && (
                <p>The request was interrupted; installation has not yet been confirmed.</p>
            )}
            {(session.diagnostic || error) && <p>{session.diagnostic ?? error}</p>}
            {phase === "updated" && <p>Verified running version: {local_version}</p>}
            {active && seconds >= 60 && <p>Still waiting ({seconds}s)…</p>}
            {session.installer_outcome === "installed" && !session.verified && (
                <button type="button" className="mr-3 underline" onClick={reconnect}>
                    Retry connection
                </button>
            )}
            {!active && (
                <button type="button" className="underline" onClick={dismiss}>
                    Dismiss
                </button>
            )}
        </section>
    );
}
