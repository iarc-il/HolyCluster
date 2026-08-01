import argparse
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from . import agent, config, github, notify
from .lifecycle import Action, GHFacts, decide
from .state import (PRRecord, load_state, save_state, slugify)

_lock = threading.Lock()


def _update(mutate):
    with _lock:
        recs = load_state(config.state_path())
        mutate(recs)
        save_state(config.state_path(), recs)


def enqueue(tasks: list[str]) -> None:
    def mutate(recs):
        existing = {r.slug for r in recs}
        for task in tasks:
            slug = slugify(task)
            if slug in existing:
                print(f"skip (duplicate slug): {slug}")
                continue
            existing.add(slug)
            recs.append(PRRecord(task=task, slug=slug, branch=f"{config.BRANCH_PREFIX}{slug}",
                                 worktree_path="", phase="queued"))
            print(f"queued: {slug}")
    _update(mutate)


def _set(slug, **fields):
    def mutate(recs):
        for r in recs:
            if r.slug == slug:
                for k, v in fields.items():
                    setattr(r, k, v)
    _update(mutate)


def _guard(slug, fn, *args) -> None:
    """Run a worker job; on ANY failure mark the record blocked + notify.
    This keeps one failing PR from silently killing a pool worker or the loop."""
    try:
        fn(*args)
    except Exception as e:  # noqa: BLE001 - deliberate catch-all at the job boundary
        _set(slug, phase="blocked")
        notify.desktop("Harness: task failed", f"{slug}: {e}")
        print(f"[harness] {slug} BLOCKED by exception: {e!r}")


def _job_implement(rec: PRRecord) -> None:
    path = github.create_worktree(rec.slug, rec.branch)
    _set(rec.slug, worktree_path=path, phase="implementing")
    agent.run(path, agent.IMPLEMENT_TMPL(rec.task))
    if not github.commit_and_push(path, rec.branch, rec.task):
        _set(rec.slug, phase="blocked")
        notify.desktop("Harness: no changes", f"{rec.slug} produced no diff — blocked")
        return
    pr = github.open_pr(path, rec.branch, rec.task, f"Automated PR for: {rec.task}")
    _set(rec.slug, pr_number=pr, phase="ci")


def _job_fix_ci(rec: PRRecord) -> None:
    logs = github.ci_summary(rec.pr_number)[:4000]
    _set(rec.slug, phase="ci_fixing", ci_fix_attempts=rec.ci_fix_attempts + 1)
    agent.run(rec.worktree_path, agent.FIX_CI_TMPL(logs))
    github.commit_and_push(rec.worktree_path, rec.branch, f"Fix CI for {rec.slug}")
    _set(rec.slug, phase="ci")


def _job_address(rec: PRRecord, review) -> None:
    _set(rec.slug, phase="addressing")
    agent.run(rec.worktree_path, agent.ADDRESS_TMPL(review.text))
    github.commit_and_push(rec.worktree_path, rec.branch, f"Address review on {rec.slug}")
    _set(rec.slug, phase="ci", ci_fix_attempts=0, last_handled_review_id=review.id)


def _cleanup(rec: PRRecord) -> None:
    """Bring a merged task to a terminal, valid state: close its tmux window,
    remove the worktree + branch, mark done, notify."""
    github.remove_worktree(rec.worktree_path, rec.branch)
    _set(rec.slug, phase="done")
    notify.desktop("Harness: merged", f"{rec.slug} merged and cleaned up")


