#!/bin/sh
# The public preview container's entrypoint (ADR-056): the HTTP server never runs as root.
# A Railway volume is mounted at /data owned by root. Started as root, give that one folder to
# the user rws (uid 10001), then drop to rws for good before the server starts. Started as any
# other user (docker run --user 10001), run as that user.
set -eu
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$RWS_DATA_DIR"
  # Only the mount point: everything below it is created by rws.
  chown 10001:10001 "$RWS_DATA_DIR"
  exec setpriv --reuid=10001 --regid=10001 --clear-groups --no-new-privs -- "$@"
fi
exec "$@"
