# Catserver updater API

The catserver owns all release metadata and artifact processing. The browser only invokes the loopback API and never supplies a URL, file name, version, path, command, or hash.

## Remote release manifest

Catserver fetches `https://holycluster.iarc.org/catserver/releases.json` with HTTPS, redirects disabled. Its JSON schema is:

```json
{
  "version": "1.4.0",
  "artifacts": {
    "linux-appimage": {
      "url": "https://releases.example/HolyCluster-1.4.0.AppImage",
      "name": "HolyCluster-1.4.0.AppImage",
      "sha256": "64 lowercase hexadecimal characters",
      "size": 12345678
    },
    "windows-msi": {
      "url": "https://releases.example/HolyCluster-1.4.0.msi",
      "name": "HolyCluster-1.4.0.msi",
      "sha256": "64 lowercase hexadecimal characters",
      "size": 12345678
    }
  }
}
```

`version` is SemVer (an optional `catserver-v` prefix is accepted). The selected artifact must be HTTPS, at most 512 MiB, have the exact platform extension, a basename-only `name`, exact byte count, and SHA-256. Versions equal to or older than the running catserver and descriptors for a different platform are rejected.

## Loopback UI API

The server binds only to `127.0.0.1`. Every response is:

```json
{"state":"idle|deferred|available|downloaded|installing|installed|failed","available_version":"1.4.0 or null","diagnostic":"safe message or null"}
```

| Method | Path | Meaning |
| --- | --- | --- |
| `GET` | `/api/update` | Read persisted update status. |
| `POST` | `/api/update/check` | Fetch and validate the manifest. |
| `POST` | `/api/update/install` | Fetch, validate, stage, and schedule the selected artifact, then stop catserver. Returns `202` when the detached helper has started. |
| `POST` | `/api/update/defer` | Persist `deferred`; a later check or retry remains user initiated. |
| `POST` | `/api/update/retry` | Clear status and diagnostics without accepting client-supplied release data. |

The endpoint payloads are always empty. Failed operations return `502` with a safe diagnostic and keep state in catserver's local update data directory.

## Install behavior

The detached helper rehashes the staged artifact after catserver exits. On Linux it proceeds only when the running executable is the `APPIMAGE` executable with an `.AppImage` name. It copies the verified stage next to the executable, atomically renames the current AppImage to a backup, atomically activates the replacement, and relaunches it. Activation or relaunch failure restores the old AppImage; unsupported Linux packaging requires a manual update.

On Windows the helper waits for catserver shutdown, rehashes the staged MSI, runs `msiexec.exe /i <validated-msi> /qn /norestart` without a shell, records the exit result, and relaunches the installed executable on success. MSI rollback is not promised.
