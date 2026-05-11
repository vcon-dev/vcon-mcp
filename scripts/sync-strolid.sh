#!/usr/bin/env bash
# Sync Strolid vCons: S3 → local cache → DB import → embeddings.
#
# Usage:
#   scripts/sync-strolid.sh <YYYY-MM>            # full month
#   scripts/sync-strolid.sh <YYYY-MM-DD>         # single day
#   scripts/sync-strolid.sh <YYYY-MM> --no-s3    # skip download, use local cache
#   scripts/sync-strolid.sh <YYYY-MM> --no-embed # skip post-import embedding
#
# Env:
#   VCON_S3_BUCKET     (optional) default: vcons
#   VCON_S3_PREFIX     (optional) S3 key prefix, default: '' (bucket root)
#   STROLID_LOCAL_ROOT (optional) default: /Volumes/T9/test-vcons/strolid
#   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY (from .env)

set -euo pipefail

DATE_ARG="${1:-}"
if [[ -z "$DATE_ARG" ]]; then
  echo "Usage: $0 <YYYY-MM | YYYY-MM-DD> [--no-s3] [--no-embed]" >&2
  exit 2
fi
shift || true

NO_S3=false
NO_EMBED=false
for arg in "$@"; do
  case "$arg" in
    --no-s3)    NO_S3=true ;;
    --no-embed) NO_EMBED=true ;;
    *) echo "Unknown flag: $arg" >&2; exit 2 ;;
  esac
done

# Parse YYYY-MM or YYYY-MM-DD into path segments
if [[ "$DATE_ARG" =~ ^([0-9]{4})-([0-9]{2})$ ]]; then
  YEAR="${BASH_REMATCH[1]}"; MONTH="${BASH_REMATCH[2]}"; DAY=""
  SUBPATH="$YEAR/$MONTH"
elif [[ "$DATE_ARG" =~ ^([0-9]{4})-([0-9]{2})-([0-9]{2})$ ]]; then
  YEAR="${BASH_REMATCH[1]}"; MONTH="${BASH_REMATCH[2]}"; DAY="${BASH_REMATCH[3]}"
  SUBPATH="$YEAR/$MONTH/$DAY"
else
  echo "Date must be YYYY-MM or YYYY-MM-DD, got: $DATE_ARG" >&2
  exit 2
fi

LOCAL_ROOT="${STROLID_LOCAL_ROOT:-/Volumes/T9/test-vcons/strolid}"
S3_BUCKET="${VCON_S3_BUCKET:-vcons}"
S3_PREFIX="${VCON_S3_PREFIX:-}"
# Normalize prefix: strip leading slash, ensure trailing slash if non-empty
S3_PREFIX="${S3_PREFIX#/}"
[[ -n "$S3_PREFIX" ]] && S3_PREFIX="${S3_PREFIX%/}/"
LOCAL_DIR="$LOCAL_ROOT/$SUBPATH"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

echo "════════════════════════════════════════════════════"
echo " Strolid sync: $DATE_ARG"
echo "  Local dir:  $LOCAL_DIR"
echo "  S3 sync:    $([[ $NO_S3 == true ]] && echo skipped || echo enabled)"
echo "  Embeddings: $([[ $NO_EMBED == true ]] && echo skipped || echo enabled)"
echo "════════════════════════════════════════════════════"

# ─── 1. S3 → local cache ────────────────────────────────────────────────────
if [[ "$NO_S3" == false ]]; then
  if ! command -v aws >/dev/null 2>&1; then
    echo "aws CLI not found on PATH." >&2
    exit 1
  fi
  mkdir -p "$LOCAL_DIR"
  S3_URL="s3://$S3_BUCKET/${S3_PREFIX}${SUBPATH}/"
  echo
  echo "→ aws s3 sync $S3_URL $LOCAL_DIR"
  aws s3 sync "$S3_URL" "$LOCAL_DIR"
else
  if [[ ! -d "$LOCAL_DIR" ]]; then
    echo "Local dir does not exist: $LOCAL_DIR (and --no-s3 was passed)" >&2
    exit 1
  fi
fi

# ─── 2. Import + embed ──────────────────────────────────────────────────────
IMPORT_ARGS=("$LOCAL_DIR")
[[ "$NO_EMBED" == true ]] && IMPORT_ARGS+=(--skip-embed)

echo
echo "→ npx tsx scripts/import-vcon-files.ts ${IMPORT_ARGS[*]}"
exec npx tsx scripts/import-vcon-files.ts "${IMPORT_ARGS[@]}"
