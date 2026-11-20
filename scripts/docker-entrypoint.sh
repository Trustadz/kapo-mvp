#!/bin/sh
set -eu

# Bind-mounted host folders are created by Docker as root on a fresh checkout.
# Fix their ownership once per start, then run the app as the unprivileged
# kapo user. This is the same pattern used by official Postgres/Redis images.
if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data/uploads /backup
  chown -R kapo:kapo /app/data /backup
  exec gosu kapo "$@"
fi

exec "$@"
