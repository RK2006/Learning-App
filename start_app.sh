#!/usr/bin/env bash
set -e

ROOT_DIR="/Users/rishabh/Desktop/Learning-App"
BACKEND_DIR="$ROOT_DIR/backend"
FRONTEND_DIR="$ROOT_DIR/frontend"
PYTHON_BIN="/Library/Frameworks/Python.framework/Versions/3.12/bin/python3"

if [ ! -x "$PYTHON_BIN" ]; then
  PYTHON_BIN="/usr/local/bin/python3"
fi

if [ ! -x "$PYTHON_BIN" ]; then
  PYTHON_BIN="/Applications/Xcode.app/Contents/Developer/usr/bin/python3"
fi

if [ ! -x "$PYTHON_BIN" ]; then
  echo "No compatible Python 3 binary found. Install Python or point PYTHON_BIN in this script."
  exit 1
fi

VENV_BIN="$ROOT_DIR/.venv/bin/python"
needs_venv_rebuild=false∏

if [ ! -f "$VENV_BIN" ]; then
  needs_venv_rebuild=true
else
  if ! "$VENV_BIN" -c "import sys; assert sys.version_info >= (3, 10)" >/dev/null 2>&1; then
    needs_venv_rebuild=true
  elif ! "$VENV_BIN" -c "import fastapi, uvicorn, pydantic, openai" >/dev/null 2>&1; then
    needs_venv_rebuild=true
  fi
fi

if [ "$needs_venv_rebuild" = true ]; then
  echo "Rebuilding Python virtual environment..."
  rm -rf "$ROOT_DIR/.venv"
  "$PYTHON_BIN" -m venv "$ROOT_DIR/.venv"
  "$VENV_BIN" -m pip install --upgrade pip >/dev/null
  "$VENV_BIN" -m pip install -r "$ROOT_DIR/backend/requirements.txt"
fi

find_free_port() {
  python3 - <<'PY'
import socket
s = socket.socket()
s.bind(('127.0.0.1', 0))
print(s.getsockname()[1])
s.close()
PY
}

BACKEND_PORT="8000"
FRONTEND_PORT="5173"

if lsof -Pi :"$BACKEND_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  BACKEND_PORT="$(find_free_port)"
fi

if lsof -Pi :"$FRONTEND_PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  FRONTEND_PORT="$(find_free_port)"
fi

cleanup() {
  if [ -n "${BACKEND_PID:-}" ]; then
    kill "$BACKEND_PID" 2>/dev/null || true
  fi
  if [ -n "${FRONTEND_PID:-}" ]; then
    kill "$FRONTEND_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

printf '\nUsing backend port %s\n' "$BACKEND_PORT"
printf 'Using frontend port %s\n\n' "$FRONTEND_PORT"

(
  cd "$BACKEND_DIR"
  export PYTHONPATH="$BACKEND_DIR"
  exec "$VENV_BIN" -m uvicorn app.main:app --host 0.0.0.0 --port "$BACKEND_PORT"
) &
BACKEND_PID=$!

(
  cd "$FRONTEND_DIR"
  export NVM_DIR="$HOME/.nvm"
  . "$NVM_DIR/nvm.sh"
  nvm use 20 >/dev/null
  npm install
  npm run dev -- --host 0.0.0.0 --port "$FRONTEND_PORT"
) &
FRONTEND_PID=$!

wait "$BACKEND_PID"
