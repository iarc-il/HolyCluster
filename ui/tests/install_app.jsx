import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const notifications = vi.hoisted(() => ({ info: vi.fn() }));

vi.mock("@/hooks/useColors", () => ({
    useColors: () => ({ colors: { buttons: { utility: "#00ff00" } } }),
}));
vi.mock("react-toastify", () => ({ toast: notifications }));

import InstallApp from "@/components/InstallApp.jsx";

let standalone;

beforeEach(() => {
    standalone = false;
    notifications.info.mockReset();
    vi.stubGlobal("matchMedia", () => ({
        get matches() {
            return standalone;
        },
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
    }));
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Desktop Browser");
    Object.defineProperty(window.navigator, "maxTouchPoints", {
        configurable: true,
        value: 0,
    });
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(window.navigator, "maxTouchPoints");
});

it("offers the browser install prompt when it becomes available", async () => {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = new Event("beforeinstallprompt", { cancelable: true });
    Object.assign(event, {
        prompt,
        userChoice: Promise.resolve({ outcome: "accepted" }),
    });

    render(<InstallApp />);
    expect(screen.queryByRole("button", { name: "Install HolyCluster" })).toBeNull();

    window.dispatchEvent(event);
    const button = await screen.findByRole("button", { name: "Install HolyCluster" });
    fireEvent.click(button);

    await waitFor(() => expect(prompt).toHaveBeenCalledOnce());
    await waitFor(() =>
        expect(screen.queryByRole("button", { name: "Install HolyCluster" })).toBeNull(),
    );
});

it("shows mobile installation help when the browser has no prompt API", () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Firefox Android");
    render(<InstallApp />);

    fireEvent.click(screen.getByRole("button", { name: "Install HolyCluster" }));

    expect(notifications.info).toHaveBeenCalledWith(
        "Open the browser menu and choose Install or Add to Home screen.",
        { toastId: "install-holycluster" },
    );
});

it("shows iPadOS installation help with a desktop-style user agent", () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1",
    );
    Object.defineProperty(window.navigator, "maxTouchPoints", {
        configurable: true,
        value: 5,
    });
    render(<InstallApp />);

    fireEvent.click(screen.getByRole("button", { name: "Install HolyCluster" }));

    expect(notifications.info).toHaveBeenCalledWith("Use Share, then Add to Home Screen.", {
        toastId: "install-holycluster",
    });
});

it("is hidden in standalone display mode", () => {
    standalone = true;
    render(<InstallApp />);

    expect(screen.queryByRole("button", { name: "Install HolyCluster" })).toBeNull();
});

it("hides after the app is installed", async () => {
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Android");
    render(<InstallApp />);
    expect(screen.getByRole("button", { name: "Install HolyCluster" })).not.toBeNull();

    window.dispatchEvent(new Event("appinstalled"));

    await waitFor(() =>
        expect(screen.queryByRole("button", { name: "Install HolyCluster" })).toBeNull(),
    );
});
