#!/usr/bin/env bash
# Generates every image in art-src/jobs.tsv that is not in art-src/gen/ yet,
# through ChatGPT (Warren's Plus account) via the codex CLI's image tool,
# N at a time. Each prompt = art-src/header.txt + " --- " + the job's prompt.
#   bash art-src/tools/gen.sh [concurrency=3] [name-filter-regex]
set -u
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
GEN="$ROOT/art-src/gen"; mkdir -p "$GEN"
BIN="$HOME/.claude/skills/gpt-image-bridge/bin/gpt-image-2"
N="${1:-3}"; FILTER="${2:-.}"
HEADER="$(tr -d '\r' < "$ROOT/art-src/header.txt")"

run() {
  local name="$1" size="$2" prompt="$3"
  if "$BIN" "$HEADER --- $prompt" "$GEN/$name.png" --size "$size" > "$GEN/_log-$name.txt" 2>&1; then
    echo "ok   $name"
  else
    echo "FAIL $name (see gen/_log-$name.txt)"
  fi
}

while IFS=$'\t' read -r name size prompt; do
  [ -z "$name" ] && continue
  [[ "$name" =~ $FILTER ]] || continue
  [ -f "$GEN/$name.png" ] && continue
  while [ "$(jobs -rp | wc -l)" -ge "$N" ]; do sleep 5; done
  run "$name" "$size" "${prompt%$'\r'}" &
done < "$ROOT/art-src/jobs.tsv"
wait
echo done