def _resume_stalled(rec: PRRecord) -> None:
    """Recover a job whose worker died mid-flight (e.g. a previous `watch`
    process was killed) without redoing work that already happened. Inspects
    ground truth (worktree existence, uncommitted diff, an already-open PR)
    instead of trusting `phase` alone, so it's safe to call repeatedly."""
    if not rec.worktree_path or not Path(rec.worktree_path).exists():
        # Nothing was ever created (or it's gone) — safe to start clean.
        _set(rec.slug, phase="queued", worktree_path="")
        _job_implement(rec)
        return

    dirty = github.has_uncommitted_changes(rec.worktree_path)

    if rec.phase == "implementing":
        if not dirty:
            agent.run(rec.worktree_path, agent.IMPLEMENT_TMPL(rec.task))
        if not github.ensure_committed_and_pushed(rec.worktree_path, rec.branch, rec.task):
            _set(rec.slug, phase="blocked")
            notify.desktop("Harness: no changes", f"{rec.slug} produced no diff — blocked")
            return
        pr = github.find_existing_pr(rec.branch) or github.open_pr(
            rec.worktree_path, rec.branch, rec.task, f"Automated PR for: {rec.task}")
        _set(rec.slug, pr_number=pr, phase="ci")
        return

    if rec.phase == "ci_fixing":
        if not dirty:
            logs = github.ci_summary(rec.pr_number)[:4000] if rec.pr_number else ""
            agent.run(rec.worktree_path, agent.FIX_CI_TMPL(logs))
        github.ensure_committed_and_pushed(rec.worktree_path, rec.branch, f"Fix CI for {rec.slug}")
        _set(rec.slug, phase="ci")
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
        _set(rec.slug, phase="ci", ci_fix_attempts=0,
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
                _set(rec.slug, phase="await_review")
                notify.desktop("Harness: review ready", f"PR #{rec.pr_number} — {rec.slug}")
            elif action == Action.BLOCK:
                _set(rec.slug, phase="blocked")
                notify.desktop("Harness: CI blocked", f"PR #{rec.pr_number} — {rec.slug} needs you")
            elif action == Action.CLEANUP:
                _cleanup(rec)
            else:
                print(f"[resume] {rec.slug}: nothing to do")
    except Exception as e:  # noqa: BLE001 - same job-boundary catch-all as _guard
        _set(rec.slug, phase="blocked")
        notify.desktop("Harness: resume failed", f"{rec.slug}: {e}")
        print(f"[resume] {rec.slug}: FAILED — {e}")


def resume(slugs: list[str] | None) -> None:
    """Inspect state and, for each targeted task, do whatever is needed to
    move it forward — starting/continuing an agent only if the work isn't
    already done. Runs in the foreground, one task at a time (not through the
    concurrent pool `watch` uses), so it's safe to run any time state looks
    stuck, e.g. after a `watch` process died mid-job."""
    recs = load_state(config.state_path())
    targets = [r for r in recs if (not slugs or r.slug in slugs) and r.phase != "done"]
    if not targets:
        print("resume: nothing to do")
        return
    for rec in targets:
        _resume_one(rec)


def _adopt_running(rec: PRRecord) -> None:
    # An agent launched by a prior (crashed) watch is still live in its detached
    # tmux window. Wait for it to finish, then finalize via the idempotent resume
    # path — never start a second agent on the same worktree.
    agent.wait_for(rec.worktree_path)
    _resume_stalled(rec)


def _process_record(rec: PRRecord, inflight: dict, pool) -> None:
    if rec.slug in inflight or rec.phase == "done":
        return
    facts = (github.fetch_facts(rec.pr_number, rec.last_handled_review_id)
             if rec.pr_number else GHFacts("none", None, False))
    # Ground truth wins over local phase: a PR merged while the watcher was down
    # must be cleaned up even if the task was left mid-'ci_fixing'/'addressing'.
    # This runs on every tick, so the first poll at startup reconciles too.
    if facts.merged:
        _cleanup(rec)
        return
    if rec.phase in ("implementing", "ci_fixing", "addressing"):
        # A watch process died mid-job (this one didn't launch it — not in
        # `inflight`). Recover the work instead of stranding it: adopt the agent
        # if its tmux window is still alive, else resume the stalled task. Both
        # go through the idempotent resume path, so finished work is never redone.
        job = _adopt_running if agent.is_running(rec.worktree_path) else _resume_stalled
        inflight[rec.slug] = pool.submit(_guard, rec.slug, job, rec)
        return
    action = decide(rec, facts)
    # Concurrency is capped by the pool's max_workers; extra submissions queue as
    # Futures. `inflight` only prevents double-submitting the same slug.
    if action == Action.IMPLEMENT:
        inflight[rec.slug] = pool.submit(_guard, rec.slug, _job_implement, rec)
    elif action == Action.FIX_CI:
        inflight[rec.slug] = pool.submit(_guard, rec.slug, _job_fix_ci, rec)
    elif action == Action.ADDRESS_REVIEW:
        inflight[rec.slug] = pool.submit(_guard, rec.slug, _job_address, rec, facts.new_review)
    elif action == Action.REQUEST_REVIEW:
        github.rerequest_review(rec.pr_number)
        _set(rec.slug, phase="await_review")
        notify.desktop("Harness: review ready", f"PR #{rec.pr_number} — {rec.slug}")
    elif action == Action.BLOCK:
        _set(rec.slug, phase="blocked")
        notify.desktop("Harness: CI blocked", f"PR #{rec.pr_number} — {rec.slug} needs you")
    elif action == Action.CLEANUP:
        _cleanup(rec)


def _acquire_watch_lock() -> bool:
    """Prevent two watchers from racing on the same state file. Returns False if
    another LIVE watcher already holds the lock (stale/dead locks are taken over)."""
    lock = config.state_path().parent / "watch.pid"
    if lock.exists():
        try:
            other = int(lock.read_text().strip())
            os.kill(other, 0)  # ProcessLookupError if that pid is dead
        except (ValueError, ProcessLookupError):
            pass  # garbage or dead pid -> safe to take over
        else:
            print(f"[harness] another watch is already running (pid {other}); refusing to start.")
            return False
    lock.parent.mkdir(parents=True, exist_ok=True)
    lock.write_text(str(os.getpid()))
    return True


def watch() -> None:
    if not _acquire_watch_lock():
        return
    pool = ThreadPoolExecutor(max_workers=config.MAX_CONCURRENT)
    inflight: dict[str, object] = {}
    print(f"harness watch: polling every {config.POLL_INTERVAL_SECONDS}s (Ctrl-C to stop)")
    while True:
        recs = load_state(config.state_path())
        for slug, fut in list(inflight.items()):
            if fut.done():
                inflight.pop(slug)
        summary = ", ".join(f"{r.slug}={r.phase}" for r in recs) or "(no tasks)"
        print(f"[harness] poll: {summary}")
        for rec in recs:
            try:
                _process_record(rec, inflight, pool)
            except Exception as e:  # noqa: BLE001 - one PR's failure must not crash the poller
                _set(rec.slug, phase="blocked")
                notify.desktop("Harness: watch error", f"{rec.slug}: {e}")
                print(f"[harness] error on {rec.slug}: {e}")
        time.sleep(config.POLL_INTERVAL_SECONDS)


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


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="harness")
    sub = p.add_subparsers(dest="cmd", required=True)
    n = sub.add_parser("new")
    n.add_argument("task", nargs="?")
    n.add_argument("-f", "--file")
    sub.add_parser("watch")
    r = sub.add_parser("resume")
    r.add_argument("slug", nargs="*", help="slug(s) to resume; omit to resume all non-done tasks")
    args = p.parse_args(argv)
    _migrate_legacy_state()
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
    return 1
