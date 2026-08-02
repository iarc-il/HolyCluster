import argparse
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import agent, config, github, notify
from .lifecycle import Action, GHFacts, decide
from .state import (PRRecord, TERMINAL_PHASES, load_state, new_id, save_state, slugify)

_lock = threading.Lock()


def _update(mutate):
    with _lock:
        recs = load_state(config.state_path())
        mutate(recs)
        save_state(config.state_path(), recs)


def enqueue(tasks: list[str]) -> None:
    def mutate(recs):
        for task in tasks:
            slug = slugify(task)
            rec = PRRecord(id=new_id(), task=task, slug=slug,
                           branch=f"{config.BRANCH_PREFIX}{slug}",
                           worktree_path="", phase="queued")
            recs.append(rec)
            print(f"queued: {slug} (id {rec.id})")
    _update(mutate)


def _set(rec_id, **fields):
    def mutate(recs):
        for r in recs:
            if r.id == rec_id:
                for k, v in fields.items():
                    setattr(r, k, v)
    _update(mutate)


def _guard(rec, fn, *args) -> None:
    """Run a worker job; on ANY failure mark the record blocked + notify.
    This keeps one failing PR from silently killing a pool worker or the loop."""
    try:
        fn(*args)
    except Exception as e:  # noqa: BLE001 - deliberate catch-all at the job boundary
        _set(rec.id, phase="blocked")
        notify.desktop("Harness: task failed", f"{rec.slug}: {e}")
        print(f"[harness] {rec.slug} BLOCKED by exception: {e!r}")


def _job_implement(rec: PRRecord) -> None:
    # Idempotent throughout: create_worktree reattaches to an existing branch and
    # ensure_committed_and_pushed/find_existing_pr tolerate a half-finished prior
    # attempt, so a restarted implement never orphans an already-open PR.
    path = github.create_worktree(rec.slug, rec.branch)
    _set(rec.id, worktree_path=path, phase="implementing")
    agent.run(path, agent.IMPLEMENT_TMPL(rec.task))
    if not github.ensure_committed_and_pushed(path, rec.branch, rec.task):
        _set(rec.id, phase="blocked")
        notify.desktop("Harness: no changes", f"{rec.slug} produced no diff — blocked")
        return
    pr = github.find_existing_pr(rec.branch) or github.open_pr(
        path, rec.branch, rec.task, f"Automated PR for: {rec.task}")
    _set(rec.id, pr_number=pr, phase="ci")


def _job_fix_ci(rec: PRRecord) -> None:
    logs = github.ci_summary(rec.pr_number)[:4000]
    _set(rec.id, phase="ci_fixing", ci_fix_attempts=rec.ci_fix_attempts + 1)
    agent.run(rec.worktree_path, agent.FIX_CI_TMPL(logs))
    github.commit_and_push(rec.worktree_path, rec.branch, f"Fix CI for {rec.slug}")
    _set(rec.id, phase="ci")


def _job_address(rec: PRRecord, review) -> None:
    _set(rec.id, phase="addressing")
    agent.run(rec.worktree_path, agent.ADDRESS_TMPL(review.text))
    github.commit_and_push(rec.worktree_path, rec.branch, f"Address review on {rec.slug}")
    _set(rec.id, phase="ci", ci_fix_attempts=0, last_handled_review_id=review.id)


def _cleanup(rec: PRRecord) -> None:
    """Bring a merged task to a terminal, valid state: close its tmux window,
    remove the worktree + branch, mark done, notify."""
    github.remove_worktree(rec.worktree_path, rec.branch)
    _set(rec.id, phase="done")
    notify.desktop("Harness: merged", f"{rec.slug} merged and cleaned up")


def _abandon(rec: PRRecord) -> None:
    """Terminal state for a PR closed without merging: reclaim the worktree and
    branch, but keep the record distinguishable from a merged one."""
    github.remove_worktree(rec.worktree_path, rec.branch)
    _set(rec.id, phase="closed")
    notify.desktop("Harness: PR closed", f"{rec.slug} closed unmerged — cleaned up")


