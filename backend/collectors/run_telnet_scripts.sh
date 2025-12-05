#!/bin/bash

uv run check_postgres
uv run run_telnet_collectors &
uv run enrich_telnet_spots &
uv run add_spots_to_db &

tail -f /dev/null
