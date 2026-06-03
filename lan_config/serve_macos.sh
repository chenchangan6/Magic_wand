#!/bin/sh
set -eu

cd "$(dirname "$0")"

START_PATH="${MAGIC_START_PATH:-/}"
case "$START_PATH" in
  /*) ;;
  *) START_PATH="/$START_PATH" ;;
esac

PYTHON_BIN=""
if command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="$(command -v python3)"
elif command -v python >/dev/null 2>&1; then
  PYTHON_BIN="$(command -v python)"
fi

if [ -z "$PYTHON_BIN" ]; then
  echo "Python 3 was not found."
  echo "Install Python 3 from https://www.python.org/downloads/macos/ and run this launcher again."
  echo
  echo "Press Enter to close."
  read _unused
  exit 1
fi

PORT="$("$PYTHON_BIN" - <<'PY'
import socket
for port in range(8777, 8788):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", port))
        print(port)
        break
    except OSError:
        pass
    finally:
        s.close()
else:
    raise SystemExit("No free localhost port found in the 8777-8787 range.")
PY
)"

export MAGIC_LAN_PORT="$PORT"
URL="http://127.0.0.1:${PORT}${START_PATH}"
STATUS_URL="http://127.0.0.1:${PORT}/api/status"

echo "MagicWand local tool starting at $URL"
"$PYTHON_BIN" serve.py &
SERVER_PID=$!

cleanup() {
  if kill -0 "$SERVER_PID" >/dev/null 2>&1; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

i=0
while [ "$i" -lt 50 ]; do
  if "$PYTHON_BIN" - "$STATUS_URL" <<'PY' >/dev/null 2>&1
import sys
from urllib.request import urlopen
urlopen(sys.argv[1], timeout=0.5).read()
PY
  then
    break
  fi
  i=$((i + 1))
  sleep 0.2
done

open "$URL"

echo
echo "The local service is running. Keep this Terminal window open while using the page."
echo "Press Ctrl+C to stop it."
wait "$SERVER_PID"
