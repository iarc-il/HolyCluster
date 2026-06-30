import { useColors } from "@/hooks/useColors";
import { useState } from "react";
import { DEFAULT_TOUR_CHAPTER_ID, TOUR_CHAPTERS } from "./tour_chapters.jsx";

function TourLauncher({ completed_chapters, on_start_tour }) {
    const { colors } = useColors();
    const [selected_chapter_id, set_selected_chapter_id] = useState(DEFAULT_TOUR_CHAPTER_ID);
    const selected_chapter = TOUR_CHAPTERS[selected_chapter_id];
    const selected_chapter_state = completed_chapters[selected_chapter_id];
    const completed_text = selected_chapter_state?.status === "skipped" ? "Skipped" : "Completed";

    return (
        <div
            className="fixed bottom-3 left-3 z-[90] flex max-w-[calc(100vw-1rem)] items-center gap-2 rounded-lg border px-2 py-1 text-sm shadow-lg"
            data-tour="tour-launcher"
            style={{
                color: colors.theme.text,
                backgroundColor: colors.theme.background,
                borderColor: colors.theme.borders,
            }}
        >
            <select
                className="h-8 rounded px-2 text-sm"
                value={selected_chapter_id}
                onChange={event => set_selected_chapter_id(event.target.value)}
                aria-label="Tour chapter"
                title={selected_chapter?.description}
                style={{
                    color: colors.theme.text,
                    backgroundColor: colors.theme.input_background,
                    border: `1px solid ${colors.theme.borders}`,
                }}
            >
                {Object.values(TOUR_CHAPTERS).map(chapter => (
                    <option key={chapter.id} value={chapter.id}>
                        {completed_chapters[chapter.id] ? "Done - " : ""}
                        {chapter.title}
                    </option>
                ))}
            </select>
            {selected_chapter?.description && (
                <span className="hidden max-w-64 truncate text-xs opacity-75 md:block">
                    {selected_chapter.description}
                </span>
            )}
            {selected_chapter_state && (
                <span className="hidden text-xs font-semibold opacity-80 sm:block">
                    {completed_text}
                </span>
            )}
            <button
                type="button"
                className="h-8 rounded px-3 font-semibold hover:brightness-110"
                onClick={() => on_start_tour(selected_chapter_id)}
                style={{
                    color: "white",
                    backgroundColor: "#2563eb",
                }}
            >
                {selected_chapter_state ? "Restart" : "Tour"}
            </button>
        </div>
    );
}

export default TourLauncher;
