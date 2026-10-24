import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import os from "node:os";

export function assertProductBrowserPlatform(env = process.env) {
    assert(process.platform === "linux", "Product browser bridge requires Linux");
    // WSL can use wslview, which the xdg-open bridge cannot intercept.
    assert(
        ![process.env, env].some(source => source.WSL_DISTRO_NAME || source.WSL_INTEROP) &&
            !/microsoft|wsl/i.test(`${os.release()} ${os.version()}`) &&
            !/microsoft|wsl/i.test(readFileSync("/proc/version", "utf8")),
        "Product browser bridge does not support WSL",
    );
}
