#!/usr/bin/env bash
set -euo pipefail

user=$1
host=$2
path=$3
remote="$user@$host"
destination="$remote:$path"

rsync -avz ui/dist/assets/ "$destination/assets/"
# An open tab can request an old lazy chunk at any time.
rsync -avz --delete --exclude assets/ --exclude index.html ui/dist/ "$destination/"
rsync -avzc ui/dist/index.html "$destination/index.html"
