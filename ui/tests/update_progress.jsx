import UpdateProgress from "@/components/UpdateProgress.jsx";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ current: null }));
vi.mock("@/hooks/useUpdate.jsx", () => ({ useUpdate: () => state.current }));
afterEach(cleanup);

it("replaces download progress with the existing spinner beside active status text", () => {
    state.current = {
        session: { phase: "downloading", started: Date.now(), total: 100, downloaded: 50 },
        active: true,
    };
    const { rerender } = render(<UpdateProgress />);
    expect(screen.getByRole("progressbar", { name: "Download progress" }).value).toBe(50);
    expect(screen.getByRole("status").querySelector("svg.animate-spin")).toBeNull();
    for (const phase of ["verifying", "awaiting_permission", "installing", "reconnecting"]) {
        state.current.session = { ...state.current.session, phase };
        rerender(<UpdateProgress />);
        const status = screen.getByRole("status");
        expect(screen.queryByRole("progressbar")).toBeNull();
        expect(status.querySelector("svg.animate-spin")).not.toBeNull();
        expect(status.querySelector("svg").parentElement.nextElementSibling.tagName).toBe("STRONG");
    }
    state.current.active = false;
    state.current.session = { ...state.current.session, phase: "failed" };
    rerender(<UpdateProgress />);
    expect(screen.getByRole("status").querySelector("svg.animate-spin")).toBeNull();
});

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
