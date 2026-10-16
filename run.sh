# RupeePulse — one command to run everything.
# Backend : http://127.0.0.1:8010  (FastAPI + Binance streams)
# Frontend: http://localhost:5173   (Vite dev server, proxies /api and /ws)

set -e
ROOT="$(cd "$(dirname "$0")" && pwd)"

if ! curl -s -m 2 -o /dev/null http://127.0.0.1:8010/api/health; then
  echo "[run] starting backend on :8010 ..."
  cd "$ROOT/APis"
  if [ ! -d venv ]; then
    echo "[run] creating Python venv"
    python3 -m venv venv
    ./venv/bin/pip install -q -r requirements.txt
  fi
  setsid nohup ./venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8010 \
    > "$ROOT/APis/backend.log" 2>&1 < /dev/null &
  for i in $(seq 1 30); do
    sleep 1
    if curl -s -m 2 -o /dev/null http://127.0.0.1:8010/api/health; then
      echo "[run] backend ready"
      break
    fi
  done
else
  echo "[run] backend already running on :8010"
fi

echo "[run] starting frontend on :5173 ..."
cd "$ROOT/ui"
if [ ! -d node_modules ]; then
  echo "[run] installing npm dependencies"
  npm install
fi
exec npm run dev