def _track_missing_checks(rec: PRRecord, facts) -> None:
    """Count consecutive polls that saw no CI checks, so decide() can tell a PR
    that will never have checks from one whose checks have not registered yet."""
    if rec.pr_number is None:
        return
    n = rec.no_check_polls + 1 if facts.ci_status == "none" else 0
    if n != rec.no_check_polls:
        rec.no_check_polls = n
        _set(rec.id, no_check_polls=n)


def _resume_stalled(rec: PRRecord) -> None:
    """Recover a job whose worker died mid-flight (e.g. a previous `watch`
    process was killed) without redoing work that already happened. Inspects
    ground truth (worktree existence, uncommitted diff, an already-open PR)
    instead of trusting `phase` alone, so it's safe to call repeatedly."""
    if not rec.worktree_path or not Path(rec.worktree_path).exists():
        # Nothing was ever created (or it's gone) — safe to start clean.
        _set(rec.id, phase="queued", worktree_path="")
        _job_implement(rec)
        return

    dirty = github.has_uncommitted_changes(rec.worktree_path)

    if rec.phase == "implementing":
        if not dirty:
            agent.run(rec.worktree_path, agent.IMPLEMENT_TMPL(rec.task))
        if not github.ensure_committed_and_pushed(rec.worktree_path, rec.branch, rec.task):
            _set(rec.id, phase="blocked")
            notify.desktop("Harness: no changes", f"{rec.slug} produced no diff — blocked")
            return
        pr = github.find_existing_pr(rec.branch) or github.open_pr(
            rec.worktree_path, rec.branch, rec.task, f"Automated PR for: {rec.task}")
        _set(rec.id, pr_number=pr, phase="ci")
        return

    if rec.phase == "ci_fixing":
        if not dirty:
            logs = github.ci_summary(rec.pr_number)[:4000] if rec.pr_number else ""
            agent.run(rec.worktree_path, agent.FIX_CI_TMPL(logs))
        github.ensure_committed_and_pushed(rec.worktree_path, rec.branch, f"Fix CI for {rec.slug}")
        _set(rec.id, phase="ci")
        return

    if rec.phase == "addressing":
        facts = github.fetch_facts(rec.pr_number, None) if rec.pr_number else None
        review = facts.new_review if facts else None
        if not dirty:
            review_text = (review.text if review
                          else "(review text unavailable — re-check the PR manually)")
            agent.run(rec.worktree_path, agent.ADDRESS_TMPL(review_text))
        github.ensure_committed_and_pushed(rec.worktree_path, rec.branch, f"Address review on {rec.slug}")
        # Record the handled review so the next poll doesn't re-address it forever.
        _set(rec.id, phase="ci", ci_fix_attempts=0,
             last_handled_review_id=(review.id if review else rec.last_handled_review_id))
        return


def _resume_one(rec: PRRecord) -> None:
    print(f"[resume] {rec.slug}: phase={rec.phase}")
    try:
        facts = (github.fetch_facts(rec.pr_number, rec.last_handled_review_id)
                 if rec.pr_number else GHFacts("none", None, False))
        # Ground truth first: a merge that happened while we were down wins over
        # whatever local phase we left the task in.
        if facts.merged:
            print(f"[resume] {rec.slug}: PR merged -> cleanup")
            _cleanup(rec)
            return
        if facts.closed:
            print(f"[resume] {rec.slug}: PR closed unmerged -> abandon")
            _abandon(rec)
            return
        _track_missing_checks(rec, facts)
        if rec.phase == "queued":
            _job_implement(rec)
        elif rec.phase in ("implementing", "ci_fixing", "addressing"):
            _resume_stalled(rec)
        else:
            # ci/await_review/blocked: one lifecycle tick. decide() returns NONE
            # for "blocked", so this never auto-unblocks — it only nudges tasks
            # that already have a legitimate next step.
            action = decide(rec, facts)
            print(f"[resume] {rec.slug}: decide -> {action.name}")
            if action == Action.IMPLEMENT:
                _job_implement(rec)
            elif action == Action.FIX_CI:
                _job_fix_ci(rec)
            elif action == Action.ADDRESS_REVIEW:
                _job_address(rec, facts.new_review)
            elif action == Action.REQUEST_REVIEW:
                github.rerequest_review(rec.pr_number)
                _set(rec.id, phase="await_review")
                notify.desktop("Harness: review ready", f"PR #{rec.pr_number} — {rec.slug}")
            elif action == Action.BLOCK:
                _set(rec.id, phase="blocked")
                notify.desktop("Harness: CI blocked", f"PR #{rec.pr_number} — {rec.slug} needs you")
            elif action == Action.CLEANUP:
                _cleanup(rec)
            elif action == Action.ABANDON:
                _abandon(rec)
            else:
                print(f"[resume] {rec.slug}: nothing to do")
    except Exception as e:  # noqa: BLE001 - same job-boundary catch-all as _guard
        _set(rec.id, phase="blocked")
        notify.desktop("Harness: resume failed", f"{rec.slug}: {e}")
        print(f"[resume] {rec.slug}: FAILED — {e}")


