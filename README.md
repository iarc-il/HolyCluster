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

The development server uses the shared development backend. Run the checks
with:

```sh
npm run check
```

### Backend

Requires Python 3.13 or later, `uv`, and Docker Compose.

```sh
cd backend
cp .env.example .env
```

Set the required values in `.env`, including database credentials, the Telnet
username, QRZ credentials, and paths to the built web interface and CAT server
release files. Then start the stack:

```sh
docker compose up
```

Run backend tests with:

```sh
uv run pytest
```

### CAT server

The CAT server is an optional local application.
It acts as a proxy to HolyCluster and lets the web interface tune a connected radio.

It requires Rust and Cargo for building. On Windows it supports OmniRig.
On other systems, it connects to `rigctld` by default at `127.0.0.1:4532`.

Run it with a dummy radio for development:

```sh
cd catserver
cargo run -- --dummy
```

On Linux, the tray icon also needs GTK3 and AppIndicator packages:

```sh
sudo apt install libgtk-3-0 libappindicator3-1
```

## Contributing

Bug reports, ideas, and pull requests are welcome. Use the feedback form for user feedback and problem reports.
