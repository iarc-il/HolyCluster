#!/usr/bin/bash
cd /app/
source .venv/bin/activate
uv run collectors/db/cleanup_database.py
