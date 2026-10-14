// Change this revision whenever previously cached download URLs must be retired.
export const DOWNLOAD_POLICY_REVISION = "2";

export function release_download_url(release, platform, upstream = window.location.origin) {
    const artifact = release?.artifact;
    const extension = { windows: ".msi", linux: ".AppImage" }[platform];
    if (
        !extension ||
        release?.platform !== platform ||
        release?.architecture !== "x86_64" ||
        !/^catserver-v\d+\.\d+\.\d+(?:-\d+-g[0-9a-f]+)?$/.test(release?.version) ||
        artifact?.name !== `${release.version}-${platform}-x86_64${extension}` ||
        artifact?.location !== `/catserver/artifacts/${artifact.name}` ||
        !/^[0-9a-f]{64}$/.test(artifact?.sha256) ||
        !Number.isSafeInteger(artifact?.size) ||
        artifact.size <= 0
    ) {
        return null;
    }
    const query = new URLSearchParams({
        download_policy: DOWNLOAD_POLICY_REVISION,
        sha256: artifact.sha256,
        upstream,
    });
    return `${artifact.location}?${query}`;
}
