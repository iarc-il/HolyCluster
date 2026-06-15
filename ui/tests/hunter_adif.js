import { describe, expect, it, vi } from "vitest";

vi.mock("virtual:cty-dxcc-entities", () => ({
    default: ["United States", "Fed. Rep. of Germany", "Canada", "Alaska", "Hawaii"],
    dxcc_code_entities: {
        1: "Canada",
        6: "Alaska",
        110: "Hawaii",
        230: "Fed. Rep. of Germany",
        291: "United States",
    },
}));

import {
    HUNTER_ADIF_MAX_FILE_SIZE_BYTES,
    HUNTER_ADIF_MAX_QSO_RECORDS,
    HunterAdifImportError,
    import_hunter_adif,
} from "@/utils/hunter_adif.js";
import { import_hunter_adif_in_worker } from "@/utils/hunter_adif_worker_client.js";
import { create_default_hunter } from "@/utils/profile_data.js";

function adif_record(fields) {
    return `${Object.entries(fields)
        .map(([field, value]) => `<${field}:${value.toString().length}>${value}`)
        .join("")}<EOR>`;
}

function failing_resolver() {
    throw new Error("resolver should not be called");
}

describe("hunter_adif", () => {
    it("parses direct ADIF records and records import metadata", async () => {
        const result = await import_hunter_adif({
            adif_text: adif_record({
                CALL: "K1ABC",
                DXCC: "291",
                COUNTRY: "United States",
                CQZ: "5",
                ITUZ: "8",
                STATE: "CA",
            }),
            file_name: "basic.adi",
            imported_at: 123,
            resolve_callsigns: failing_resolver,
        });

        expect(result.hunter.worked.dxcc.global).toEqual(["USA"]);
        expect(result.hunter.worked.cq_zone.global).toEqual([5]);
        expect(result.hunter.worked.itu_zone.global).toEqual([8]);
        expect(result.hunter.worked.us_state.global).toEqual(["CA"]);
        expect(result.metadata).toEqual({
            file_name: "basic.adi",
            imported_at: 123,
            qso_count: 1,
            added_counts: {
                dxcc: 1,
                cq_zone: 1,
                itu_zone: 1,
                us_state: 1,
                ca_province: 0,
            },
            skipped_count: 0,
            resolved_count: 0,
            unresolved_count: 0,
            conflict_count: 0,
        });
        expect(result.hunter.imports).toEqual([result.metadata]);
    });

    it("uses ADIF DXCC over COUNTRY and counts conflicts", async () => {
        const result = await import_hunter_adif({
            adif_text: adif_record({
                CALL: "DL1ABC",
                DXCC: "230",
                COUNTRY: "United States",
                CQZ: "14",
                ITUZ: "28",
            }),
            resolve_callsigns: failing_resolver,
        });

        expect(result.hunter.worked.dxcc.global).toEqual(["Germany"]);
        expect(result.hunter.worked.cq_zone.global).toEqual([14]);
        expect(result.metadata.conflict_count).toBe(1);
    });

    it("skips no-call records for inference while keeping direct fields", async () => {
        const result = await import_hunter_adif({
            adif_text: [adif_record({ DXCC: "291" }), adif_record({ BAND: "20" })].join(""),
            resolve_callsigns: failing_resolver,
        });

        expect(result.hunter.worked.dxcc.global).toEqual(["USA"]);
        expect(result.metadata.qso_count).toBe(2);
        expect(result.metadata.skipped_count).toBe(1);
        expect(result.metadata.unresolved_count).toBe(0);
    });

    it("merges resolver features into existing worked state without replacing", async () => {
        const hunter = create_default_hunter();
        hunter.worked.dxcc.global = ["USA"];
        hunter.imports = [{ file_name: "old.adi", imported_at: 1 }];
        const resolved_batches = [];

        const result = await import_hunter_adif({
            hunter,
            adif_text: [adif_record({ CALL: "VE3XYZ" }), adif_record({ CALL: "VE3XYZ" })].join(""),
            imported_at: 456,
            resolve_callsigns: async callsigns => {
                resolved_batches.push(callsigns);
                return {
                    results: {
                        VE3XYZ: {
                            country: "Canada",
                            state: "ON",
                            cq_zone: 4,
                            itu_zone: 4,
                            lon: -79.38,
                            lat: 43.65,
                        },
                    },
                    errors: {},
                };
            },
        });

        expect(resolved_batches).toEqual([["VE3XYZ"]]);
        expect(result.hunter.worked.dxcc.global).toEqual(["USA", "Canada"]);
        expect(result.hunter.worked.cq_zone.global).toEqual([4]);
        expect(result.hunter.worked.itu_zone.global).toEqual([4]);
        expect(result.hunter.worked.ca_province.global).toEqual(["ON"]);
        expect(result.metadata.added_counts.dxcc).toBe(1);
        expect(result.metadata.resolved_count).toBe(1);
        expect(result.hunter.imports).toHaveLength(2);
    });

    it("reports resolver progress by 100-callsign batches", async () => {
        const resolved_batches = [];
        const progress = [];
        const adif_text = Array.from({ length: 250 }, (_, index) =>
            adif_record({ CALL: `K${index}ABC` }),
        ).join("");

        const result = await import_hunter_adif({
            adif_text,
            resolve_callsigns: async callsigns => {
                resolved_batches.push(callsigns);
                return {
                    results: Object.fromEntries(
                        callsigns.map(callsign => [
                            callsign,
                            {
                                country: "USA",
                                state: "CA",
                                cq_zone: 3,
                                itu_zone: 6,
                            },
                        ]),
                    ),
                    errors: {},
                };
            },
            on_progress: update => progress.push(update),
        });

        expect(resolved_batches.map(batch => batch.length)).toEqual([100, 100, 50]);
        expect(progress.map(update => update.phase)).toEqual([
            "parsing",
            "processing",
            "resolving",
            "resolving",
            "resolving",
            "resolving",
            "merging",
            "complete",
        ]);
        expect(progress.filter(update => update.phase === "resolving")).toEqual([
            { phase: "resolving", completed: 0, total: 250, percentage: 0 },
            { phase: "resolving", completed: 100, total: 250, percentage: 40 },
            { phase: "resolving", completed: 200, total: 250, percentage: 80 },
            { phase: "resolving", completed: 250, total: 250, percentage: 100 },
        ]);
        expect(result.metadata.resolved_count).toBe(250);
    });

    it("worker client falls back when a custom resolver is supplied", async () => {
        const result = await import_hunter_adif_in_worker({
            adif_text: adif_record({ CALL: "K1ABC" }),
            resolve_callsigns: async () => ({
                results: {
                    K1ABC: {
                        country: "USA",
                        state: "CA",
                        cq_zone: 3,
                        itu_zone: 6,
                    },
                },
                errors: {},
            }),
        });

        expect(result.hunter.worked.dxcc.global).toEqual(["USA"]);
        expect(result.metadata.resolved_count).toBe(1);
    });

    it("uses direct state over resolver state and coordinate inference", async () => {
        const result = await import_hunter_adif({
            adif_text: adif_record({ CALL: "K1ABC", COUNTRY: "United States", STATE: "CA" }),
            resolve_callsigns: async () => ({
                results: {
                    K1ABC: {
                        country: "USA",
                        state: "NY",
                        cq_zone: 5,
                        itu_zone: 8,
                        lon: -73.9,
                        lat: 40.7,
                    },
                },
                errors: {},
            }),
        });

        expect(result.hunter.worked.dxcc.global).toEqual(["USA"]);
        expect(result.hunter.worked.us_state.global).toEqual(["CA"]);
        expect(result.hunter.worked.cq_zone.global).toEqual([5]);
        expect(result.metadata.resolved_count).toBe(1);
    });

    it("infers US and Canada state/province from resolver coordinates", async () => {
        const result = await import_hunter_adif({
            adif_text: [adif_record({ CALL: "K1ABC" }), adif_record({ CALL: "VE3XYZ" })].join(""),
            resolve_callsigns: async () => ({
                results: {
                    K1ABC: {
                        country: "USA",
                        state: "",
                        cq_zone: 3,
                        itu_zone: 6,
                        lon: -122.4,
                        lat: 37.7,
                    },
                    VE3XYZ: {
                        country: "Canada",
                        state: "",
                        cq_zone: 4,
                        itu_zone: 4,
                        lon: -79.38,
                        lat: 43.65,
                    },
                },
                errors: {},
            }),
        });

        expect(result.hunter.worked.us_state.global).toEqual(["CA"]);
        expect(result.hunter.worked.ca_province.global).toEqual(["ON"]);
    });

    it("continues import when some callsigns fail resolution", async () => {
        const result = await import_hunter_adif({
            adif_text: [adif_record({ CALL: "K1ABC" }), adif_record({ CALL: "BAD" })].join(""),
            resolve_callsigns: async () => ({
                results: {
                    K1ABC: {
                        country: "USA",
                        state: "CA",
                        cq_zone: 3,
                        itu_zone: 6,
                        lon: -122.4,
                        lat: 37.7,
                    },
                },
                errors: { BAD: "not found" },
            }),
        });

        expect(result.hunter.worked.dxcc.global).toEqual(["USA"]);
        expect(result.metadata.resolved_count).toBe(1);
        expect(result.metadata.unresolved_count).toBe(1);
        expect(result.resolver_errors).toEqual({ BAD: "not found" });
    });

    it("rejects empty ADIF imports", async () => {
        for (const adif_text of ["", "   \n\t"]) {
            await expect(
                import_hunter_adif({
                    adif_text,
                    resolve_callsigns: failing_resolver,
                }),
            ).rejects.toThrow(HunterAdifImportError);
            await expect(
                import_hunter_adif({
                    adif_text,
                    resolve_callsigns: failing_resolver,
                }),
            ).rejects.toThrow("ADIF file is empty.");
        }
    });

    it("rejects text and binary-looking files that do not look like ADIF", async () => {
        for (const adif_text of ["not an adif", `\u007fELF${"a".repeat(1000)}<bad>`]) {
            await expect(
                import_hunter_adif({
                    adif_text,
                    resolve_callsigns: failing_resolver,
                }),
            ).rejects.toThrow(HunterAdifImportError);
            await expect(
                import_hunter_adif({
                    adif_text,
                    resolve_callsigns: failing_resolver,
                }),
            ).rejects.toThrow("Selected file does not look like an ADIF file.");
        }
    });

    it("rejects ADIF-like files without QSO records", async () => {
        await expect(
            import_hunter_adif({
                adif_text: "<EOH>",
                resolve_callsigns: failing_resolver,
            }),
        ).rejects.toThrow("ADIF file does not contain any QSO records.");
    });

    it("hides raw parser details for malformed ADIF", async () => {
        await expect(
            import_hunter_adif({
                adif_text: "<CALL:5>ABC<EOR><BAD>",
                resolve_callsigns: failing_resolver,
            }),
        ).rejects.toThrow(
            "Could not parse ADIF file. Make sure it is a text .adi or .adif export.",
        );

        await expect(
            import_hunter_adif({
                adif_text: "<CALL:5>ABC<EOR><BAD>",
                resolve_callsigns: failing_resolver,
            }),
        ).rejects.not.toThrow("BAD>");
    });

    it("respects file and record limits", async () => {
        await expect(
            import_hunter_adif({
                adif_text: "",
                file_size: HUNTER_ADIF_MAX_FILE_SIZE_BYTES + 1,
            }),
        ).rejects.toThrow(HunterAdifImportError);

        const too_many_records = Array.from({ length: HUNTER_ADIF_MAX_QSO_RECORDS + 1 }, () =>
            adif_record({ CALL: "K" }),
        ).join("");

        await expect(
            import_hunter_adif({
                adif_text: too_many_records,
                resolve_callsigns: failing_resolver,
            }),
        ).rejects.toThrow(HunterAdifImportError);
    });
});