def resume(slugs: list[str] | None) -> None:
    """Inspect state and, for each targeted task, do whatever is needed to
    move it forward — starting/continuing an agent only if the work isn't
    already done. Runs in the foreground, one task at a time (not through the
    concurrent pool `watch` uses), so it's safe to run any time state looks
    stuck, e.g. after a `watch` process died mid-job. Takes the same lock as
    `watch` — a resume racing a live watcher would double-drive the same task."""
    if not _acquire_lock("resume"):
        return
    try:
        recs = load_state(config.state_path())
        targets = [r for r in recs
                   if (not slugs or r.slug in slugs or r.id in slugs)
                   and r.phase not in TERMINAL_PHASES]
        if not targets:
            print("resume: nothing to do")
            return
        for rec in targets:
            _resume_one(rec)
    finally:
        _release_lock()


def _adopt_running(rec: PRRecord) -> None:
    # An agent launched by a prior (crashed) watch is still live in its detached
    # tmux window. Wait for it to finish, then finalize via the idempotent resume
    # path — never start a second agent on the same worktree.
    agent.wait_for(rec.worktree_path)
    _resume_stalled(rec)


def _process_record(rec: PRRecord, inflight: dict, pool) -> None:
    if rec.id in inflight or rec.phase in TERMINAL_PHASES:
        return
    facts = (github.fetch_facts(rec.pr_number, rec.last_handled_review_id)
             if rec.pr_number else GHFacts("none", None, False))
    # Ground truth wins over local phase: a PR merged while the watcher was down
    # must be cleaned up even if the task was left mid-'ci_fixing'/'addressing'.
    # This runs on every tick, so the first poll at startup reconciles too.
    if facts.merged:
        _cleanup(rec)
        return
    if facts.closed:
        _abandon(rec)
        return
    _track_missing_checks(rec, facts)
    if rec.phase in ("implementing", "ci_fixing", "addressing"):
        # A watch process died mid-job (this one didn't launch it — not in
        # `inflight`). Recover the work instead of stranding it: adopt the agent
        # if its tmux window is still alive, else resume the stalled task. Both
        # go through the idempotent resume path, so finished work is never redone.
        job = _adopt_running if agent.is_running(rec.worktree_path) else _resume_stalled
        inflight[rec.id] = pool.submit(_guard, rec, job, rec)
        return
    action = decide(rec, facts)
    # Concurrency is capped by the pool's max_workers; extra submissions queue as
    # Futures. `inflight` only prevents double-submitting the same slug.
    if action == Action.IMPLEMENT:
        inflight[rec.id] = pool.submit(_guard, rec, _job_implement, rec)
    elif action == Action.FIX_CI:
        inflight[rec.id] = pool.submit(_guard, rec, _job_fix_ci, rec)
    elif action == Action.ADDRESS_REVIEW:
        inflight[rec.id] = pool.submit(_guard, rec, _job_address, rec, facts.new_review)
    elif action == Action.REQUEST_REVIEW:
        github.rerequest_review(rec.pr_number)
        _set(rec.id, phase="await_review")
        notify.desktop("Harness: review ready", f"PR #{rec.pr_number} — {rec.slug}")
    elif action == Action.BLOCK:
        _set(rec.id, phase="blocked")
        notify.desktop("Harness: CI blocked", f"PR #{rec.pr_number} — {rec.slug} needs you")
    elif action == Action.CLEANUP:
        _cleanup(rec)
    elif action == Action.ABANDON:
        _abandon(rec)


