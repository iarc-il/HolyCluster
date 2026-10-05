#!/usr/bin/env bash
set -euo pipefail

eval "$(ssh-agent -a "$RUNNER_TEMP/deploy-ssh-agent.sock" -s)"
trap 'ssh-agent -k >/dev/null' ERR
ssh-add - <<< "$SSH_PRIVATE_KEY"
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
for host in "$@"; do
    ssh-keyscan -H "$host" >> "$HOME/.ssh/known_hosts"
done
printf 'SSH_AUTH_SOCK=%s\nSSH_AGENT_PID=%s\n' "$SSH_AUTH_SOCK" "$SSH_AGENT_PID" >> "$GITHUB_ENV"
