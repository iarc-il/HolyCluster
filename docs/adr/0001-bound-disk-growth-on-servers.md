# ADR 0001: Bound disk growth on the HolyCluster servers

- **Status:** Proposed. Decision owner: Boris (Tech Lead).
- **Date:** 2026-07-25
- **Author:** Harold (DevOps)
- **Applies to:** `holycluster-dev`, and by inspection `holycluster-int` and `holycluster` (prod).

## Context

On 2026-07-25 Netdata escalated `disk space usage` to Critical on `holycluster-dev`. The box was not at 98%. It was at **100%**, with 261 MB free on a 38 GB root filesystem.

Read-only diagnosis found four independent unbounded growers, none of them a bug in the app itself:

| Consumer | Size at incident | Why it grew |
|---|---|---|
| `/var/log/holy/collectors` | 7.3 GB, 12,431 files back to 2026-03-03 | no retention policy of any kind. The collector opens a **new dated log file per telnet connection attempt**, so reconnect churn multiplies file count as well as bytes |
| Docker images and build cache | 5.32 GB build cache, 2.0 GB of images from a retired compose project | never pruned since the project was renamed from `holycluster` to `backend` |
| `/var/lib/docker-old` | 4.3 GB, untouched since 2025-12-17 | leftover from a docker data-root migration, never removed |
| systemd journal | 3.6 GB | `SystemMaxUse` is commented out in `/etc/systemd/journald.conf`, so journald defaults to 10% of the filesystem and keeps growing with it |

Smaller strays: `/var/log/dmesg` at 232 MB (220 days of `[UFW BLOCK]` port-scan lines, already duplicated in the journal), `/var/log/holycluster_memory.log` at 126 MB last written 2025-10-21, `/var/cache/netdata` at 2.6 GB.

Immediate reclaim performed the same night, no data deleted except unreferenced image layers: gzip of collector logs older than 7 days (7.3 GB to 1.6 GB), removal of the six retired `holycluster-*` images plus `docker builder prune -f`, and removal of `/var/lib/docker-old`. Result: **100% to 61%, 258 MB free to 15 GB free.**

That is runway, not a fix. At the observed rate the collector logs refill at roughly 1.5 GB per week, so the box returns to Critical in about ten weeks without a policy.

### Why this matters beyond dev

A full root filesystem is not a dev-only inconvenience. Postgres cannot write, the collector cannot open its next log file, and the API starts failing writes while the map keeps rendering stale data. The failure presents as "the cluster looks fine but the spots are old", which is exactly the contest-weekend failure mode we care about. Prod runs the same stack with **no backups and no snapshot**, so the same fill on `holycluster` is materially worse than it was here.

## Decision

Adopt an explicit retention policy on every HolyCluster server, implemented with the mechanism that fits each log's shape.

**1. Dated per-connection collector logs: a scheduled sweep, not logrotate.**
`logrotate` rotates stable filenames. The collector writes `k7ar.net.2026-05-02_19-00-29.log`, a new name per connection, so logrotate would only add `.1.gz` suffixes and multiply the file count. Use a `cron.daily` script instead:

- gzip files under `/var/log/holy/collectors` older than **7 days** (measured 4.6x compression on real data)
- delete `*.gz` older than **60 days**
- run under `nice -n 19 ionice -c 3` so a sweep never competes with the feed

**2. Stable-name logs: a `logrotate.d/holy` drop-in.**
Covers `/var/log/holy/api/spots` (93 MB and growing, never rotated). `logrotate.timer` already runs daily on the box, so a drop-in needs no new scheduling. Daily, `rotate 14`, `compress`, `delaycompress`, `missingok`, `notifempty`.

**3. Cap the journal.** Set `SystemMaxUse=500M` in `/etc/systemd/journald.conf`. 500 MB holds weeks of history on this workload and makes the journal a fixed cost instead of a percentage of a disk that keeps filling.

**4. Weekly `docker builder prune -f`** via a systemd timer. Unused build cache only. Image pruning stays manual: `image prune -a` would delete images pinned only by intentionally stopped containers.

**5. Retire the dead files.** `/var/log/holycluster_memory.log` (nothing has written it since October 2025) and truncation of `/var/log/dmesg`, whose content is fully duplicated in the journal.

**6. Tighten the alert.** Netdata escalated at 98%, which on a 38 GB disk is under 800 MB of headroom and leaves no time to act. Alert Warning at 80% and Critical at 90%.

All of this is configuration on the servers plus one script. It belongs in the repo under `scripts/` and gets deployed with the stack, not hand-edited on a box.

## Consequences

**Good.** Disk becomes a bounded cost with a known ceiling. The collector history stays queryable, just compressed. The alert now fires while there is still room to act.

**Costs.** Roughly 60 days of collector history instead of unlimited, which is a deliberate trade: nobody has read a May telnet log since May, and the data also lands in Postgres. The daily gzip sweep costs about 3 minutes of one niced core on a 7 day backlog, less once it runs steadily.

**Accepted risk.** A retention window can delete evidence of an incident nobody investigated within 60 days. If a specific investigation needs longer, it gets copied off the box, which is the correct place for that decision.

## What this ADR does NOT fix

The collector opening a new log file per reconnect attempt is the reason 12,431 files existed. Retention hides the symptom. `collector` showed **153 restarts** and `monitor` exited **137** (SIGKILL, most likely OOM on a 4 GB box) during this incident. Both are application concerns and get their own issue, not this ADR.

## Alternatives considered

- **Bigger disk or an attached volume.** Buys time, does not bound growth, and costs money monthly. An unbounded writer fills any disk. Rejected as the primary fix, though moving log and database state onto a volume that survives a rebuild remains worth doing on its own merits.
- **Ship logs off-box to a log service.** Correct at a larger scale, disproportionate for a three-server volunteer project, and it introduces a dependency that fails during exactly the traffic spike we care about.
- **Delete rather than compress.** Reclaims marginally more, throws away feed history that costs almost nothing to keep at 4.6x compression. Rejected.

## Rollback

Every item is a file that can be removed: delete the `cron.daily` script, delete the `logrotate.d/holy` drop-in, re-comment `SystemMaxUse`, disable the prune timer. No data migration and no service restart is required beyond `systemctl restart systemd-journald` for the journal cap.

## Verification

- `df -h /` stays under 80% across a full week including a contest weekend.
- `find /var/log/holy/collectors -type f -mtime +7 ! -name "*.gz" | wc -l` returns 0 the day after the sweep runs.
- `journalctl --disk-usage` reports under 500 MB.
- A deliberate Netdata test at the new 80% threshold fires Warning, not Critical.

## Follow-up

Run the same read-only diagnosis on `holycluster-int` and on prod. Prod has no backups, no delete or rebuild protection, and no cloud firewall (`infra/hetzner-inventory.md`, verified 2026-07-07), so a disk-full event there has no restore path.
