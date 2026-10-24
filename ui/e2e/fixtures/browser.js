import { test as base, expect } from "@playwright/test";

export const test = base.extend({
    allowed_browser_errors: [[], { option: true }],
    socket_timers: async ({}, use) => {
        const pending = new Map();
        const cancel = socket => {
            for (const timer of pending.get(socket) ?? []) clearTimeout(timer);
            pending.delete(socket);
        };
        const schedule = (socket, callback, delay) => {
            if (!pending.has(socket)) {
                pending.set(socket, new Set());
                socket.onClose(() => cancel(socket));
            }
            const timers = pending.get(socket);
            const timer = setTimeout(() => {
                timers.delete(timer);
                callback();
            }, delay);
            timers.add(timer);
        };
        const cleanup = () => {
            for (const socket of pending.keys()) cancel(socket);
        };
        await use({ schedule, cleanup });
        cleanup();
    },
    mock_socket_delays: async ({ socket_timers }, use) => {
        await use(socket_timers.schedule);
    },
    page: async ({ page, allowed_browser_errors, socket_timers }, use) => {
        const errors = [];
        const console_reads = [];
        const record = message => {
            if (!allowed_browser_errors.some(pattern => pattern.test(message)))
                errors.push(message);
        };
        page.on("pageerror", error => record(`pageerror: ${error.message}`));
        page.on("console", message => {
            if (message.type() !== "error") return;
            console_reads.push(
                (async () => {
                    let text = message.text();
                    if (text === "JSHandle@object") {
                        const value = await message
                            .args()[0]
                            ?.evaluate(value =>
                                value instanceof Error ? `${value.name}: ${value.message}` : null,
                            )
                            .catch(() => null);
                        if (value) text = value;
                    }
                    record(`console: ${text}`);
                })(),
            );
        });
        await use(page);
        socket_timers.cleanup();
        await page.unrouteAll({ behavior: "wait" });
        await Promise.all(console_reads);
        await page.close();
        await Promise.all(console_reads);
        expect(errors, "unexpected browser console/runtime errors after mock cleanup").toEqual([]);
    },
});

export function testWithBrowserErrors(title, patterns, callback) {
    test.describe(title, () => {
        test.use({ allowed_browser_errors: [patterns, { scope: "test" }] });
        test("retains the intentional failure", callback);
    });
}

export { expect };