def _lock_path():
    return config.state_path().parent / "watch.pid"


def _acquire_lock(what: str) -> bool:
    """Serialize the state-driving commands (`watch`, `resume`) ACROSS processes.
    Two of them dispatching on the same record would launch two agents in one
    worktree, each killing the other's tmux window. Returns False if another LIVE
    harness process holds the lock (stale/dead locks are taken over)."""
    lock = _lock_path()
    if lock.exists():
        try:
            other = int(lock.read_text().strip())
            os.kill(other, 0)  # ProcessLookupError if that pid is dead
        except (ValueError, ProcessLookupError):
            pass  # garbage or dead pid -> safe to take over
        else:
            print(f"[harness] another harness process is running (pid {other}); refusing to {what}.")
            return False
    lock.parent.mkdir(parents=True, exist_ok=True)
    lock.write_text(str(os.getpid()))
    return True


def _release_lock() -> None:
    # Only ever drop our OWN lock, never one a successor process took over.
    lock = _lock_path()
    try:
        if lock.exists() and int(lock.read_text().strip()) == os.getpid():
            lock.unlink()
    except (ValueError, OSError):
        pass


def watch() -> None:
    if not _acquire_lock("watch"):
        return
    pool = ThreadPoolExecutor(max_workers=config.MAX_CONCURRENT)
    inflight: dict[str, object] = {}
    print(f"harness watch: polling every {config.POLL_INTERVAL_SECONDS}s (Ctrl-C to stop)")
    try:
        while True:
            recs = load_state(config.state_path())
            for key, fut in list(inflight.items()):
                if fut.done():
                    inflight.pop(key)
            # Terminal records are kept in state.json as history but are never
            # polled, so listing them every tick just buries the live tasks.
            live = [r for r in recs if r.phase not in TERMINAL_PHASES]
            summary = ", ".join(f"{r.slug}={r.phase}" for r in live) or "(no active tasks)"
            finished = len(recs) - len(live)
            print(f"[harness] poll: {summary}" + (f"  (+{finished} finished)" if finished else ""))
            for rec in recs:
                try:
                    _process_record(rec, inflight, pool)
                except Exception as e:  # noqa: BLE001 - one PR's failure must not crash the poller
                    _set(rec.id, phase="blocked")
                    notify.desktop("Harness: watch error", f"{rec.slug}: {e}")
                    print(f"[harness] error on {rec.slug}: {e}")
            time.sleep(config.POLL_INTERVAL_SECONDS)
    except KeyboardInterrupt:
        running = [k for k, f in inflight.items() if not f.done()]
        if running:
            print(f"[harness] stopping — waiting for {len(running)} running agent(s)")
    finally:
        _release_lock()


def status() -> None:
    recs = load_state(config.state_path())
    if not recs:
        print("no tasks")
        return
    width = max(len(r.slug) for r in recs)
    for r in recs:
        pr = f"#{r.pr_number}" if r.pr_number else "-"
        extra = f" ci_fixes={r.ci_fix_attempts}" if r.ci_fix_attempts else ""
        print(f"{r.id}  {r.phase:<12} {pr:>6}  {r.slug:<{width}}{extra}")


def _match(recs, keys):
    return [r for r in recs if r.id in keys or r.slug in keys]


