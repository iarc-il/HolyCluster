#!/bin/bash

uv run collectors/src/telnet_collectors/run_telnet_collectors.py &

uv run collectors/src/enrichers/enrich_telnet_spots.py &

uv run collectors/src/db/add_enriched_telnet_spots_to_postres.py &

# Wait for any background process to exit
# wait -n
#
# Exit with the status of the first process that exited
# exit $?

tail -f /dev/null
