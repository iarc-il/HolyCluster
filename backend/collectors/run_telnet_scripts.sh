#!/bin/bash

# database check/init script first.
uv run check_postgres

# telnet collectors
uv run run_telnet_collectors &

# enricher for telnet spots
uv run enrich_telnet_spots &

# add enriched telnet spots to postgres
uv run add_spots_to_db &

# Wait for any background process to exit
# wait -n
#
# Exit with the status of the first process that exited
# exit $?

tail -f /dev/null
