import subprocess


def run(worktree_path: str, prompt: str) -> None:
    subprocess.run(["opencode", "run", prompt], cwd=worktree_path, check=True)


def IMPLEMENT_TMPL(task: str) -> str:
    return (
        f"Implement the following task fully and correctly in this repository. "
        f"Follow existing code conventions and add or update tests. "
        f"Do NOT commit, push, or open a PR — just make the code changes.\n\n"
        f"TASK: {task}"
    )


def FIX_CI_TMPL(logs: str) -> str:
    return (
        f"CI is failing on this branch. Diagnose and fix the root cause so all "
        f"checks pass. Do NOT commit or push — just fix the code.\n\n"
        f"FAILING CI LOG (truncated):\n{logs}"
    )


def ADDRESS_TMPL(review_text: str) -> str:
    return (
        f"A human reviewer left the following feedback on this PR. Address every "
        f"point by changing the code. Do NOT commit, push, or resolve threads.\n\n"
        f"REVIEW FEEDBACK:\n{review_text}"
    )
