# HolyCluster

HolyCluster is a live amateur radio DX cluster with modern interface and CAT integration. 

## Features

- Live DX spots from several sources
- Map, spot list, filters, and alerts
- Band activity and propagation information
- Optional local radio control through the CAT server

## Use HolyCluster

Open [holycluster.iarc.org](https://holycluster.iarc.org) in a modern web browser.
No installation is needed for normal use.

Send feedback or report a problem through the [feedback form](https://forms.gle/jak7KnvwCnBRN6QU7).

## Development

The project has three parts: the web interface in `ui/`, the server in
`backend/`, and the optional radio-control application in `catserver/`.

### Web interface

Requires Node.js and npm.

```sh
cd ui
npm install
npm run dev
```

The development server requires network access. It sends API and WebSocket
traffic to the shared `https://holycluster-dev.iarc.org` environment, so it is
not isolated from shared development data. Run the checks with:

```sh
npm run check
```

### Backend

Requires Python 3.13 or later, `uv`, and Docker Compose.

```sh
cd backend
cp .env.example .env
```

Set the database credentials, Telnet username, QRZ credentials, `DOMAIN`, and
`EMAIL` in `.env`. The following values must be absolute paths on the host:

```dotenv
LOG_DIR=/absolute/path/to/logs
UI_DIST_PATH=/absolute/path/to/HolyCluster/ui/dist
CATSERVER_MSI_DIR=/absolute/path/to/catserver-releases
```

Create the log and release directories. Build the web interface before starting
the backend:

```sh
mkdir -p /absolute/path/to/logs /absolute/path/to/catserver-releases
cd ../ui
npm install
npm run build
cd ../backend
```

`CATSERVER_MSI_DIR` must contain `latest.json` and an `artifacts/` directory
with the CAT server release files named in that manifest. The API serves these
files to CAT server users.

These files are created and updated by the CI/CD pipeline.

For a new public deployment, point `DOMAIN` at this host and allow inbound
ports 80 and 443. Then run the first-time TLS setup. It creates a temporary
certificate, starts the stack, and requests a Let's Encrypt certificate:

```sh
./setup.sh
```

For an existing deployment, start the stack with:

```sh
docker compose up
```

Run backend tests with:

```sh
uv run pytest
```

### CAT server

The CAT server is an optional local application. It runs on
`http://127.0.0.1:3000`, proxies HolyCluster, and lets the web interface tune a
connected radio.

It requires Rust and Cargo for building. On Windows it supports OmniRig.
Hamlib is also available on all supported systems, including the `NET rigctl`
model for network-connected radios. The selected backend and its settings are
saved in the user's HolyCluster configuration directory.

Both the Linux and Windows versions are built on Linux. No other operating
system has been tested as a CAT server development machine.

Run the CAT server normally with:

```sh
cd catserver
cargo run
```

Use `--port` to choose a different local port. `--backend` selects a different
HolyCluster server, `--dev-server` uses the shared development server, and
`--local-ui` serves a local `ui/dist` build.

Run it with a dummy radio for development:

```sh
cd catserver
cargo run -- --dummy
```

When running the Linux ELF binary directly, the tray icon needs GTK3 and
AppIndicator packages:

```sh
sudo apt install libgtk-3-0 libappindicator3-1
```

## Contributing

Bug reports, ideas, and pull requests are welcome. Use the feedback form for user feedback and problem reports.
