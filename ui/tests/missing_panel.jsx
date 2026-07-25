import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const import_missing_adif_in_worker = vi.hoisted(() => vi.fn());

vi.mock("@/utils/missing_adif_worker_client.js", () => ({
    import_missing_adif_in_worker,
}));

vi.mock("virtual:cty-dxcc-entities", () => ({
    default: ["United States", "Fed. Rep. of Germany", "Canada"],
    dxcc_entities_by_code: {
        1: { code: 1, raw_cty_name: "Canada", continent: "NA" },
        230: { code: 230, raw_cty_name: "Fed. Rep. of Germany", continent: "EU" },
        291: { code: 291, raw_cty_name: "United States", continent: "NA" },
        999: { code: 999, raw_cty_name: "Albania", continent: "EU" },
    },
    dxcc_code_entities: {
        1: "Canada",
        230: "Fed. Rep. of Germany",
        291: "United States",
        999: "Albania",
    },
}));

import MissingPanel from "@/components/MissingPanel.jsx";
import { ColorsProvider } from "@/hooks/useColors.jsx";
import { ProfilesProvider } from "@/hooks/useProfiles.jsx";
import {
    PROFILE_STORE_KEY,
    PROFILE_STORE_VERSION,
    create_default_profile_data,
} from "@/utils/profile_data.js";

function render_missing_panel(profile_data = create_default_profile_data(), props = {}) {
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
                    <MissingPanel {...props} />
                </ColorsProvider>
            </ProfilesProvider>
        </MemoryRouter>,
    );
}

function section_by_heading(name) {
    return screen.getByRole("heading", { name }).closest("section");
}

function expect_section_stats(container, { worked, needed, total }) {
    const scoped = within(container);
    expect(scoped.getByLabelText(`${worked} worked`)).toBeTruthy();
    expect(scoped.getByLabelText(`${needed} needed`)).toBeTruthy();
    expect(scoped.getByLabelText(`${total} total`)).toBeTruthy();
}

