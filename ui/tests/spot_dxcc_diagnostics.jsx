import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const websocket = vi.hoisted(() => ({
    handler: null,
    subscribe: (_type, handler) => {
        websocket.handler = handler;
        return () => {};
    },
}));
const predicates = vi.hoisted(() => ({ calls: [], failure: null }));
const diagnostics = vi.hoisted(() => ({ fail: false }));
const zones = vi.hoisted(() => ({ failure: null }));

vi.mock("@/hooks/useWs", () => ({
    ReadyState: { OPEN: 1 },
    useWs: () => ({
        readyState: 0,
        spot_socket_epoch: null,
        transport: "unified",
        subscribe: websocket.subscribe,
        send_now: () => true,
        now_ms: () => Date.now(),
        clock_revision: 0,
    }),
}));
vi.mock("@/utils/live_spot_snapshot.js", () => ({
    read_live_spot_snapshot: () => [],
    write_live_spot_snapshot: async () => {},
}));
vi.mock("@/data/dxcc_entities.js", async importOriginal => {
    const original = await importOriginal();
    function invoke(predicate, value, check) {
        predicates.calls.push({ predicate, value });
        if (predicates.failure?.predicate === predicate && predicates.failure.value === value) {
            throw predicates.failure.error;
        }
        return check(value);
    }
    return {
        ...original,
        get_dxcc_label: value => invoke("label", value, original.get_dxcc_label),
        is_us_state_dxcc_code: value => invoke("us_state", value, original.is_us_state_dxcc_code),
        is_canada_dxcc_code: value => invoke("canada", value, original.is_canada_dxcc_code),
    };
});
vi.mock("@/sentry.js", async importOriginal => {
    const original = await importOriginal();
    return {
        ...original,
        annotateDiagnosticError: (error, evidence) => {
            if (diagnostics.fail) throw new Error("annotation failed");
            return original.annotateDiagnosticError(error, evidence);
        },
    };
});
vi.mock("@/utils/zones.js", () => ({
    find_zone_number: type => {
        if (zones.failure === type) throw new Error("zone lookup failed");
        return type;
    },
}));

import useSpotWebSocket, { enrich_spot_zones_if_missing } from "@/hooks/useSpotWebSocket.js";
import { annotateDiagnosticError, prepareSentryEvent } from "@/sentry.js";
import { get_spot_dxcc_display } from "@/utils/spot_dxcc.js";

const base_spot = {
    time: Date.now() / 1000,
    spotter_callsign: "PRIVATE-CALLSIGN",
    dx_callsign: "PRIVATE-CALLSIGN",
    dx_dxcc_code: 291,
    spotter_dxcc_code: 1,
    mode: "CW",
    band: 20,
    dx_continent: "NA",
    spotter_continent: "NA",
    dx_cq_zone: 5,
    dx_itu_zone: 8,
    spotter_cq_zone: 5,
    spotter_itu_zone: 8,
    dx_loc: [-74, 41],
    spotter_loc: [-75, 40],
    comment: "PRIVATE-COMMENT",
};

function diagnostic_error() {
    const error = new Error("too much recursion");
    error.name = "InternalError";
    return error;
}

function fail(predicate, value) {
    const error = diagnostic_error();
    predicates.failure = { predicate, value, error };
    return error;
}

function report(error) {
    return prepareSentryEvent(
        {
            exception: {
                values: [
                    {
                        type: error.name,
                        value: error.message,
                        stacktrace: { frames: [{ filename: "/assets/app.js", lineno: 1 }] },
                    },
                ],
            },
        },
        { originalException: error },
    );
}

function catch_enrichment(spot) {
    try {
        enrich_spot_zones_if_missing(spot);
    } catch (error) {
        return error;
    }
    return null;
}

beforeEach(() => {
    predicates.calls = [];
    predicates.failure = null;
    diagnostics.fail = false;
    zones.failure = null;
});

