import argparse
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from . import agent, config, github, notify
from .lifecycle import Action, decide
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
    logs = github._run(["gh", "pr", "checks", str(rec.pr_number)])[:4000]
    _set(rec.slug, phase="ci_fixing", ci_fix_attempts=rec.ci_fix_attempts + 1)
    agent.run(rec.worktree_path, agent.FIX_CI_TMPL(logs))
    github.commit_and_push(rec.worktree_path, rec.branch, f"Fix CI for {rec.slug}")
    _set(rec.slug, phase="ci")


def _job_address(rec: PRRecord, review) -> None:
    _set(rec.slug, phase="addressing")
    agent.run(rec.worktree_path, agent.ADDRESS_TMPL(review.text))
    github.commit_and_push(rec.worktree_path, rec.branch, f"Address review on {rec.slug}")
    _set(rec.slug, phase="ci", ci_fix_attempts=0, last_handled_review_id=review.id)


def watch() -> None:
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
            if rec.slug in inflight:
                continue
            if rec.phase in ("implementing", "ci_fixing", "addressing"):
                # No worker in THIS process is tracking it (else it'd be in
                # `inflight`), so it's orphaned from a watch process that died
                # mid-job. Surface it instead of silently doing nothing forever.
                _set(rec.slug, phase="blocked")
                notify.desktop(
                    "Harness: orphaned job",
                    f"{rec.slug} was mid-'{rec.phase}' with no active worker "
                    f"(a previous watch process likely died) — check {rec.worktree_path}",
                )
                continue
            facts = (github.fetch_facts(rec.pr_number, rec.last_handled_review_id)
                     if rec.pr_number else None)
            from .lifecycle import GHFacts
            facts = facts or GHFacts("none", None, False)
            action = decide(rec, facts)
            # Concurrency is capped by the pool's max_workers; extra submissions
            # simply queue as Futures. `inflight` only prevents double-submitting
            # the same slug. No second concurrency gate is needed.
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
                github.remove_worktree(rec.worktree_path, rec.branch)
                _set(rec.slug, phase="done")
                notify.desktop("Harness: merged", f"{rec.slug} merged and cleaned up")
        time.sleep(config.POLL_INTERVAL_SECONDS)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="harness")
    sub = p.add_subparsers(dest="cmd", required=True)
    n = sub.add_parser("new")
    n.add_argument("task", nargs="?")
    n.add_argument("-f", "--file")
    sub.add_parser("watch")
    args = p.parse_args(argv)
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
    return 1
