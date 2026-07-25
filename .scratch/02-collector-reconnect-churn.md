# Issue 02: Collector reconnect churn and the monitor OOM

- **Raised by:** Harold (DevOps), 2026-07-25, observed while diagnosing the dev disk-full incident.
- **Gate:** Boris (Tech Lead). Application concern, likely Eric to build.
- **Size:** unknown until diagnosed. Start with `diagnosing-bugs`, not with a fix.

## What was observed on `holycluster-dev`

- `collector` container: **153 restarts**. Up 4 minutes when first inspected, up 21 minutes an hour later.
- Live log tail: `dxc.nc7j.com:7373 Reconnection attempt 3. Waiting for 4 minutes before retrying`, preceded by an `asyncio` `TimeoutError` out of a 10 second `wait_for`.
- **Every connection attempt opens a new dated log file.** `ve7cc.net` produced three files in 15 minutes (`17-31-52`, `17-43-10`, `17-45-21`). This is why 12,431 files accumulated where a few hundred would be expected.
- `monitor` container: exited **137** nine hours earlier. 137 is SIGKILL, which on a 4 GB box usually means the OOM killer.
- Load average 4.72 on 2 vCPU while the disk was full.

Note the confound: the box was at 100% disk during these observations. Some of the churn may be a **consequence** of a full disk rather than a cause. Re-observe now that the box is at 61% before concluding anything.

## What to find out

1. Is the reconnect loop upstream flakiness (a specific node refusing connections) or a client-side bug that never recovers a healthy connection?
2. Should a reconnect attempt open a **new** log file at all, or append to a per-source file that logrotate can manage? A file per attempt is a disk-growth multiplier that no retention policy fixes cleanly.
3. Why did `monitor` take a SIGKILL? Confirm OOM in `dmesg` or the journal, and get its actual memory ceiling. 4 GB is shared with postgres, valkey, the API and nginx.
4. Does a stalled telnet source degrade the map gracefully, or does the restart loop cost spot freshness? This is the contest-weekend question and it is the one that actually matters.

## Acceptance criteria

- [ ] a red-capable reproduction of the reconnect loop exists before any fix is written
- [ ] restart count over 24 hours is in single digits
- [ ] the collector produces a bounded number of log files per source per day
- [ ] `monitor` runs for 24 hours without a SIGKILL, or has a documented memory limit and a restart policy that is deliberate
- [ ] a stalled or hostile upstream source degrades to stale-but-honest, never to a restart loop

## Context for whoever picks this up

The disk incident is being handled separately in issue 01. That work buys time. It does not change any of the behaviour described here.
