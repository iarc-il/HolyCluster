import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => ({ current: null }));
const notifications = vi.hoisted(() => ({ info: vi.fn(), update: vi.fn() }));

vi.mock("@/hooks/useUiRefresh.jsx", () => ({
    useUiRefresh: () => refresh.current,
}));
vi.mock("react-toastify", () => ({
    ToastContainer: () => null,
    toast: notifications,
}));

import BuildUpdate from "@/components/BuildUpdate.jsx";

beforeEach(() => {
    notifications.info.mockReset();
    notifications.update.mockReset();
    refresh.current = {
        manual_reload: vi.fn(),
        navigation_outcome: null,
        stale_recovery: null,
        target_entry: "/assets/next.js",
    };
});

afterEach(() => cleanup());

it("does not notify when a new build is detected", () => {
    render(<BuildUpdate />);
    expect(notifications.info).not.toHaveBeenCalled();
});

it("does not notify while checking a module load failure", () => {
    refresh.current.stale_recovery = { status: "checking" };
    render(<BuildUpdate />);
    expect(notifications.info).not.toHaveBeenCalled();
});

it.each([
    [{ status: "manual" }, null],
    [null, { event: "target_mismatch" }],
])("shows one reload error after recovery fails", (stale_recovery, navigation_outcome) => {
    refresh.current.stale_recovery = stale_recovery;
    refresh.current.navigation_outcome = navigation_outcome;
    render(<BuildUpdate />);

    expect(notifications.info).toHaveBeenCalledOnce();
    const content = notifications.info.mock.calls[0][0];
    expect(content.props.children).toEqual([
        "Part of the UI could not be loaded. ",
        expect.objectContaining({ type: "button" }),
    ]);
    expect(content.props.children[1].props.children).toBe("Reload");
});
