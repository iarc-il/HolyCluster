import { expect, test } from "@playwright/test";

test.use({ browserName: "firefox" });

test("DXCC callers reject oversized codes in Firefox", async ({ page, browserName }) => {
    expect(browserName).toBe("firefox");
    await page.route("/", route =>
        route.fulfill({ contentType: "text/html", body: "<!doctype html><title>DXCC</title>" }),
    );
    await page.goto("/");

    const results = await page.evaluate(async () => {
        const { normalize_dxcc_code, normalize_dxcc_entity_code, is_canada_dxcc_code } =
            await import("/src/data/dxcc_entities.js");
        return [
            "1",
            " 291 ",
            "001",
            "1000",
            `${"0".repeat(1_000_000)}1`,
            "1".repeat(1_000_000),
        ].map(value => ({
            code: normalize_dxcc_code(value),
            entity: normalize_dxcc_entity_code(value),
            canada: is_canada_dxcc_code(value),
        }));
    });

    expect(results).toEqual([
        { code: 1, entity: 1, canada: true },
        { code: 291, entity: 291, canada: false },
        { code: 1, entity: 1, canada: true },
        { code: null, entity: null, canada: false },
        { code: null, entity: null, canada: false },
        { code: null, entity: null, canada: false },
    ]);
});
