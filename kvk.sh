#!/usr/bin/env bash
# -----------------------------------------------------------------------------
# kvk.sh — kleine wrapper rond de KVK Handelsregister API.
#
# Gebruik:
#   ./kvk.sh zoeken naam=test [plaats=Amsterdam] [type=hoofdvestiging] [...]
#   ./kvk.sh basisprofiel <kvkNummer> [vestigingen]
#   ./kvk.sh vestiging <vestigingsnummer>
#   ./kvk.sh naamgeving <kvkNummer>
#
# Configuratie (env-vars, of via .env in deze map):
#   KVK_API_KEY  API-key (header "apikey"). Verplicht.
#   KVK_BASE     Base-URL. Default: https://api.kvk.nl/test/api (testomgeving)
#                Productie: https://api.kvk.nl/api
# -----------------------------------------------------------------------------
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Laad .env als de variabelen nog niet gezet zijn (alleen KVK_*-regels).
if [[ -f "$SCRIPT_DIR/.env" ]]; then
  while IFS='=' read -r key value; do
    [[ "$key" =~ ^(KVK_API_KEY|KVK_BASE)$ ]] || continue
    value="${value%\"}"; value="${value#\"}"
    if [[ -z "${!key:-}" ]]; then
      export "$key=$value"
    fi
  done < <(grep -E '^(KVK_API_KEY|KVK_BASE)=' "$SCRIPT_DIR/.env" || true)
fi

KVK_BASE="${KVK_BASE:-https://api.kvk.nl/test/api}"
KVK_BASE="${KVK_BASE%/}"

usage() {
  sed -n '2,15p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

die() { echo "kvk.sh: $*" >&2; exit 1; }

[[ -n "${KVK_API_KEY:-}" ]] || die "KVK_API_KEY is niet gezet (zie .env.example)"

# URL-encode één waarde (zonder externe afhankelijkheden).
urlencode() {
  local s="$1" out="" c i
  for (( i = 0; i < ${#s}; i++ )); do
    c="${s:i:1}"
    case "$c" in
      [a-zA-Z0-9.~_-]) out+="$c" ;;
      *) out+=$(printf '%%%02X' "'$c") ;;
    esac
  done
  printf '%s' "$out"
}

# Voer een GET uit en geef JSON terug (via jq als dat beschikbaar is).
kvk_get() {
  local path="$1" body status
  body="$(mktemp)"
  trap 'rm -f "$body"' RETURN
  status="$(curl -sS -o "$body" -w '%{http_code}' \
    -H "apikey: ${KVK_API_KEY}" \
    -H 'Accept: application/json' \
    "${KVK_BASE}${path}")" || die "verzoek mislukt: ${KVK_BASE}${path}"

  if command -v jq >/dev/null 2>&1; then
    jq . "$body" 2>/dev/null || cat "$body"
  else
    cat "$body"
  fi
  echo >&2 "HTTP ${status} ${KVK_BASE}${path}"
  [[ "$status" =~ ^2 ]] || exit 2
}

require_digits() {
  local value="$1" len="$2" label="$3"
  [[ "$value" =~ ^[0-9]{$len}$ ]] || die "$label moet uit $len cijfers bestaan (kreeg: '$value')"
}

cmd="${1:-}"
[[ -n "$cmd" ]] || usage 1
shift || true

case "$cmd" in
  zoeken)
    [[ $# -gt 0 ]] || die "geef minstens één parameter, bijv. naam=test"
    query=""
    for arg in "$@"; do
      [[ "$arg" == *=* ]] || die "parameter moet de vorm sleutel=waarde hebben: '$arg'"
      k="${arg%%=*}"; v="${arg#*=}"
      [[ "$k" =~ ^[a-zA-Z]+$ ]] || die "ongeldige parameternaam: '$k'"
      query+="${query:+&}${k}=$(urlencode "$v")"
    done
    kvk_get "/v2/zoeken?${query}"
    ;;
  basisprofiel)
    nr="${1:-}"; require_digits "$nr" 8 "kvkNummer"
    if [[ "${2:-}" == "vestigingen" ]]; then
      kvk_get "/v1/basisprofielen/${nr}/vestigingen"
    else
      kvk_get "/v1/basisprofielen/${nr}"
    fi
    ;;
  vestiging)
    nr="${1:-}"; require_digits "$nr" 12 "vestigingsnummer"
    kvk_get "/v1/vestigingsprofielen/${nr}?geoData=true"
    ;;
  naamgeving)
    nr="${1:-}"; require_digits "$nr" 8 "kvkNummer"
    kvk_get "/v1/naamgevingen/kvknummer/${nr}"
    ;;
  -h|--help|help) usage 0 ;;
  *) die "onbekend subcommando '$cmd' (gebruik: zoeken, basisprofiel, vestiging, naamgeving)" ;;
esac
