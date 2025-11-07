#!/bin/bash

uv run collectors/src/telnet_collectors/run_telnet_collectors.py &

uv run collectors//src/enrichers/enrich_telnet_spots.py &

# Wait for any background process to exit
# wait -n
#
# Exit with the status of the first process that exited
# exit $?

tail -f /dev/null