function expect_before(first, second) {
    expect(first.compareDocumentPosition(second)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
}

describe("MissingPanel", () => {
    beforeEach(() => {
        window.localStorage.clear();
        import_missing_adif_in_worker.mockReset();
    });

    afterEach(() => {
        cleanup();
        window.localStorage.clear();
    });

    it("shows section summaries", () => {
        render_missing_panel();

        const dxcc_section = section_by_heading("DXCC");
        expect_section_stats(dxcc_section, { worked: 0, needed: 4, total: 4 });
        expect(within(dxcc_section).getByRole("button", { name: "Edit" })).toBeTruthy();
        expect(within(dxcc_section).queryByRole("switch")).toBeNull();
    });

    it("opens a section edit modal", async () => {
        const user = userEvent.setup();
        render_missing_panel();

        const dxcc_section = section_by_heading("DXCC");
        await user.click(within(dxcc_section).getByRole("button", { name: "Edit" }));

        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getAllByRole("heading", { name: "DXCC" }).length).toBeGreaterThan(0);
        expect(within(dialog).queryByLabelText("0 worked")).toBeNull();
        expect(within(dialog).queryByLabelText("4 needed")).toBeNull();
        expect_before(within(dialog).getByText("Albania"), within(dialog).getByText("Canada"));
        expect_before(within(dialog).getByText("Canada"), within(dialog).getByText("Germany"));
        expect(within(dialog).getByText("Germany")).toBeTruthy();
        expect(within(dialog).queryByRole("switch")).toBeNull();
        expect(within(dialog).getByRole("button", { name: "Apply" })).toBeTruthy();
        expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeTruthy();
    });

    it("applies section edits from the edit modal", async () => {
        const user = userEvent.setup();
        render_missing_panel();

        const dxcc_section = section_by_heading("DXCC");
        await user.click(within(dxcc_section).getByRole("button", { name: "Edit" }));
        const dialog = await screen.findByRole("dialog");

        const mark_worked_button = within(dialog).getByRole("button", {
            name: "Mark Germany as Worked",
        });
        expect(mark_worked_button.className).toContain("bg-orange-600");
        await user.click(mark_worked_button);

        await waitFor(() => {
            expect(within(dialog).queryByText("Germany")).toBeNull();
            expect_section_stats(dxcc_section, { worked: 0, needed: 4, total: 4 });
        });

        await user.click(within(dialog).getByRole("button", { name: "Apply" }));

        await waitFor(() => {
            expect(screen.queryByRole("dialog")).toBeNull();
            expect_section_stats(dxcc_section, { worked: 1, needed: 3, total: 4 });
        });

        await user.click(within(dxcc_section).getByRole("button", { name: "Edit" }));
        const reopened_dialog = await screen.findByRole("dialog");
        await user.click(within(reopened_dialog).getByRole("button", { name: "Worked" }));
        expect(within(reopened_dialog).getByText("Germany")).toBeTruthy();

        const remove_worked_button = within(reopened_dialog).getByRole("button", {
            name: "Remove Germany from Worked",
        });
        expect(remove_worked_button.textContent).toBe("Remove from Worked");
        expect(remove_worked_button.className).toContain("text-red-500");
        await user.click(remove_worked_button);
        await user.click(within(reopened_dialog).getByRole("button", { name: "Apply" }));

        await waitFor(() => {
            expect(screen.queryByRole("dialog")).toBeNull();
            expect_section_stats(dxcc_section, { worked: 0, needed: 4, total: 4 });
        });
    });

    it("cancels section edit drafts", async () => {
        const user = userEvent.setup();
        render_missing_panel();

        const dxcc_section = section_by_heading("DXCC");
        await user.click(within(dxcc_section).getByRole("button", { name: "Edit" }));
        const dialog = await screen.findByRole("dialog");

        await user.click(within(dialog).getByRole("button", { name: "Mark Germany as Worked" }));

        await waitFor(() => expect(within(dialog).queryByText("Germany")).toBeNull());
        expect_section_stats(dxcc_section, { worked: 0, needed: 4, total: 4 });

        await user.click(within(dialog).getByRole("button", { name: "Cancel" }));

        await waitFor(() => {
            expect(screen.queryByRole("dialog")).toBeNull();
            expect_section_stats(dxcc_section, { worked: 0, needed: 4, total: 4 });
        });

        await user.click(within(dxcc_section).getByRole("button", { name: "Edit" }));
        const reopened_dialog = await screen.findByRole("dialog");
        expect(within(reopened_dialog).getByText("Germany")).toBeTruthy();
        expect(within(reopened_dialog).queryByRole("switch")).toBeNull();
    });

    it("clears worked items in one section from the edit modal", async () => {
        const user = userEvent.setup();
        const profile_data = create_default_profile_data();
        profile_data.missing.worked.dxcc.global = [230];
        render_missing_panel(profile_data);

        const dxcc_section = section_by_heading("DXCC");
        expect_section_stats(dxcc_section, { worked: 1, needed: 3, total: 4 });

        await user.click(within(dxcc_section).getByRole("button", { name: "Edit" }));
        const dialog = await screen.findByRole("dialog");
        await user.click(within(dialog).getByRole("button", { name: "Worked" }));

        const clear_button = within(dialog).getByRole("button", { name: "Clear" });
        await waitFor(() => expect(clear_button.disabled).toBe(false));
        await user.click(clear_button);

        expect(within(dialog).getByText(/Clear 1 worked DXCC item/)).toBeTruthy();
        expect(screen.getAllByRole("dialog")).toHaveLength(1);

        await user.click(within(dialog).getByRole("button", { name: "Clear" }));

        await waitFor(() => {
            expect(within(dialog).queryByText("Germany")).toBeNull();
            expect_section_stats(dxcc_section, { worked: 1, needed: 3, total: 4 });
        });
        await user.click(within(dialog).getByRole("button", { name: "Needed" }));
        expect(within(dialog).getByText("Germany")).toBeTruthy();
        await user.click(within(dialog).getByRole("button", { name: "Worked" }));
        expect(within(dialog).getByRole("button", { name: "Clear" }).disabled).toBe(true);

        await user.click(within(dialog).getByRole("button", { name: "Apply" }));

        await waitFor(() => {
            expect(screen.queryByRole("dialog")).toBeNull();
            expect_section_stats(dxcc_section, { worked: 0, needed: 4, total: 4 });
        });
    });

    it("filters the visible list from the edit modal", async () => {
        const user = userEvent.setup();
        render_missing_panel();

        const states_section = section_by_heading("US");
        await user.click(within(states_section).getByRole("button", { name: "Edit" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText("AL - Alabama")).toBeTruthy();

        await user.type(within(dialog).getByPlaceholderText("Search US"), "District");

        expect(within(dialog).getByText("DC - District of Columbia")).toBeTruthy();
        expect(within(dialog).queryByText("AL - Alabama")).toBeNull();
    });

    it("shows worked section progress in summaries and edit modal", async () => {
        const user = userEvent.setup();
        const profile_data = create_default_profile_data();
        profile_data.missing.worked.cq_zone.global = Array.from(
            { length: 40 },
            (_, index) => index + 1,
        );

        render_missing_panel(profile_data);

        const cq_section = section_by_heading("CQ");
        expect_section_stats(cq_section, { worked: 40, needed: 0, total: 40 });
        expect(within(cq_section).getByRole("img", { name: "Trophy" })).toBeTruthy();
        expect(within(cq_section).getByText("No CQ zones left")).toBeTruthy();

        await user.click(within(cq_section).getByRole("button", { name: "Edit" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByRole("img", { name: "Trophy" })).toBeTruthy();
        expect(within(dialog).getByText("No CQ zones left")).toBeTruthy();
        expect(within(dialog).getByText("All worked!")).toBeTruthy();
        expect(within(dialog).queryByText("No needed items match.")).toBeNull();
    });

    it("shows recent import metadata", () => {
        const profile_data = create_default_profile_data();
        profile_data.missing.imports = [
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

        render_missing_panel(profile_data);

        expect(screen.getByText("old.adi")).toBeTruthy();
        expect(screen.getByText("12 QSOs, 3 added, 1 unresolved")).toBeTruthy();
    });

    it("deletes all missing data after confirmation", async () => {
        const user = userEvent.setup();
        const profile_data = create_default_profile_data();
        profile_data.missing.worked.dxcc.global = [230];
        profile_data.missing.imports = [
            {
                file_name: "old.adi",
                imported_at: 123,
                qso_count: 1,
                added_counts: {},
                unresolved_count: 0,
            },
        ];
        render_missing_panel(profile_data);

        const delete_button = screen.getByRole("button", { name: "Delete All" });
        const import_button = screen.getByRole("button", { name: "Import ADIF" });
        expect_before(import_button, delete_button);

        await user.click(delete_button);
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByRole("heading", { name: "Are you sure?" })).toBeTruthy();
        await user.click(within(dialog).getByRole("button", { name: "Delete All" }));

        await waitFor(() => {
            expect(screen.queryByRole("dialog")).toBeNull();
            expect_section_stats(section_by_heading("DXCC"), {
                worked: 0,
                needed: 4,
                total: 4,
            });
            expect(screen.queryByText("old.adi")).toBeNull();
        });
        const stored_profiles = JSON.parse(window.localStorage.getItem(PROFILE_STORE_KEY));
        expect(stored_profiles.profiles[0].data.missing).toEqual(
            create_default_profile_data().missing,
        );
    });

    it("reports a completed ADIF import after saving it", async () => {
        const user = userEvent.setup();
        const profile_data = create_default_profile_data();
        const imported_missing = {
            ...profile_data.missing,
            imports: [{ file_name: "upload.adi", imported_at: 123 }],
        };
        const on_import_complete = vi.fn();
        import_missing_adif_in_worker.mockResolvedValue({ missing: imported_missing });
        render_missing_panel(profile_data, { on_import_complete });

        await user.upload(
            screen.getByTestId("missing-adif-input"),
            new File(["<CALL:5>K1ABC<EOR>"], "upload.adi", { type: "text/plain" }),
        );

        await waitFor(() => expect(on_import_complete).toHaveBeenCalledOnce());
        expect(import_missing_adif_in_worker).toHaveBeenCalledWith(
            expect.objectContaining({
                missing: profile_data.missing,
                adif_text: "<CALL:5>K1ABC<EOR>",
                file_name: "upload.adi",
            }),
        );
        const stored_profiles = JSON.parse(window.localStorage.getItem(PROFILE_STORE_KEY));
        expect(stored_profiles.profiles[0].data.missing.imports[0]).toEqual(
            expect.objectContaining({ file_name: "upload.adi", imported_at: 123 }),
        );
    });

    it("does not report a failed ADIF import as complete", async () => {
        const user = userEvent.setup();
        const on_import_complete = vi.fn();
        import_missing_adif_in_worker.mockRejectedValue(new Error("Import failed"));
        render_missing_panel(create_default_profile_data(), { on_import_complete });

        await user.upload(
            screen.getByTestId("missing-adif-input"),
            new File(["invalid"], "upload.adi", { type: "text/plain" }),
        );

        expect(await screen.findByText("Import failed")).toBeTruthy();
        expect(on_import_complete).not.toHaveBeenCalled();
    });
});
