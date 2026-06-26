import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("virtual:cty-dxcc-entities", () => ({
    default: ["United States", "Fed. Rep. of Germany", "Canada"],
    dxcc_entities_by_code: {
        1: { code: 1, raw_cty_name: "Canada", continent: "NA" },
        230: { code: 230, raw_cty_name: "Fed. Rep. of Germany", continent: "EU" },
        291: { code: 291, raw_cty_name: "United States", continent: "NA" },
    },
    dxcc_code_entities: {
        1: "Canada",
        230: "Fed. Rep. of Germany",
        291: "United States",
    },
}));

import HunterPanel from "@/components/HunterPanel.jsx";
import { ColorsProvider } from "@/hooks/useColors.jsx";
import { ProfilesProvider } from "@/hooks/useProfiles.jsx";
import {
    PROFILE_STORE_KEY,
    PROFILE_STORE_VERSION,
    create_default_profile_data,
} from "@/utils/profile_data.js";

function render_hunter_panel(profile_data = create_default_profile_data()) {
    window.localStorage.setItem(
        PROFILE_STORE_KEY,
        JSON.stringify({
            version: PROFILE_STORE_VERSION,
            active_profile_name: "Default",
            profiles: [{ name: "Default", data: profile_data }],
        }),
    );

    return render(
        <MemoryRouter>
            <ProfilesProvider>
                <ColorsProvider>
                    <HunterPanel />
                </ColorsProvider>
            </ProfilesProvider>
        </MemoryRouter>,
    );
}

function section_by_heading(name) {
    return screen.getByRole("heading", { name }).closest("section");
}

