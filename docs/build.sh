#!/bin/bash

SCRIPT_DIR=$(dirname -- "$(readlink -f -- "$0")")

pandoc \
    $SCRIPT_DIR/manual.md \
    -o $SCRIPT_DIR/manual.pdf \
    --pdf-engine=pdflatex \
    --toc --toc-depth=3 \
    --number-sections \
    --highlight-style=tango \
    --variable geometry:margin=1in \
    --variable fontsize=12pt \
    --variable documentclass=article \
    --variable colorlinks=true \
    --variable linkcolor=blue \
    --variable urlcolor=blue \
    --variable toccolor=black \
    --metadata title="HolyCluster User Manual" \
    --metadata author="HolyCluster Development Team" \
    --metadata date="$(date '+%B %d, %Y')" \
    --template=default
