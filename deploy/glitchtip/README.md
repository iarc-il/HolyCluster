# GlitchTip Deployment

This is the independent GlitchTip Compose stack for the HolyCluster
development server. It serves the GlitchTip application under
`/errors/` through the existing HolyCluster nginx container.

## Prerequisites

- Docker Compose
- The external Docker network `holycluster-proxy`
- nginx connected to `holycluster-proxy`
- The nginx `/errors/` proxy route

The network and nginx changes are intentionally separate from this stack. Do
not start this Compose project until nginx is connected to the proxy network.

## Initial Configuration

Copy `.env.example` to `.env` on the server and replace the placeholder
password and secret values.

Generate URL-safe values with:

```text
openssl rand -hex 32
```

Keep `.env` server-local. Never commit it or include it in an application
artifact.

## Validation

Validate the rendered configuration without starting services:

```text
docker compose -p glitchtip config
```

Start the stack after the proxy network and nginx route are ready:

```text
docker compose -p glitchtip up -d
docker compose -p glitchtip ps
docker compose -p glitchtip logs --tail=100 glitchtip-web
```

The web service has no published host port. It is reachable only through the
shared Docker proxy network.

`GLITCHTIP_DOMAIN` identifies the host, while `GLITCHTIP_URL` identifies the
full public URL including `/errors`. The latter is required so generated DSNs
and links include the deployment prefix.

## Bootstrap

Open `https://holycluster-dev.iarc.org/errors/` and create the initial
administrator account. Disable user registration after the account and team
are created.

Create the six HolyCluster projects and record their generated DSNs separately.

## Upgrades

Back up PostgreSQL and the uploads volume before upgrading the GlitchTip image.
Review the GlitchTip release notes, update the image tag intentionally, and
then run:

```text
docker compose -p glitchtip pull
docker compose -p glitchtip up -d
```

Check migrations and the web service logs after every upgrade.
