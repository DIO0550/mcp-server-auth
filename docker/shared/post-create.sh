#!/usr/bin/env bash
set -euo pipefail

if [ -f package.json ]; then
  echo "(root) installing root dependencies if present"
  npm install --no-audit --no-fund || true
fi

# Just placeholder scaffolds for each service if missing
SERVICES=(docker/auth-server docker/login-web docker/api-server docker/mcp-server)
for S in "${SERVICES[@]}"; do
  if [ ! -f "$S/package.json" ]; then
    echo "Scaffolding $S"
    mkdir -p "$S/src"
    cat > "$S/package.json" <<'JSON'
{
  "name": "temp-service",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "node src/index.js"
  },
  "dependencies": {},
  "devDependencies": {}
}
JSON
    echo "console.log('placeholder service running');" > "$S/src/index.js"
  fi
  (cd "$S" && npm install --no-audit --no-fund || true)
 done

echo "Post-create completed"
