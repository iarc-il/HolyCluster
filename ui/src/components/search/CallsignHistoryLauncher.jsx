import CallsignSearchModal from "@/components/search/CallsignSearchModal.jsx";
import { VIEW_CALLSIGN_HISTORY_EVENT, normalize_search_callsign } from "@/hooks/useCallsignSearch";
import { useEffect, useState } from "react";

// The one search modal that view_callsign_history() opens. It has no button
// of its own; each request bumps `count` so repeating a callsign reopens it.
export default function CallsignHistoryLauncher() {
    const [request, set_request] = useState({ count: 0, callsign: null });

    useEffect(() => {
        function handle_request(event) {
            const callsign = normalize_search_callsign(event.detail?.callsign ?? "");
            set_request(previous => ({ count: previous.count + 1, callsign }));
        }

        document.addEventListener(VIEW_CALLSIGN_HISTORY_EVENT, handle_request);
        return () => document.removeEventListener(VIEW_CALLSIGN_HISTORY_EVENT, handle_request);
    }, []);

    return (
        <CallsignSearchModal
            button={null}
            external_open={request.count > 0 ? request.count : null}
            dx={request.callsign}
        />
    );
}
