#!/bin/bash

# database check/init script first.
uv run src/db/check_postgres.py

# telnet collectors
uv run src/telnet_collectors/run_telnet_collectors.py &

# enricher for telnet spots
uv run src/enrichers/enrich_telnet_spots.py &

# add enriched telnet spots to postgres
uv run src/db/add_enriched_telnet_spots_to_postgres.py &

# Wait for any background process to exit
# wait -n
#
# Exit with the status of the first process that exited
# exit $?

tail -f /dev/null
