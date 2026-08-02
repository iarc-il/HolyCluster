from dataclasses import dataclass, field
from enum import Enum, auto
from typing import Optional

from .config import MAX_CI_FIX_ATTEMPTS, NO_CHECK_GRACE_POLLS
from .review import ReviewState
from .state import PRRecord


class Action(Enum):
    NONE = auto()
    IMPLEMENT = auto()
    FIX_CI = auto()
    REQUEST_REVIEW = auto()
    ADDRESS_REVIEW = auto()
    BLOCK = auto()
    CLEANUP = auto()
    ABANDON = auto()
    REPORT_ADDRESSED = auto()


@dataclass
class Review:
    id: int
    state: str
    text: str


@dataclass
class GHFacts:
    ci_status: str  # "none" | "pending" | "success" | "failure"
    new_review: Optional[Review]
    merged: bool
    closed: bool = False
    review: ReviewState = field(default_factory=ReviewState)


def decide(record: PRRecord, facts: GHFacts) -> Action:
    if facts.merged:
        return Action.CLEANUP
    if facts.closed:
        return Action.ABANDON
    if record.phase == "blocked":
        return Action.NONE
    if record.phase == "queued":
        return Action.IMPLEMENT
    if record.pr_number is None:
        return Action.NONE
    if facts.review.pending or facts.new_review is not None:
        return Action.ADDRESS_REVIEW
    if facts.ci_status == "failure":
        if record.ci_fix_attempts < MAX_CI_FIX_ATTEMPTS:
            return Action.FIX_CI
        return Action.BLOCK
    # "none" means this PR has no checks at all — every workflow here is
    # paths-filtered, so a PR outside backend/catserver/ui legitimately gets none.
    # Requiring several consecutive empty polls distinguishes that from checks
    # that simply have not registered yet, instead of stalling in `ci` forever.
    ready = facts.ci_status == "success" or (
        facts.ci_status == "none" and record.no_check_polls >= NO_CHECK_GRACE_POLLS)
    if not ready:
        return Action.NONE
    # Unresolved threads that are no longer pending all carry an agent reply:
    # the human's turn to resolve, push back, or merge.
    if facts.review.unresolved > 0:
        if record.phase != "review_addressed":
            return Action.REPORT_ADDRESSED
    elif record.phase != "await_review":
        return Action.REQUEST_REVIEW
    return Action.NONE
