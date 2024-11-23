

def string_to_boolean(value: str) -> bool:
    if value.strip().lower() == "true":
        return True
    elif value.strip().lower() == "false":
        return False
