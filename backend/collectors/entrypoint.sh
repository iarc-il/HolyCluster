#!/bin/bash
# Exit immediately if a command exits with a non-zero status.
set -e

# Run the database check/init script first.
echo "--- Checking database state ---"
uv run collectors/src/db/check_postgres.py

# Now, run the main collector script.
#echo "--- Starting collector ---"
#python collectors/src/run_collector.py

# If you want the container to stay running even if the main script
# finishes, you can add this line at the end:
# exec tail -f /dev/null
