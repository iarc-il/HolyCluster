import UpdateProgress from "@/components/UpdateProgress.jsx";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ current: null }));
vi.mock("@/hooks/useUpdate.jsx", () => ({ useUpdate: () => state.current }));
afterEach(cleanup);

it("offers reconnection only after confirmed installation and before verification", () => {
    state.current = { session: { phase: "downloading", started: Date.now() }, active: true };
    const { rerender } = render(<UpdateProgress />);
    for (const phase of [
        "requested",
        "downloading",
        "verifying",
        "awaiting_permission",
        "installing",
        "failed",
    ]) {
        state.current.session = { ...state.current.session, phase };
        rerender(<UpdateProgress />);
        expect(screen.queryByRole("button", { name: "Retry connection" })).toBeNull();
    }
    state.current.session = {
        ...state.current.session,
        phase: "reconnecting",
        installer_outcome: "installed",
    };
    rerender(<UpdateProgress />);
    expect(screen.getByRole("button", { name: "Retry connection" })).not.toBeNull();
    state.current.session = { ...state.current.session, verified: true };
    rerender(<UpdateProgress />);
    expect(screen.queryByRole("button", { name: "Retry connection" })).toBeNull();
});
