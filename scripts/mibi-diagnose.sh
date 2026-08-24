#!/usr/bin/env bash
# Diagnoses the "No active receiving account is bound for currency" error by
# replicating the admin panel's own example against the configured gateway:
# one WALLET charge and one CRYPTO charge with identical amount/currency.
# Run from a machine that can reach the gateway (Cuban IP, VPN off):
#   bash scripts/mibi-diagnose.sh
# Reads MIBI_* from ./.env. Creates real (dev) charges with unique
# idempotency keys; nobody pays them, they just expire.
set -euo pipefail

cd "$(dirname "$0")/.."
set -a; source <(grep -E '^MIBI_' .env); set +a

BASE="${MIBI_API_BASE:-https://mibilletera.cu}"
CURRENCY="${MIBI_CURRENCY:-USD}"
STAMP=$(date +%s)

echo "Gateway: $BASE  currency: $CURRENCY  key: ${MIBI_KEY_ID:0:12}..."
echo

run_charge() {
  local method="$1"
  echo "== POST /api/merchant/charges/ method=$method =="
  curl -sS --max-time 20 -X POST "$BASE/api/merchant/charges/" \
    -H "X-API-Key-Id: $MIBI_KEY_ID" \
    -H "X-API-Key-Secret: $MIBI_SECRET_KEY" \
    -H "Content-Type: application/json" \
    -d "{\"method\":\"$method\",\"amount\":\"50.00\",\"currency\":\"$CURRENCY\",\"idempotency_key\":\"jade-diag-${method,,}-$STAMP\",\"metadata\":{\"purpose\":\"diagnostic\"}}" \
    | python3 -m json.tool || echo "(request failed)"
  echo
}

run_charge WALLET
run_charge CRYPTO

cat <<'EOT'
How to read the results:
- WALLET ok + CRYPTO 400 "No active receiving account..." -> the store's USD
  account only serves WALLET; either ask support to provision CRYPTO, or set
  MIBI_METHOD=WALLET in .env and restart the API.
- Both 400 -> the account binding is not effective for this store/API key;
  send support the store id, key id and both responses.
- Both ok -> nothing wrong on their side; retest through the app and if it
  still fails, compare this payload with the API log line.
Keep the WALLET response body: its action_payload shape drives how the
storefront must render that method.
EOT
