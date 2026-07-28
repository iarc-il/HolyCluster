from dataclasses import dataclass
from enum import Enum, auto
from typing import Optional

from .config import MAX_CI_FIX_ATTEMPTS
from .state import PRRecord


class Action(Enum):
    NONE = auto()
    IMPLEMENT = auto()
    FIX_CI = auto()
    REQUEST_REVIEW = auto()
    ADDRESS_REVIEW = auto()
    BLOCK = auto()
    CLEANUP = auto()


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


def decide(record: PRRecord, facts: GHFacts) -> Action:
    if facts.merged:
        return Action.CLEANUP
    if record.phase == "blocked":
        return Action.NONE
    if record.phase == "queued":
        return Action.IMPLEMENT
    if record.pr_number is None:
        return Action.NONE
    if facts.new_review is not None:
        return Action.ADDRESS_REVIEW
    if facts.ci_status == "failure":
        if record.ci_fix_attempts < MAX_CI_FIX_ATTEMPTS:
            return Action.FIX_CI
        return Action.BLOCK
    if facts.ci_status == "success" and record.phase != "await_review":
        return Action.REQUEST_REVIEW
    return Action.NONE
