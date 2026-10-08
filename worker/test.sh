#!/usr/bin/env bash
# Test degli endpoint, casi di errore inclusi.
# Uso (locale): npm run dev   poi   ./test.sh
# Richiede DB vuoto (wrangler d1 execute laurea --local --file=reset.sql) e jq.
set -u
BASE=${BASE:-http://localhost:8787}
PASS=${PASS:-test-pass}
ORIGIN=${ORIGIN:-http://localhost:5500}
fail=0

uuid() { cat /proc/sys/kernel/random/uuid; }
# check <descrizione> <status atteso> <curl args...>
check() {
  local desc=$1 want=$2; shift 2
  local out code
  out=$(curl -s -w '\n%{http_code}' -H "Origin: $ORIGIN" "$@")
  code=${out##*$'\n'}; BODY=${out%$'\n'*}
  if [[ $code == "$want" ]]; then echo "ok   $code $desc"
  else echo "FAIL $code (atteso $want) $desc :: $BODY"; fail=1; fi
}
post() { local path=$1 data=$2; shift 2; check "$DESC" "$WANT" -X POST "$BASE$path" -H 'Content-Type: application/json' -d "$data" "$@"; }

A=$(uuid); B=$(uuid)

echo "--- ospite"
check "me senza token" 400 "$BASE/api/me"
check "me token non UUID" 400 "$BASE/api/me" -H 'X-Device-Token: abc'
check "me nuovo" 200 "$BASE/api/me" -H "X-Device-Token: $A"; [[ $(jq -r .status <<<"$BODY") == new ]] || { echo "FAIL status != new"; fail=1; }
DESC="join nome vuoto" WANT=400 post /api/join '{"name":"   "}' -H "X-Device-Token: $A"
DESC="join nome 31 caratteri" WANT=400 post /api/join "{\"name\":\"$(printf 'x%.0s' {1..31})\"}" -H "X-Device-Token: $A"
DESC="join 30 emoji (code point)" WANT=200 post /api/join "{\"name\":\"$(printf '🎓%.0s' {1..30})\"}" -H "X-Device-Token: $B"
DESC="join JSON rotto" WANT=400 post /api/join '{nome' -H "X-Device-Token: $A"
DESC="join ok" WANT=200 post /api/join '{"name":"  Il   Prof  "}' -H "X-Device-Token: $A"
[[ $(jq -r .requested_name <<<"$BODY") == "Il Prof" ]] || { echo "FAIL nome non normalizzato: $BODY"; fail=1; }
DESC="join doppio mentre pending" WANT=409 post /api/join '{"name":"Prof"}' -H "X-Device-Token: $A"

echo "--- login"
check "state senza token" 401 "$BASE/api/admin/state"
check "state token falso" 401 "$BASE/api/admin/state" -H 'Authorization: Bearer abc.def'
DESC="login ok" WANT=200 post /api/admin/login "{\"password\":\"$PASS\"}"
T=$(jq -r .token <<<"$BODY"); H="Authorization: Bearer $T"
check "state ok" 200 "$BASE/api/admin/state" -H "$H"
GA=$(jq "[.guests[] | select(.requested_name==\"Il Prof\")][0].id" <<<"$BODY")
GB=$(jq "[.guests[] | select(.requested_name!=\"Il Prof\")][0].id" <<<"$BODY")
SIG=${T#*.}; FLIP=$([[ ${SIG:0:1} == A ]] && echo B || echo A)
check "firma manomessa" 401 "$BASE/api/admin/state" -H "Authorization: Bearer ${T%%.*}.$FLIP${SIG:1}"
FAKE=$(printf '{"exp":9999999999999}' | base64 | tr '+/' '-_' | tr -d '=')
check "payload manomesso" 401 "$BASE/api/admin/state" -H "Authorization: Bearer $FAKE.$SIG"

echo "--- approve / reject"
DESC="approve senza missione" WANT=400 post /api/admin/guests/$GA/approve '{"display_name":"Prof"}' -H "$H"
DESC="approve missione inesistente" WANT=400 post /api/admin/guests/$GA/approve '{"display_name":"Prof","mission_id":9999}' -H "$H"
DESC="approve ospite inesistente" WANT=404 post /api/admin/guests/99999/approve '{"display_name":"X","mission_id":1}' -H "$H"
DESC="approve ok" WANT=200 post /api/admin/guests/$GA/approve '{"display_name":"Prof","mission_id":1}' -H "$H"
DESC="approve doppio" WANT=409 post /api/admin/guests/$GA/approve '{"display_name":"Prof","mission_id":1}' -H "$H"
DESC="reject dopo approve" WANT=409 post /api/admin/guests/$GA/reject '{}' -H "$H"
check "me approvato" 200 "$BASE/api/me" -H "X-Device-Token: $A"
[[ $(jq -r .status <<<"$BODY") == approved && $(jq -r .mission <<<"$BODY") != null ]] || { echo "FAIL me approvato: $BODY"; fail=1; }
DESC="join da approvato" WANT=409 post /api/join '{"name":"Prof"}' -H "X-Device-Token: $A"
DESC="cambia missione" WANT=200 post /api/admin/guests/$GA/mission '{"mission_id":2}' -H "$H"
DESC="cambia missione a pending" WANT=409 post /api/admin/guests/$GB/mission '{"mission_id":2}' -H "$H"

echo "--- 5 richieste per device"
DESC="reject B" WANT=200 post /api/admin/guests/$GB/reject '{}' -H "$H"
for i in 2 3 4 5; do
  DESC="rejoin B #$i" WANT=200 post /api/join '{"name":"B"}' -H "X-Device-Token: $B"
  DESC="reject B #$i" WANT=200 post /api/admin/guests/$GB/reject '{}' -H "$H"
done
DESC="rejoin B #6" WANT=429 post /api/join '{"name":"B"}' -H "X-Device-Token: $B"

echo "--- vincitore"
DESC="vincitore non accettato" WANT=409 post /api/admin/winner "{\"guest_id\":$GB}" -H "$H"
DESC="vincitore id non numerico" WANT=400 post /api/admin/winner '{"guest_id":"1"}' -H "$H"
DESC="proclama" WANT=200 post /api/admin/winner "{\"guest_id\":$GA}" -H "$H"
check "me vede vincitore" 200 "$BASE/api/me" -H "X-Device-Token: $(uuid)"
[[ $(jq -r .winner.name <<<"$BODY") == Prof ]] || { echo "FAIL winner: $BODY"; fail=1; }
DESC="reset del vincitore" WANT=200 post /api/admin/guests/$GA/reset '{}' -H "$H"
[[ $(jq -r .winner_guest_id <<<"$BODY") == null ]] || { echo "FAIL winner non azzerato: $BODY"; fail=1; }
DESC="reset doppio" WANT=404 post /api/admin/guests/$GA/reset '{}' -H "$H"
check "me dopo reset = new" 200 "$BASE/api/me" -H "X-Device-Token: $A"
[[ $(jq -r .status <<<"$BODY") == new ]] || { echo "FAIL reset: $BODY"; fail=1; }
DESC="annulla vincitore" WANT=200 post /api/admin/winner '{"guest_id":null}' -H "$H"

echo "--- CORS"
check "404 sconosciuto" 404 "$BASE/api/boh"
code=$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "$BASE/api/me" -H "Origin: $ORIGIN" -H 'Access-Control-Request-Method: GET')
[[ $code == 204 ]] && echo "ok   204 preflight consentito" || { echo "FAIL preflight consentito: $code"; fail=1; }
code=$(curl -s -o /dev/null -w '%{http_code}' -X OPTIONS "$BASE/api/me" -H 'Origin: https://evil.example' -H 'Access-Control-Request-Method: GET')
[[ $code == 403 ]] && echo "ok   403 preflight vietato" || { echo "FAIL preflight vietato: $code"; fail=1; }
hdr=$(curl -s -D - -o /dev/null "$BASE/api/me" -H "Origin: $ORIGIN" | tr -d '\r' | grep -i '^access-control-allow-origin')
[[ $hdr == *"$ORIGIN"* ]] && echo "ok       CORS anche sugli errori" || { echo "FAIL CORS su errore: '$hdr'"; fail=1; }

echo "--- rate limit login (lascia l'IP bloccato 15 min: in locale rilancia reset.sql)"
for i in 1 2 3 4 5; do DESC="login sbagliato #$i" WANT=401 post /api/admin/login '{"password":"no"}'; done
DESC="login #6 bloccato" WANT=429 post /api/admin/login "{\"password\":\"$PASS\"}"

echo; [[ $fail == 0 ]] && echo "TUTTI OK" || { echo "CI SONO ERRORI"; exit 1; }
