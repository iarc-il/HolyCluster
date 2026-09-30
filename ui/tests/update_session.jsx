import UpdateControls from "@/components/UpdateControls.jsx";
import UpdateProgress from "@/components/UpdateProgress.jsx";
import { UpdateProvider, normalize_update_status, useUpdate } from "@/hooks/useUpdate.jsx";
import { NATIVE_UPDATER_MIN_VERSION } from "@/utils/cat_features.js";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const cat = vi.hoisted(() => ({ current: null }));
vi.mock("@/hooks/useRadio", () => ({ default: () => cat.current }));
vi.mock("@/hooks/useColors", () => ({ useColors: () => ({ dev_mode: false }) }));

function response(payload, status = 200) {
    return { ok: status < 400, status, text: async () => JSON.stringify(payload) };
}
it("honors explicit same-version availability without treating ordinary equality as an update", () => {
    expect(
        normalize_update_status({
            state: "available",
            local_version: "1.3.0",
            available_version: "1.3.0",
        }).status,
    ).toBe("available");
    expect(
        normalize_update_status({
            state: "idle",
            local_version: "1.3.0",
            available_version: "1.3.0",
        }).status,
    ).toBe("current");
});

it("adopts an active session returned by the automatic check", async () => {
    vi.stubGlobal(
        "fetch",
        vi.fn(path =>
            Promise.resolve(
                response(
                    path.endsWith("/check")
                        ? {
                              state: "installing",
                              session: {
                                  id: "concurrent-check",
                                  phase: "installing",
                                  expected_version: "1.3.0",
                              },
                          }
                        : { state: "idle" },
                ),
            ),
        ),
    );
    render(<Page />);
    await waitFor(() => expect(update.session?.id).toBe("concurrent-check"));
    expect(update.active).toBe(true);
});

it("does not resume an already completed transaction during a fresh check", async () => {
    vi.stubGlobal(
        "fetch",
        vi.fn(() =>
            Promise.resolve(
                response({
                    state: "idle",
                    session: {
                        id: "completed",
                        phase: "updated",
                        expected_version: "1.3.0",
                        installer_outcome: "installed",
                    },
                }),
            ),
        ),
    );
    render(<Page />);
    await waitFor(() => expect(update.status).toBe("current"));
    expect(update.session).toBeNull();
});

let update;
function Probe() {
    update = useUpdate();
    return <output>{update.status}</output>;
}
function Page() {
    return (
        <UpdateProvider>
            <Probe />
            <UpdateProgress />
            <UpdateControls />
            <input aria-label="Retained filter" defaultValue="20m" />
        </UpdateProvider>
    );
}
beforeEach(() => {
    cat.current = { local_version: [...NATIVE_UPDATER_MIN_VERSION] };
});
afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

it("retains the update session and document state through the expected outage", async () => {
    let finish;
    const fetch = vi.fn(path =>
        path.endsWith("/install")
            ? new Promise(resolve => {
                  finish = resolve;
              })
            : Promise.resolve(response({ state: "available", available_version: "1.3.0" })),
    );
    vi.stubGlobal("fetch", fetch);
    const page = render(<Page />);
    await waitFor(() => expect(update.status).toBe("available"));
    act(() => {
        update.install();
    });
    cat.current = { local_version: null };
    page.rerender(<Page />);
    expect(update.enabled).toBe(true);
    expect(screen.getByLabelText("Retained filter").value).toBe("20m");
    await act(async () => {
        finish(response({ state: "installing", available_version: "1.3.0" }, 202));
    });
    await waitFor(() => expect(update.status).toBe("installing"));
    expect(update.remote_version).toBe("1.3.0");
    expect(
        screen.getByRole("progressbar", { name: "Update in progress" }).hasAttribute("value"),
    ).toBe(false);
    expect(fetch.mock.calls.filter(([path]) => path.endsWith("/check"))).toHaveLength(0);
});

