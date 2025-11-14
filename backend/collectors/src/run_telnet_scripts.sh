#!/bin/bash

# database check/init script first.
uv run collectors/src/db/check_postgres.py

# telnet collectors
uv run collectors/src/telnet_collectors/run_telnet_collectors.py &

# enricher for telnet spots
uv run collectors/src/enrichers/enrich_telnet_spots.py &

# add enriched telnet spots to postgres
uv run collectors/src/db/add_enriched_telnet_spots_to_postgres.py &

# Wait for any background process to exit
# wait -n
#
# Exit with the status of the first process that exited
# exit $?

tail -f /dev/null
