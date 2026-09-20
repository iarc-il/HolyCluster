#!/usr/bin/env bash
set -euo pipefail

user=$1
host=$2
path=$3
remote="$user@$host"
destination="$remote:$path"

rsync -avz ui/dist/assets/ "$destination/assets/"
rsync -avz --delete --exclude assets/ ui/dist/ "$destination/"
printf -v assets_path "%q" "$path/assets"
ssh "$remote" "find $assets_path -type f -mtime +14 -delete"
