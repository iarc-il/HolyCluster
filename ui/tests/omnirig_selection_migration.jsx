import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ profiles: null, radio: null }));
vi.mock("@/hooks/useProfiles.jsx", () => ({ useProfiles: () => state.profiles }));
vi.mock("@/hooks/useRadio", () => ({ default: () => state.radio }));

import OmniRigSelectionMigration from "@/components/OmniRigSelectionMigration.jsx";

describe("OmniRig selection migration", () => {
    beforeEach(() => {
        state.profiles = {
            omnirig_migration_candidate: 2,
            clear_omnirig_migration_evidence: vi.fn(),
        };
        state.radio = {
            radio_capabilities: { omnirig_selection_migration_available: true },
            migrate_omnirig_selection: vi.fn(),
        };
    });

    afterEach(() => cleanup());

    it("cleans evidence only after a matching successful acknowledgement", async () => {
        let resolve_migration;
        state.radio.migrate_omnirig_selection.mockReturnValue(
            new Promise(resolve => (resolve_migration = resolve)),
        );
        render(<OmniRigSelectionMigration />);

        expect(state.radio.migrate_omnirig_selection).toHaveBeenCalledWith(2);
        await act(async () => {
            resolve_migration({
                ok: true,
                migrated: true,
                effective_model_id: "omnirig:2",
            });
        });
        expect(state.profiles.clear_omnirig_migration_evidence).toHaveBeenCalledOnce();
    });

    it("leaves evidence untouched for unavailable or mismatched migrations", async () => {
        state.radio.radio_capabilities.omnirig_selection_migration_available = false;
        const view = render(<OmniRigSelectionMigration />);
        expect(state.radio.migrate_omnirig_selection).not.toHaveBeenCalled();

        state.radio.radio_capabilities.omnirig_selection_migration_available = true;
        state.radio.migrate_omnirig_selection.mockResolvedValue({
            ok: true,
            migrated: true,
            effective_model_id: "omnirig:1",
        });
        view.rerender(<OmniRigSelectionMigration />);
        await act(async () => {});
        expect(state.profiles.clear_omnirig_migration_evidence).not.toHaveBeenCalled();
    });
});
