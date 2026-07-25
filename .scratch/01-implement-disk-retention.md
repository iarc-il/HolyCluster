# Issue 01: Implement the disk retention policy (ADR 0001)

- **Raised by:** Harold (DevOps), 2026-07-25, after `holycluster-dev` hit 100% disk.
- **Gate:** Boris (Tech Lead). Needs triage before build.
- **Depends on:** `docs/adr/0001-bound-disk-growth-on-servers.md` being accepted.
- **Size:** small. One script, two config files, one timer.

## Why now

Dev filled to 100% with 261 MB free. Manual reclaim brought it to 61% (15 GB free), which is roughly ten weeks of runway at the observed 1.5 GB per week. Nothing prevents a repeat, and prod runs the same stack with no backups.

## Scope

Everything lives in the repo and deploys with the stack. No hand edits on a box.

1. **`scripts/ops/rotate-collector-logs.sh`**
   - gzip files under `/var/log/holy/collectors` older than 7 days
   - delete `*.gz` older than 60 days
   - `nice -n 19 ionice -c 3`, idempotent, safe to run twice
   - installed as `/etc/cron.daily/holy-collector-logs`

2. **`scripts/ops/logrotate-holy`** installed to `/etc/logrotate.d/holy`
   - covers `/var/log/holy/api/spots` (93 MB, never rotated)
   - `daily`, `rotate 14`, `compress`, `delaycompress`, `missingok`, `notifempty`
   - the box already runs `logrotate.timer` daily at 00:00, so no new scheduling

3. **journald cap:** `SystemMaxUse=500M` in `/etc/systemd/journald.conf`, then `systemctl restart systemd-journald`

4. **Weekly `docker builder prune -f`** as a systemd timer. Unused build cache only. Do NOT add `image prune -a`: it would delete images pinned only by deliberately stopped containers (`migrate`, `monitor`).

5. **Delete `/var/log/holycluster_memory.log`** (126 MB, last written 2025-10-21) and truncate `/var/log/dmesg` (232 MB of UFW block lines already duplicated in the journal).

6. **Netdata thresholds:** Warning at 80%, Critical at 90%. 98% on a 38 GB disk is under 800 MB of headroom, which is not enough time to react.

## Acceptance criteria

- [ ] `find /var/log/holy/collectors -type f -mtime +7 ! -name "*.gz" | wc -l` returns 0 the morning after the sweep runs
- [ ] `journalctl --disk-usage` reports under 500 MB
- [ ] `df -h /` stays under 80% for a full week including a contest weekend
- [ ] the sweep script run twice in a row is a no-op the second time
- [ ] nothing in the scripts assumes a secret. There is no credential anywhere in this work
- [ ] applied to dev first, then int, then prod, each verified with `df` before and after

## Rollback

Delete the script, the drop-in and the timer, re-comment `SystemMaxUse`. No data migration, no service restart beyond journald.

## Out of scope

The collector reconnect churn and the `monitor` OOM. See issue 02. Retention hides those symptoms, it does not fix them.
