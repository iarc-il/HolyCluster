#!/bin/bash

uv run check_postgres

pids=()

trap 'for pid in ${pids[*]}; do kill $pid done; exit' INT

uv run run_telnet_collectors &
pids+=($!)

uv run enrich_telnet_spots &
pids+=($!)

uv run add_spots_to_db &
pids+=($!)

echo THE PIDS: $pids

tail -f /dev/null
