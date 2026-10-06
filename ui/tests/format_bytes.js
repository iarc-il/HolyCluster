import { format_bytes } from "@/utils/format_bytes.js";
import { expect, it } from "vitest";

it("formats download sizes using decimal byte units", () => {
    expect(format_bytes(0)).toBe("0 B");
    expect(format_bytes(999)).toBe("999 B");
    expect(format_bytes(1000)).toBe("1 KB");
    expect(format_bytes(1234567)).toBe("1.2 MB");
    expect(format_bytes(2500000000)).toBe("2.5 GB");
    expect(format_bytes(-1)).toBe("0 B");
    expect(format_bytes(undefined)).toBe("0 B");
});
