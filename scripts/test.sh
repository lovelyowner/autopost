#!/bin/bash
set -e
ROOT="/home/user/.gemini/antigravity/scratch/polypost"
export PATH="$ROOT/.tools/node-v22.11.0-linux-x64/bin:$PATH"

echo "=== Running TypeScript / Vitest Tests ==="
cd "$ROOT"
"$ROOT/.tools/node-v22.11.0-linux-x64/bin/node" node_modules/vitest/vitest.mjs run

echo "=== Running Python Pytest Suite ==="
cd "$ROOT/apps/stealth-browser-worker"
PYTHONPATH=. "$ROOT/.venv/bin/pytest" -q

echo "=== All PolyPost Test Suites Passed ==="
