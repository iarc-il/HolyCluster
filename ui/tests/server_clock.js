import { create_server_clock } from "@/utils/server_clock.js";
import { describe, expect, it } from "vitest";

describe("server clock", () => {
    it("uses local time before synchronization", () => {
        let wall_time = 10_000;
        const clock = create_server_clock({
            wall_now: () => wall_time,
            monotonic_now: () => 0,
        });

        expect(clock.now_ms()).toBe(10_000);
        wall_time = 11_000;
        expect(clock.now_ms()).toBe(11_000);
        expect(clock.is_server_time()).toBe(false);
    });

    it("advances server time with the monotonic clock", () => {
        let wall_time = 86_400_000;
        let monotonic_time = 100;
        const clock = create_server_clock({
            wall_now: () => wall_time,
            monotonic_now: () => monotonic_time,
        });

        expect(clock.synchronize(2_000)).toBe(true);
        expect(clock.now_ms()).toBe(2_000_000);

        wall_time = 172_800_000;
        monotonic_time = 1_600;
        expect(clock.now_ms()).toBe(2_001_500);
        expect(clock.is_server_time()).toBe(true);
    });

    it("resynchronizes and ignores invalid samples", () => {
        let monotonic_time = 100;
        const clock = create_server_clock({
            wall_now: () => 50_000,
            monotonic_now: () => monotonic_time,
        });

        expect(clock.synchronize(Number.NaN)).toBe(false);
        expect(clock.synchronize(-1)).toBe(false);
        expect(clock.now_ms()).toBe(50_000);

        expect(clock.synchronize(2_000)).toBe(true);
        monotonic_time = 600;
        expect(clock.now_ms()).toBe(2_000_500);

        expect(clock.synchronize(3_000)).toBe(true);
        expect(clock.now_ms()).toBe(3_000_000);
    });
});
