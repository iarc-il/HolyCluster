import Maidenhead from "maidenhead";
import { useState } from "react";

function GPSButton({ on_location, className, style, aria_label }) {
    const [is_locating, set_is_locating] = useState(false);
    const [location_error, set_location_error] = useState(null);

    function use_current_location() {
        if (typeof navigator === "undefined" || !navigator.geolocation) {
            set_location_error("GPS is not available");
            return;
        }

        set_is_locating(true);
        set_location_error(null);
        navigator.geolocation.getCurrentPosition(
            position => {
                const { latitude, longitude } = position.coords;
                const locator = new Maidenhead(latitude, longitude).locator
                    .slice(0, 6)
                    .toUpperCase();
                on_location({ latitude, longitude, locator });
                set_is_locating(false);
            },
            error => {
                set_is_locating(false);
                if (error.code === error.PERMISSION_DENIED) {
                    set_location_error("Location permission denied");
                } else if (error.code === error.POSITION_UNAVAILABLE) {
                    set_location_error("Current location is unavailable");
                } else if (error.code === error.TIMEOUT) {
                    set_location_error("Location request timed out");
                } else {
                    set_location_error("Could not get current location");
                }
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 60000,
            },
        );
    }

    return (
        <button
            type="button"
            onClick={use_current_location}
            disabled={is_locating}
            className={className}
            style={style}
            aria-label={aria_label}
            title={
                location_error ??
                (is_locating ? "Getting current location" : "Use current location")
            }
        >
            <svg
                height="24"
                width="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
            >
                <path d="M12 2v3" />
                <path d="M12 19v3" />
                <path d="M2 12h3" />
                <path d="M19 12h3" />
                <circle cx="12" cy="12" r="7" />
                <circle cx="12" cy="12" r="2" fill="currentColor" stroke="none" />
            </svg>
        </button>
    );
}

export default GPSButton;