it("requires the exact restart identity and verified running version before success", async () => {
    let installing = false;
    let running_id = "unrelated-instance";
    const session = {
        id: "transaction",
        expected_version: "1.3.0",
        phase: "reconnecting",
        installer_outcome: "installed",
    };
    const fetch = vi.fn(path => {
        if (path.endsWith("/install")) installing = true;
        if (path === "/api/ready")
            return Promise.resolve(
                response({ update_id: running_id, version: "1.3.0", verified: true }),
            );
        return Promise.resolve(
            response(
                installing
                    ? { state: "installed", session }
                    : { state: "available", available_version: "1.3.0" },
            ),
        );
    });
    vi.stubGlobal("fetch", fetch);
    render(<Page />);
    await waitFor(() => expect(update.status).toBe("available"));
    await act(async () => {
        await update.install();
    });
    await waitFor(
        () => expect(fetch.mock.calls.some(([path]) => path === "/api/ready")).toBe(true),
        { timeout: 2000 },
    );
    expect(update.status).not.toBe("updated");
    running_id = "transaction";
    await waitFor(() => expect(update.status).toBe("updated"), { timeout: 3000 });
    expect(update.local_version).toBe("1.3.0");
    expect(screen.getByLabelText("Retained filter").value).toBe("20m");
});

it("does not confirm a canceled reinstall even when the expected version is running", async () => {
    vi.stubGlobal(
        "fetch",
        vi.fn(path =>
            Promise.resolve(
                response(
                    path.endsWith("/install")
                        ? {
                              state: "failed",
                              session: {
                                  id: "canceled",
                                  expected_version: "1.3.0",
                                  phase: "permission_cancelled",
                                  installer_outcome: "failed",
                                  diagnostic: "Windows permission was canceled",
                              },
                          }
                        : { state: "available", available_version: "1.3.0" },
                ),
            ),
        ),
    );
    render(<Page />);
    await waitFor(() => expect(update.status).toBe("available"));
    await act(async () => {
        await update.install();
    });
    expect(update.status).toBe("failed");
    expect(update.session.installer_outcome).toBe("failed");
    expect(update.error).toContain("canceled");
});

it("shows only real download progress and disables installer mutations", async () => {
    vi.stubGlobal(
        "fetch",
        vi.fn(path =>
            Promise.resolve(
                response(
                    path.endsWith("/install")
                        ? {
                              state: "installing",
                              session: {
                                  id: "download",
                                  expected_version: "1.3.0",
                                  phase: "downloading",
                                  downloaded: 32,
                                  total: 128,
                              },
                          }
                        : { state: "available", available_version: "1.3.0" },
                ),
            ),
        ),
    );
    render(<Page />);
    await waitFor(() => expect(update.status).toBe("available"));
    await act(async () => {
        await update.install();
    });
    expect(screen.getByRole("progressbar", { name: "Download progress" }).value).toBe(32);
    expect(screen.getByRole("button", { name: "Check for updates" }).disabled).toBe(true);
    expect(screen.queryByRole("button", { name: "Install update" })).toBeNull();
});

it("does not present a rejected install as an accepted installation", async () => {
    vi.stubGlobal(
        "fetch",
        vi.fn(path =>
            Promise.resolve(
                response(
                    path.endsWith("/install")
                        ? { state: "failed", diagnostic: "Permission denied" }
                        : { state: "available", available_version: "1.3.0" },
                    path.endsWith("/install") ? 502 : 200,
                ),
            ),
        ),
    );
    render(<Page />);
    await waitFor(() => expect(update.status).toBe("available"));
    await act(async () => {
        await update.install();
    });
    expect(update.status).toBe("failed");
    expect(update.error).toContain("Permission denied");
});

