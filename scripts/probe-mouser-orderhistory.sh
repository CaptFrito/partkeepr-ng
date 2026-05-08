#!/bin/bash
# Probe the Mouser Order History API to learn its wire format.
#
# Reads PARTKEEPR_MOUSER_ORDER_KEY from backend/.env (same place the
# other distributor creds live; never on the command line).
#
# Usage:
#   scripts/probe-mouser-orderhistory.sh                          # date-range probe (last 90 days)
#   scripts/probe-mouser-orderhistory.sh <salesOrderNumber>       # single-order probe
#   scripts/probe-mouser-orderhistory.sh --web <webOrderNumber>   # web-order probe
#
# Prints the raw JSON response (or HTTP status + body if non-2xx).

set -euo pipefail

cd "$(dirname "$0")/.."

ENV_FILE="backend/.env"
if [ ! -f "$ENV_FILE" ]; then
    echo "Missing $ENV_FILE — add PARTKEEPR_MOUSER_ORDER_KEY=<your-key> there first." >&2
    exit 1
fi

# shellcheck disable=SC1090
set -a
. "$ENV_FILE"
set +a

if [ -z "${PARTKEEPR_MOUSER_ORDER_KEY:-}" ]; then
    echo "PARTKEEPR_MOUSER_ORDER_KEY not set in $ENV_FILE." >&2
    exit 1
fi

BASE="https://api.mouser.com/api/v1/orderhistory"
KEY="$PARTKEEPR_MOUSER_ORDER_KEY"

# Mouser dates are mm/dd/yyyy (US format), not ISO 8601 — confirmed
# from the live ByDateRange swagger doc. URL-encode the slashes so
# query parsing is unambiguous.
fmt_us_date() { date -u -d "$1" +%m/%d/%Y | sed 's|/|%2F|g'; }

probe() {
    local label="$1"; shift
    local url="$1"; shift
    echo "=== $label ==="
    echo "URL: $url"
    # `--get` ensures we don't accidentally turn a query-only call into POST.
    # Mouser's Search API uses GET for "ByPartNumber" etc.; Order History
    # is consistent with that pattern in the path naming.
    local out status
    out=$(curl -sS -w "\nHTTP %{http_code}" "$url" "$@" || true)
    echo "$out"
    echo
}

if [ "${1:-}" = "--web" ]; then
    NUM="${2:?web order number required}"
    probe "ByWebOrderNumber" \
        "${BASE}/ByWebOrderNumber?webOrderNumber=${NUM}&apiKey=${KEY}"
elif [ -n "${1:-}" ]; then
    NUM="$1"
    probe "BySalesOrderNumber" \
        "${BASE}/BySalesOrderNumber?salesOrderNumber=${NUM}&apiKey=${KEY}"
else
    # Default: last 90 days via ByDateRange. Confirmed format from
    # swagger: mm/dd/yyyy, slashes URL-encoded.
    END=$(fmt_us_date "now")
    START=$(fmt_us_date "90 days ago")
    probe "ByDateRange (last 90 days)" \
        "${BASE}/ByDateRange?startDate=${START}&endDate=${END}&apiKey=${KEY}"
fi
