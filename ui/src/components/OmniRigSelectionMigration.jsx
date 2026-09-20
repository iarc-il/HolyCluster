import { useProfiles } from "@/hooks/useProfiles.jsx";
import useRadio from "@/hooks/useRadio";
import { useEffect, useRef } from "react";

export default function OmniRigSelectionMigration() {
    const { omnirig_migration_candidate, clear_omnirig_migration_evidence } = useProfiles();
    const { radio_capabilities, migrate_omnirig_selection } = useRadio();
    const attempted_rig = useRef(null);

    useEffect(() => {
        if (
            omnirig_migration_candidate == null ||
            radio_capabilities?.omnirig_selection_migration_available !== true ||
            attempted_rig.current === omnirig_migration_candidate
        ) {
            return;
        }
        attempted_rig.current = omnirig_migration_candidate;
        const expected_model_id = `omnirig:${omnirig_migration_candidate}`;
        void migrate_omnirig_selection(omnirig_migration_candidate).then(result => {
            if (
                result.ok === true &&
                result.migrated === true &&
                result.effective_model_id === expected_model_id
            ) {
                clear_omnirig_migration_evidence();
            }
        });
    }, [
        omnirig_migration_candidate,
        radio_capabilities?.omnirig_selection_migration_available,
        migrate_omnirig_selection,
        clear_omnirig_migration_evidence,
    ]);

    return null;
}
