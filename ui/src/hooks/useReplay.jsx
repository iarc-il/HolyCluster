import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { shorten_dxcc } from "@/data/flags.js";
import { modes, continents } from "@/data/filters_data.js";

const ReplayContext = createContext(undefined);

export function useReplay() {
    return useContext(ReplayContext);
}

function normalize_band(band) {
    if (band == 2) return "VHF";
    if (band == 0.7) return "UHF";
    if (band < 1) return "SHF";
    return band;
}

let replay_id_counter = 1_000_000;

function normalize_spots(spots) {
    return spots
        .map(spot => ({
            ...spot,
            id: replay_id_counter++,
            band: normalize_band(spot.band),
            mode: spot.mode === "DIGITAL" ? "DIGI" : spot.mode,
            dx_country: shorten_dxcc(spot.dx_country),
            spotter_country: shorten_dxcc(spot.spotter_country),
        }))
        .filter(spot => {
            if (!modes.includes(spot.mode)) return false;
            if (!continents.includes(spot.dx_continent)) return false;
            if (!continents.includes(spot.spotter_continent)) return false;
            return true;
        });
}

export function ReplayProvider({ children, live_spots = [] }) {
    const [is_replay_active, set_is_replay_active] = useState(false);
    const [replay_spots, set_replay_spots] = useState([]);
    const [replay_config, set_replay_config] = useState(null);
    const [current_frame_start, set_current_frame_start] = useState(null);
    const [is_playing, set_is_playing] = useState(false);
    const [is_loading, set_is_loading] = useState(false);
    const [error, set_error] = useState(null);
    const interval_ref = useRef(null);
    const paused_ref = useRef(false);

    const stop_interval = useCallback(() => {
        paused_ref.current = true;
        if (interval_ref.current) {
            clearInterval(interval_ref.current);
            interval_ref.current = null;
        }
    }, []);

    const pause = useCallback(() => {
        set_is_playing(false);
        stop_interval();
    }, [stop_interval]);

    const play = useCallback((config, frame_start) => {
        const cfg = config;
        const frame = frame_start;
        paused_ref.current = false;
        set_is_playing(true);
        stop_interval();
        paused_ref.current = false;
        let current = frame;
        interval_ref.current = setInterval(() => {
            if (paused_ref.current) return;
            const next = current + cfg.step_size;
            const max_frame = cfg.end_time - cfg.window_duration;
            if (next >= max_frame) {
                set_current_frame_start(max_frame);
                set_is_playing(false);
                clearInterval(interval_ref.current);
                interval_ref.current = null;
                return;
            }
            current = next;
            set_current_frame_start(next);
        }, cfg.playback_speed * 1000);
    }, [stop_interval]);

    const step_forward = useCallback(() => {
        if (!replay_config) return;
        pause();
        set_current_frame_start(prev => {
            const max_frame = replay_config.end_time - replay_config.window_duration;
            return Math.min(prev + replay_config.step_size, max_frame);
        });
    }, [replay_config, pause]);

    const step_backward = useCallback(() => {
        if (!replay_config) return;
        pause();
        set_current_frame_start(prev => {
            return Math.max(prev - replay_config.step_size, replay_config.start_time);
        });
    }, [replay_config, pause]);

    const seek = useCallback(
        timestamp => {
            if (!replay_config) return;
            pause();
            const max_frame = replay_config.end_time - replay_config.window_duration;
            set_current_frame_start(
                Math.max(replay_config.start_time, Math.min(timestamp, max_frame)),
            );
        },
        [replay_config, pause],
    );

    const load_replay = useCallback(
        async config => {
            set_is_loading(true);
            set_error(null);
            pause();
            try {
                let spots;
                const resp = await fetch(
                    `/spots?start_time=${config.start_time}&end_time=${config.end_time}`,
                );
                // If the backend endpoint isn't deployed yet, fall back to live WebSocket spots
                const text = await resp.text();
                if (!resp.ok || text.trimStart().startsWith("<")) {
                    // Filter live spots to the requested time range
                    spots = live_spots.filter(
                        s => s.time >= config.start_time && s.time <= config.end_time,
                    );
                } else {
                    spots = normalize_spots(JSON.parse(text));
                }
                set_replay_spots(spots);
                set_replay_config(config);
                set_current_frame_start(config.start_time);
                set_is_replay_active(true);
            } catch (e) {
                set_error(e.message);
            } finally {
                set_is_loading(false);
            }
        },
        [pause, live_spots],
    );

    const exit_replay = useCallback(() => {
        pause();
        set_is_replay_active(false);
        set_replay_spots([]);
        set_replay_config(null);
        set_current_frame_start(null);
        set_error(null);
    }, [pause]);

    useEffect(() => () => stop_interval(), [stop_interval]);

    return (
        <ReplayContext.Provider
            value={{
                is_replay_active,
                replay_spots,
                replay_config,
                current_frame_start,
                is_playing,
                is_loading,
                error,
                load_replay,
                exit_replay,
                play,
                pause,
                step_forward,
                step_backward,
                seek,
            }}
        >
            {children}
        </ReplayContext.Provider>
    );
}
