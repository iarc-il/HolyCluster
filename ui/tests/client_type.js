import { browser_type, client_type, is_mobile_client } from "@/utils/client_type.js";
import { expect, it } from "vitest";

it("classifies mobile user agents", () => {
    expect(client_type({ userAgent: "Firefox Android" })).toBe("mobile");
    expect(client_type({ userAgent: "iPad" })).toBe("mobile");
});

it("classifies desktop-style iPadOS user agents as mobile", () => {
    expect(
        is_mobile_client({
            userAgent:
                "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
            maxTouchPoints: 5,
        }),
    ).toBe(true);
});

it("uses user-agent client hints when available", () => {
    expect(
        is_mobile_client({
            userAgent: "Desktop Browser",
            userAgentData: { mobile: true },
        }),
    ).toBe(true);
});

it("classifies other user agents as desktop", () => {
    expect(client_type({ userAgent: "Desktop Browser" })).toBe("desktop");
});

it.each([
    ["Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36", "chrome"],
    ["Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0", "edge"],
    ["Mozilla/5.0 Firefox/132.0", "firefox"],
    ["Mozilla/5.0 Version/18.0 Safari/605.1.15", "safari"],
    ["Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36 OPR/115.0.0.0", "other"],
])("classifies browser families", (userAgent, expected) => {
    expect(browser_type({ userAgent })).toBe(expected);
});

it("uses browser brands before the user-agent fallback", () => {
    expect(
        browser_type({
            userAgent: "Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36",
            userAgentData: { brands: [{ brand: "Microsoft Edge", version: "130" }] },
        }),
    ).toBe("edge");
    expect(
        browser_type({
            userAgent: "Mozilla/5.0 Chrome/130.0.0.0 Safari/537.36",
            userAgentData: { brands: [{ brand: "Chromium", version: "130" }] },
        }),
    ).toBe("other");
});
