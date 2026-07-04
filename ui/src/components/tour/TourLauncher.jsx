import { useColors } from "@/hooks/useColors";
import { useEffect, useRef, useState } from "react";
import { DEFAULT_TOUR_CHAPTER_ID, TOUR_CHAPTERS } from "./tour_chapters.jsx";

const JOYRIDE_PORTAL_SELECTOR = "#react-joyride-portal";

function TourLauncher({ completed_chapters, on_start_tour }) {
    const { colors } = useColors();
    const launcher_ref = useRef(null);
    const [show_launcher_panel, set_show_launcher_panel] = useState(false);
    const [selected_chapter_id, set_selected_chapter_id] = useState(DEFAULT_TOUR_CHAPTER_ID);
    const chapters = Object.values(TOUR_CHAPTERS);
    const selected_chapter = TOUR_CHAPTERS[selected_chapter_id];
    const selected_chapter_state = completed_chapters[selected_chapter_id];
    const completed_text = selected_chapter_state?.status === "skipped" ? "Skipped" : "Completed";
    const completed_chapters_count = chapters.filter(
        chapter => completed_chapters[chapter.id],
    ).length;

    const launcher_button_style = {
        backgroundColor: colors.theme.background,
        border: `1px solid ${colors.theme.text}38`,
        boxShadow: "0 8px 24px rgba(0, 0, 0, 0.25)",
        color: colors.buttons?.utility ?? colors.theme.text,
    };

    const panel_style = {
        backgroundColor: colors.theme.background,
        border: `1px solid ${colors.theme.text}2E`,
        color: colors.theme.text,
    };

    function close_launcher_panel() {
        set_show_launcher_panel(false);
    }

    function start_selected_chapter() {
        on_start_tour(selected_chapter_id);
        close_launcher_panel();
    }

    useEffect(() => {
        if (!show_launcher_panel) return;

        function close_panel_on_click_outside(event) {
            if (event.target instanceof Element && event.target.closest(JOYRIDE_PORTAL_SELECTOR)) {
                return;
            }

            if (!launcher_ref.current?.contains(event.target)) {
                close_launcher_panel();
            }
        }

        function close_panel_on_escape(event) {
            if (event.key === "Escape") {
                close_launcher_panel();
            }
        }

        document.addEventListener("mousedown", close_panel_on_click_outside);
        document.addEventListener("keydown", close_panel_on_escape);
        return () => {
            document.removeEventListener("mousedown", close_panel_on_click_outside);
            document.removeEventListener("keydown", close_panel_on_escape);
        };
    }, [show_launcher_panel]);

    return (
        <div
            ref={launcher_ref}
            className="relative z-[90] flex w-10 justify-center"
            data-tour="tour-launcher"
        >
            <button
                type="button"
                onClick={() => set_show_launcher_panel(!show_launcher_panel)}
                className="flex h-10 w-10 items-center justify-center rounded-lg"
                style={launcher_button_style}
                aria-label={show_launcher_panel ? "Hide tour launcher" : "Show tour launcher"}
                aria-expanded={show_launcher_panel}
                title="Tour launcher"
            >
                <svg
                    width="24"
                    height="24"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                >
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5z" />
                    <path d="M8 7h8" />
                    <path d="M8 11h6" />
                </svg>
            </button>
            {show_launcher_panel && (
                <div
                    className="absolute bottom-0 left-full ml-2 flex w-80 max-w-[calc(100vw-5.5rem)] flex-col gap-3 rounded-xl p-3 text-sm shadow-xl"
                    data-tour="tour-launcher-panel"
                    style={panel_style}
                >
                    <div className="flex items-start justify-between gap-3">
                        <div>
                            <div className="text-[11px] font-semibold uppercase tracking-wide opacity-60">
                                Guided tour
                            </div>
                            <div className="text-base font-semibold">Explore HolyCluster</div>
                        </div>
                        <span className="rounded-full px-2 py-1 text-xs font-semibold opacity-80">
                            {completed_chapters_count}/{chapters.length}
                        </span>
                    </div>
                    <div className="flex max-h-64 flex-col gap-1 overflow-y-auto pr-1">
                        {chapters.map(chapter => {
                            const chapter_state = completed_chapters[chapter.id];
                            const is_selected = chapter.id === selected_chapter_id;
                            const chapter_state_text =
                                chapter_state?.status === "skipped" ? "Skipped" : "Done";

                            return (
                                <button
                                    key={chapter.id}
                                    type="button"
                                    onClick={() => set_selected_chapter_id(chapter.id)}
                                    className="rounded-lg border px-3 py-2 text-left transition hover:brightness-110"
                                    style={{
                                        borderColor: is_selected
                                            ? "#2563eb"
                                            : `${colors.theme.text}24`,
                                        backgroundColor: is_selected
                                            ? `${colors.theme.text}18`
                                            : "transparent",
                                        color: colors.theme.text,
                                    }}
                                    aria-label={`Select ${chapter.title} tour`}
                                    aria-pressed={is_selected}
                                >
                                    <span className="flex items-center justify-between gap-2">
                                        <span className="font-semibold">{chapter.title}</span>
                                        {chapter_state && (
                                            <span className="text-[11px] font-semibold uppercase opacity-70">
                                                {chapter_state_text}
                                            </span>
                                        )}
                                    </span>
                                    {chapter.description && (
                                        <span className="mt-1 block text-xs opacity-70">
                                            {chapter.description}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                    <div
                        className="flex items-center justify-between gap-3 border-t pt-3"
                        style={{ borderColor: `${colors.theme.text}24` }}
                    >
                        <div className="min-w-0 text-xs opacity-75">
                            <div className="truncate font-semibold">{selected_chapter?.title}</div>
                            {selected_chapter_state && <div>{completed_text}</div>}
                        </div>
                        <button
                            type="button"
                            className="shrink-0 rounded-lg px-4 py-2 font-semibold hover:brightness-110 disabled:opacity-50"
                            onClick={start_selected_chapter}
                            disabled={!selected_chapter}
                            aria-label={selected_chapter_state ? "Restart tour" : "Start tour"}
                            style={{
                                color: "white",
                                backgroundColor: "#2563eb",
                            }}
                        >
                            {selected_chapter_state ? "Restart" : "Start"}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}

export default TourLauncher;
