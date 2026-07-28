import subprocess


def desktop(title: str, message: str) -> None:
    try:
        subprocess.run(["notify-send", title, message], check=False)
    except FileNotFoundError:
        pass  # notify-send absent; the GitHub re-request is the durable signal