afterEach(() => {
    cleanup();
    websocket.handler = null;
    vi.restoreAllMocks();
});

it("records bounded DXCC evidence at the spot render boundary", () => {
    const error = fail("label", 291);
    let caught;
    try {
        get_spot_dxcc_display(base_spot, "live");
    } catch (value) {
        caught = value;
    }

    expect(caught).toBe(error);
    const event = report(caught);
    expect(event.contexts.diagnostic).toMatchObject({
        operation: "spot_render",
        dxcc_failure_field: "dx_dxcc_code",
        dxcc_failure_predicate: "label",
        dxcc_input_type: "number",
        dxcc_input_length: null,
        dxcc_input_positive_integer: true,
        spot_source: "live",
    });
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("PRIVATE-CALLSIGN");
    expect(serialized).not.toContain("PRIVATE-COMMENT");
    expect(serialized).not.toContain('"dx_loc"');
});

it.each([
    ["us_state", "history"],
    ["canada", "live"],
])("records %s failures for %s spot rendering", (predicate, spot_source) => {
    const error = fail(predicate, 291);
    let caught;
    try {
        get_spot_dxcc_display(base_spot, spot_source);
    } catch (value) {
        caught = value;
    }

    expect(caught).toBe(error);
    expect(report(caught).contexts.diagnostic).toMatchObject({
        operation: "spot_render",
        dxcc_failure_predicate: predicate,
        spot_source,
    });
});

it("records bounded string metadata without the DXCC value", () => {
    const value = "PRIVATE-DXCC".repeat(1000);
    const error = fail("label", value);
    let caught;
    try {
        get_spot_dxcc_display({ ...base_spot, dx_dxcc_code: value }, "history");
    } catch (result) {
        caught = result;
    }

    expect(caught).toBe(error);
    const diagnostic = report(caught).contexts.diagnostic;
    expect(diagnostic).toMatchObject({
        dxcc_input_type: "string",
        dxcc_input_length: value.length,
        dxcc_input_positive_integer: null,
        spot_source: "history",
    });
    expect(JSON.stringify(diagnostic)).not.toContain("PRIVATE-DXCC");
});

it("rethrows the original render error if annotation fails", () => {
    const error = fail("label", 291);
    diagnostics.fail = true;
    let caught;
    try {
        get_spot_dxcc_display(base_spot, "live");
    } catch (value) {
        caught = value;
    }
    expect(caught).toBe(error);
});

it("records the spotter Canada input at the real receive failure boundary", () => {
    renderHook(useSpotWebSocket);
    const error = fail("canada", 1);
    let caught;
    try {
        websocket.handler({ event: "update", spots: [base_spot] });
    } catch (value) {
        caught = value;
    }

    expect(caught).toBe(error);
    expect(predicates.calls.slice(-2)).toEqual([
        { predicate: "us_state", value: 1 },
        { predicate: "canada", value: 1 },
    ]);
    annotateDiagnosticError(caught, {
        operation: "websocket_message",
        stage: "subscriber",
        message_type: "spots",
        transport: "unified",
    });
    const event = report(caught);
    expect(event.contexts.diagnostic).toMatchObject({
        dxcc_failure_field: "spotter_dxcc_code",
        dxcc_failure_predicate: "canada",
        dxcc_input_type: "number",
        dxcc_input_length: null,
        operation: "websocket_message",
        stage: "subscriber",
    });
    expect(event.exception.values[0]).toMatchObject({
        type: "InternalError",
        value: "too much recursion",
    });
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain("PRIVATE-CALLSIGN");
    expect(serialized).not.toContain("PRIVATE-COMMENT");
    expect(serialized).not.toContain('"dx_loc"');
});

