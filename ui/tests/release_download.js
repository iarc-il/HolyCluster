import { release_download_url } from "@/utils/release_download.js";
import { expect, it } from "vitest";

function release() {
    const name = "catserver-v1.3.1-windows-x86_64.msi";
    return {
        version: "catserver-v1.3.1",
        platform: "windows",
        architecture: "x86_64",
        artifact: {
            name,
            location: `/catserver/artifacts/${name}`,
            sha256: "a".repeat(64),
            size: 100,
        },
    };
}

it("retires legacy URLs and separates upstreams even for the same artifact", () => {
    const metadata = release();
    const first = release_download_url(metadata, "windows", "first-backend");
    const second = release_download_url(metadata, "windows", "second-backend");
    expect(first).not.toBe(metadata.artifact.location);
    expect(first).not.toBe(second);
    const url = new URL(first, window.location.origin);
    expect(url.pathname).toBe(metadata.artifact.location);
    expect(url.searchParams.get("download_policy")).toBe("2");
    expect(url.searchParams.get("sha256")).toBe(metadata.artifact.sha256);
    metadata.artifact.sha256 = "b".repeat(64);
    expect(release_download_url(metadata, "windows", "first-backend")).not.toBe(first);
});

it.each([
    metadata => {
        metadata.platform = "linux";
    },
    metadata => {
        metadata.architecture = "aarch64";
    },
    metadata => {
        metadata.version = "invalid";
    },
    metadata => {
        metadata.artifact.name = "linux.AppImage";
    },
    metadata => {
        metadata.artifact.location = "https://other.example/installer.msi";
    },
    metadata => {
        metadata.artifact.location += "?sha256=forged";
    },
    metadata => {
        metadata.artifact.sha256 = "not-a-checksum";
    },
    metadata => {
        metadata.artifact.size = 0;
    },
])("rejects contradictory or malformed metadata %#", change => {
    const metadata = release();
    change(metadata);
    expect(release_download_url(metadata, "windows")).toBeNull();
});

it("rejects absent metadata and unsupported platforms", () => {
    expect(release_download_url(null, "windows")).toBeNull();
    expect(release_download_url(release(), "macos")).toBeNull();
});