describe("HunterPanel", () => {
    beforeEach(() => {
        window.localStorage.clear();
    });

    afterEach(() => {
        cleanup();
        window.localStorage.clear();
    });

    it("shows section summaries and toggles a hunter section", async () => {
        const user = userEvent.setup();
        render_hunter_panel();

        const dxcc_section = section_by_heading("DXCC");
        expect(within(dxcc_section).getByText("0/3 done, 3 needed")).toBeTruthy();
        expect(within(dxcc_section).getByText("Disabled")).toBeTruthy();

        const dxcc_toggle = within(dxcc_section).getByRole("switch");
        expect(dxcc_toggle.getAttribute("aria-checked")).toBe("false");

        await user.click(dxcc_toggle);

        await waitFor(() => {
            expect(dxcc_toggle.getAttribute("aria-checked")).toBe("true");
            expect(within(dxcc_section).getByText("Enabled")).toBeTruthy();
        });
    });

    it("opens a section edit modal", async () => {
        const user = userEvent.setup();
        render_hunter_panel();

        const dxcc_section = section_by_heading("DXCC");
        await user.click(within(dxcc_section).getByRole("button", { name: "Edit" }));

        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getAllByRole("heading", { name: "DXCC" }).length).toBeGreaterThan(0);
        expect(within(dialog).getByText("0/3 complete, 3 missing")).toBeTruthy();
        expect(within(dialog).getByText("Germany")).toBeTruthy();
    });

    it("manually marks items complete and incomplete from the edit modal", async () => {
        const user = userEvent.setup();
        render_hunter_panel();

        const dxcc_section = section_by_heading("DXCC");
        await user.click(within(dxcc_section).getByRole("button", { name: "Edit" }));
        const dialog = await screen.findByRole("dialog");

        await user.click(within(dialog).getByRole("button", { name: "Mark Germany complete" }));

        await waitFor(() => {
            expect(within(dialog).getByText("1/3 complete, 2 missing")).toBeTruthy();
            expect(within(dxcc_section).getByText("1/3 done, 2 needed")).toBeTruthy();
        });
        expect(within(dialog).queryByText("Germany")).toBeNull();

        await user.click(within(dialog).getByRole("button", { name: "Completed" }));
        expect(within(dialog).getByText("Germany")).toBeTruthy();

        await user.click(within(dialog).getByRole("button", { name: "Mark Germany incomplete" }));

        await waitFor(() => {
            expect(within(dialog).getByText("0/3 complete, 3 missing")).toBeTruthy();
            expect(within(dxcc_section).getByText("0/3 done, 3 needed")).toBeTruthy();
        });
    });

    it("clears completed items in one section from the edit modal", async () => {
        const user = userEvent.setup();
        render_hunter_panel();

        const dxcc_section = section_by_heading("DXCC");
        await user.click(within(dxcc_section).getByRole("button", { name: "Edit" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).queryByRole("button", { name: "Clear" })).toBeNull();

        await user.click(within(dialog).getByRole("button", { name: "Mark Germany complete" }));
        await user.click(within(dialog).getByRole("button", { name: "Completed" }));

        const clear_button = within(dialog).getByRole("button", { name: "Clear" });
        await waitFor(() => expect(clear_button.disabled).toBe(false));
        await user.click(clear_button);

        const clear_dialog = screen.getByText("Clear Completed").closest('[role="dialog"]');
        expect(within(clear_dialog).getByText(/Clear 1 completed DXCC item/)).toBeTruthy();
        expect(within(dxcc_section).getByText("1/3 done, 2 needed")).toBeTruthy();

        await user.click(within(clear_dialog).getByRole("button", { name: "Clear" }));

        await waitFor(() => {
            expect(within(dialog).getByText("0/3 complete, 3 missing")).toBeTruthy();
            expect(within(dxcc_section).getByText("0/3 done, 3 needed")).toBeTruthy();
        });
        await user.click(within(dialog).getByRole("button", { name: "Missing" }));
        expect(within(dialog).getByText("Germany")).toBeTruthy();
        await user.click(within(dialog).getByRole("button", { name: "Completed" }));
        expect(within(dialog).getByRole("button", { name: "Clear" }).disabled).toBe(true);
    });

    it("filters the visible list from the edit modal", async () => {
        const user = userEvent.setup();
        render_hunter_panel();

        const states_section = section_by_heading("US States");
        await user.click(within(states_section).getByRole("button", { name: "Edit" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText("AL - Alabama")).toBeTruthy();

        await user.type(within(dialog).getByPlaceholderText("Search US States"), "District");

        expect(within(dialog).getByText("DC - District of Columbia")).toBeTruthy();
        expect(within(dialog).queryByText("AL - Alabama")).toBeNull();
    });

    it("shows completed section progress in summaries and edit modal", async () => {
        const user = userEvent.setup();
        const profile_data = create_default_profile_data();
        profile_data.hunter.worked.cq_zone.global = Array.from(
            { length: 40 },
            (_, index) => index + 1,
        );

        render_hunter_panel(profile_data);

        const cq_section = section_by_heading("CQ Zones");
        expect(within(cq_section).getByText("40/40 done, 0 needed")).toBeTruthy();

        await user.click(within(cq_section).getByRole("button", { name: "Edit" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByRole("img", { name: "Trophy" })).toBeTruthy();
        expect(within(dialog).getByText("No CQ zones left")).toBeTruthy();
        expect(within(dialog).getByText("Well done!")).toBeTruthy();
        expect(within(dialog).queryByText("No missing items match.")).toBeNull();
    });

    it("shows recent import metadata", () => {
        const profile_data = create_default_profile_data();
        profile_data.hunter.imports = [
            {
                file_name: "old.adi",
                imported_at: 123,
                qso_count: 12,
                added_counts: {
                    dxcc: 1,
                    cq_zone: 1,
                    itu_zone: 0,
                    us_state: 1,
                    ca_province: 0,
                },
                skipped_count: 0,
                resolved_count: 2,
                unresolved_count: 1,
                conflict_count: 0,
            },
        ];

        render_hunter_panel(profile_data);

        expect(screen.getByText("old.adi")).toBeTruthy();
        expect(screen.getByText("12 QSOs, 3 added, 1 unresolved")).toBeTruthy();
    });
});
