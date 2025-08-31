#!/usr/bin/bash
cd /app/
source .venv/bin/activate
uv run collectors/src/db/cleanup_database.py 

