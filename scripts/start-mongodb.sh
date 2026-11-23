#!/bin/bash
set -euo pipefail

keyfile="$(mktemp)"
trap 'rm -f "$keyfile"' EXIT
printf '%s' "$MONGO_REPLICA_KEY" > "$keyfile"
chown mongodb:mongodb "$keyfile"
chmod 400 "$keyfile"

exec docker-entrypoint.sh mongod --replSet rs0 --bind_ip_all --keyFile "$keyfile"