def retry(keys: list[str]) -> None:
    """Give a blocked task a way back into the lifecycle. decide() never
    auto-unblocks, and _guard blocks on any exception including transient gh
    failures, so without this the only recovery is hand-editing state.json.
    Deliberately does NOT take the lock: unblocking a task while `watch` runs
    is the point, and a live watcher picks the record up on its next poll."""
    recs = load_state(config.state_path())
    targets = [r for r in _match(recs, keys) if r.phase == "blocked"]
    if not targets:
        print("retry: no matching blocked task")
        return
    ids = {r.id for r in targets}

    def mutate(rs):
        for r in rs:
            if r.id in ids:
                r.phase = "ci" if r.pr_number else "queued"
                r.ci_fix_attempts = 0
                r.no_check_polls = 0
                print(f"retry: {r.slug} -> {r.phase}")
    _update(mutate)


def cancel(keys: list[str], close_pr: bool) -> None:
    """Abandon a task: kill its agent window, reclaim the worktree and branch,
    and drop the record. Leaves any open PR alone unless --close-pr, since
    closing it is an outward-facing action worth asking for explicitly."""
    recs = load_state(config.state_path())
    targets = _match(recs, keys)
    if not targets:
        print("cancel: no matching task")
        return
    for rec in targets:
        github.remove_worktree(rec.worktree_path, rec.branch)
        if rec.pr_number:
            if close_pr:
                github.close_pr(rec.pr_number)
                print(f"cancel: closed PR #{rec.pr_number}")
            else:
                print(f"cancel: PR #{rec.pr_number} left open (--close-pr to close it)")
        _update(lambda rs, i=rec.id: rs.__setitem__(
            slice(None), [r for r in rs if r.id != i]))
        print(f"cancelled: {rec.slug}")


def _migrate_legacy_state() -> None:
    """One-time safety net: earlier builds wrote state under the *worktree* root
    (repo_root) rather than the shared main-checkout root. If a stray legacy file
    exists and the canonical one doesn't, adopt it so tasks aren't stranded."""
    legacy = config.repo_root() / ".harness" / "state.json"
    canonical = config.state_path()
    if legacy != canonical and legacy.exists() and not canonical.exists():
        canonical.parent.mkdir(parents=True, exist_ok=True)
        canonical.write_text(legacy.read_text())
        print(f"[harness] migrated legacy state {legacy} -> {canonical}")


def _backfill_ids() -> None:
    """Assign a stable id to any legacy record created before ids existed."""
    recs = load_state(config.state_path())
    changed = False
    for r in recs:
        if not r.id:
            r.id = new_id()
            changed = True
    if changed:
        save_state(config.state_path(), recs)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="harness")
    sub = p.add_subparsers(dest="cmd", required=True)
    n = sub.add_parser("new")
    n.add_argument("task", nargs="?")
    n.add_argument("-f", "--file")
    sub.add_parser("watch")
    sub.add_parser("status")
    r = sub.add_parser("resume")
    r.add_argument("slug", nargs="*", help="id(s) or slug(s) to resume; omit to resume all non-done tasks")
    t = sub.add_parser("retry")
    t.add_argument("slug", nargs="+", help="id(s) or slug(s) of blocked task(s) to put back in the lifecycle")
    c = sub.add_parser("cancel")
    c.add_argument("slug", nargs="+", help="id(s) or slug(s) to abandon")
    c.add_argument("--close-pr", action="store_true", help="also close the task's PR on GitHub")
    args = p.parse_args(argv)
    _migrate_legacy_state()
    _backfill_ids()
    if args.cmd == "new":
        if args.file:
            tasks = [l.strip() for l in open(args.file) if l.strip()]
        elif args.task:
            tasks = [args.task]
        else:
            print("provide a task string or -f <file>")
            return 2
        enqueue(tasks)
        return 0
    if args.cmd == "watch":
        watch()
        return 0
    if args.cmd == "resume":
        resume(args.slug or None)
        return 0
    if args.cmd == "status":
        status()
        return 0
    if args.cmd == "retry":
        retry(args.slug)
        return 0
    if args.cmd == "cancel":
        cancel(args.slug, args.close_pr)
        return 0
    return 1