it.each([
    ["dx_dxcc_code", "us_state", 291, { dx_state: undefined, spotter_state: "present" }],
    ["dx_dxcc_code", "canada", 1, { dx_state: undefined, spotter_state: "present" }],
    ["spotter_dxcc_code", "us_state", 291, { dx_state: "present", spotter_state: undefined }],
    ["spotter_dxcc_code", "canada", 1, { dx_state: "present", spotter_state: undefined }],
])("records failure metadata for %s %s", (field, predicate, value, states) => {
    const error = fail(predicate, value);
    const caught = catch_enrichment({ ...base_spot, ...states, [field]: value });
    expect(caught).toBe(error);
    expect(report(caught).contexts.diagnostic).toMatchObject({
        dxcc_failure_field: field,
        dxcc_failure_predicate: predicate,
        dxcc_input_type: "number",
        dxcc_input_length: null,
    });
});

it.each(["dx_dxcc_code", "spotter_dxcc_code"])(
    "records bounded metadata for a long private string in %s",
    field => {
        const value = "PRIVATE-SECRET".repeat(100000);
        const state_field = field === "dx_dxcc_code" ? "dx_state" : "spotter_state";
        const error = fail("us_state", value);
        const caught = catch_enrichment({
            ...base_spot,
            dx_state: "present",
            spotter_state: "present",
            [field]: value,
            [state_field]: undefined,
        });

        expect(caught).toBe(error);
        const diagnostic = report(caught).contexts.diagnostic;
        expect(diagnostic).toMatchObject({
            dxcc_failure_field: field,
            dxcc_failure_predicate: "us_state",
            dxcc_input_type: "string",
            dxcc_input_length: value.length,
        });
        expect(JSON.stringify(diagnostic)).not.toContain("PRIVATE-SECRET");
        expect(
            JSON.stringify({
                dxcc_failure_field: diagnostic.dxcc_failure_field,
                dxcc_failure_predicate: diagnostic.dxcc_failure_predicate,
                dxcc_input_type: diagnostic.dxcc_input_type,
                dxcc_input_length: diagnostic.dxcc_input_length,
            }).length,
        ).toBeLessThan(160);
    },
);

it("skips DXCC predicates when both state values already exist", () => {
    const complete = { ...base_spot, dx_state: "NY", spotter_state: "QC" };
    expect(enrich_spot_zones_if_missing(complete)).toBe(complete);
    expect(predicates.calls).toEqual([]);
});

it("keeps successful receive behavior and lookup order", () => {
    const view = renderHook(useSpotWebSocket);
    act(() => websocket.handler({ event: "initial", spots: [base_spot] }));
    expect(view.result.current.raw_spots).toHaveLength(1);
    expect(view.result.current.raw_spots[0]).toMatchObject({
        dx_dxcc_code: 291,
        spotter_dxcc_code: 1,
    });
    expect(predicates.calls.slice(-3)).toEqual([
        { predicate: "us_state", value: 291 },
        { predicate: "us_state", value: 1 },
        { predicate: "canada", value: 1 },
    ]);
});

it("does not attribute zone lookup failures to DXCC predicates", () => {
    zones.failure = "us_state";
    const error = catch_enrichment({
        ...base_spot,
        dx_state: undefined,
        spotter_state: "present",
    });
    expect(error.message).toBe("zone lookup failed");
    expect(report(error).contexts.diagnostic).not.toHaveProperty("dxcc_failure_field");
});

it("rethrows the original error if diagnostic annotation fails", () => {
    const error = fail("us_state", 291);
    diagnostics.fail = true;
    const caught = catch_enrichment({
        ...base_spot,
        dx_state: undefined,
        spotter_state: "present",
    });
    expect(caught).toBe(error);
});

it("does not convert malformed non-string inputs for diagnostics", () => {
    const value = {
        toString() {
            throw new Error("conversion must not run");
        },
    };
    const malformed = {
        ...base_spot,
        dx_dxcc_code: value,
        dx_state: undefined,
        spotter_state: "present",
    };
    expect(enrich_spot_zones_if_missing(malformed)).toBe(malformed);
});
