import { client_type, is_mobile_client } from "@/utils/client_type.js";
import { expect, it } from "vitest";

it("classifies mobile user agents", () => {
	expect(client_type({ userAgent: "Firefox Android" })).toBe("mobile");
	expect(client_type({ userAgent: "iPad" })).toBe("mobile");
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