it("does not trust verification supplied by a status snapshot", async () => {
    const session = {
        id: "unverified",
        phase: "updated",
        expected_version: "1.3.0",
        installer_outcome: "installed",
        verified: true,
    };
    vi.stubGlobal(
        "fetch",
        vi.fn(path =>
            Promise.resolve(
                response(
                    path === "/api/ready"
                        ? { update_id: "another-job", version: "1.3.0", verified: true }
                        : path.endsWith("/install")
                          ? { state: "installed", session }
                          : { state: "available", available_version: "1.3.0" },
                ),
            ),
        ),
    );
    render(<Page />);
    await waitFor(() => expect(update.status).toBe("available"));
    await act(async () => {
        await update.install();
    });
    expect(update.session.verified).toBe(false);
    expect(update.status).not.toBe("updated");
});

it("keeps a terminal helper failure instead of adopting stale parent progress", async () => {
    const session = {
        id: "helper-failure",
        phase: "installing",
        expected_version: "1.3.0",
        helper_url: "http://127.0.0.1:9999/status",
        capability: "test",
    };
    let installing = false;
    vi.stubGlobal(
        "fetch",
        vi.fn(path => {
            if (path.endsWith("/install")) installing = true;
            return Promise.resolve(
                response(
                    path === session.helper_url
                        ? {
                              ...session,
                              phase: "failed",
                              diagnostic: "Installer failed",
                              installer_outcome: "failed",
                          }
                        : installing
                          ? { state: "installing", session }
                          : { state: "available", available_version: "1.3.0" },
                ),
            );
        }),
    );
    render(<Page />);
    await waitFor(() => expect(update.status).toBe("available"));
    await act(async () => {
        await update.install();
    });
    await waitFor(() => expect(update.status).toBe("failed"), { timeout: 2000 });
    expect(update.error).toBe("Installer failed");
    expect(update.active).toBe(false);
});

it("allows retry after terminal failure without re-adopting the old transaction", async () => {
    const session = {
        id: "failed-job",
        phase: "failed",
        expected_version: "1.3.0",
        installer_outcome: "failed",
    };
    vi.stubGlobal(
        "fetch",
        vi.fn(path =>
            Promise.resolve(
                response(
                    path.endsWith("/install")
                        ? { state: "failed", session }
                        : {
                              state: "available",
                              available_version: "1.3.0",
                              ...(path.endsWith("/retry") ? { session } : {}),
                          },
                ),
            ),
        ),
    );
    render(<Page />);
    await waitFor(() => expect(update.status).toBe("available"));
    await act(async () => {
        await update.install();
    });
    expect(screen.getByRole("button", { name: "Retry update" }).disabled).toBe(false);
    await act(async () => {
        await update.retry();
    });
    expect(update.status).toBe("available");
    expect(update.session).toBeNull();
});

it("aborts an outstanding progress request on unmount without starting another request", async () => {
    let signal;
    const session = {
        id: "pending",
        phase: "installing",
        expected_version: "1.3.0",
        helper_url: "http://127.0.0.1:9999/status",
        capability: "test",
    };
    const fetch = vi.fn((path, options) => {
        if (path === session.helper_url) {
            signal = options.signal;
            return new Promise((_resolve, reject) =>
                signal.addEventListener("abort", () =>
                    reject(new DOMException("Aborted", "AbortError")),
                ),
            );
        }
        return Promise.resolve(
            response(
                path.endsWith("/install")
                    ? { state: "installing", session }
                    : { state: "available", available_version: "1.3.0" },
            ),
        );
    });
    vi.stubGlobal("fetch", fetch);
    const page = render(<Page />);
    await waitFor(() => expect(update.status).toBe("available"));
    await act(async () => {
        await update.install();
    });
    await waitFor(() => expect(signal).toBeDefined(), { timeout: 2000 });
    await act(async () => {
        page.unmount();
    });
    expect(signal.aborted).toBe(true);
    expect(fetch.mock.calls.filter(([path]) => path === "/api/update")).toHaveLength(1);
});
