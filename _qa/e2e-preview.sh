#!/bin/bash
# Live end-to-end check against a PREVIEW deployment (event_slug ...-test).
# Usage: _qa/e2e-preview.sh https://<preview>.vercel.app
# Reads keys from ../organizer-keys-PRIVATE.txt; never prints them.
set -u
P="$1"
KEYS="${KEYS:-$(cd "$(dirname "$0")" && pwd)/../../organizer-keys-PRIVATE.txt}"
JK=$(grep '^JUDGES_KEY=' "$KEYS" | cut -d= -f2-)
OK=$(grep '^IMPACT_LAB_ORGANIZER_KEY=' "$KEYS" | cut -d= -f2-)
AK=$(grep '^IMPACT_LAB_ADMIN_KEY=' "$KEYS" | cut -d= -f2-)
fails=0
# Plain curl with the project's protection-bypass secret (fetched via vercel curl -v, never printed).
BYP=$(vercel curl / --deployment "$P" -- -s -v -o /dev/null 2>&1 | grep -o 'x-vercel-protection-bypass: [A-Za-z0-9]*' | head -1 | cut -d' ' -f2)
c() { curl -s -H "x-vercel-protection-bypass: $BYP" "$P$1" "${@:2}"; }
code() { curl -s -o /dev/null -w '%{http_code}' -H "x-vercel-protection-bypass: $BYP" "$P$1" "${@:2}"; }
# Optional: E2E_DBK=<service key> prints test-row counts after every check.
dbg() { [ -z "${E2E_DBK:-}" ] && return; for t in submissions votes scores settings; do printf "%s=%s " $t "$(curl -s "https://copnfjaxotrivqukqdlc.supabase.co/rest/v1/impact_lab_$t?select=event_slug&event_slug=eq.faithtech-socal-2026-10-24-test" -H "apikey: $E2E_DBK" -H "Authorization: Bearer $E2E_DBK" | python3 -c 'import sys,json;print(len(json.load(sys.stdin)))')"; done; echo; }
check() { dbg; if [ "$2" = "$3" ]; then echo "PASS $1"; else echo "FAIL $1 (got $2, want $3)"; fails=$((fails+1)); fi; }
J=(-H "content-type: application/json" -H "accept: application/json")
JH=(-H "x-judges-key: $JK")

sub() { c /api/impact-lab-submit -X POST "${J[@]}" -d "$1"; }
base='"challenge":"1","one_liner":"Pastors on a phone","what_it_does":"E2E test row, delete me.","repo_url":"https://github.com/example/e2e","members":"Test One\nTest Two","contact_name":"Test One","contact_email":"e2e@example.com","ts":"1","js":"1"'

# 1. Submit two teams
A=$(sub "{\"team_name\":\"E2E Alpha\",$base}")
ACODE=$(echo "$A" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("edit_code",""))')
check "submit Alpha returns edit code" "$([ -n "$ACODE" ] && echo y)" y
B=$(sub "{\"team_name\":\"E2E Beta\",${base/\"challenge\":\"1\"/\"challenge\":\"2\"}}")
check "submit Beta ok" "$(echo "$B" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("ok"))')" True

# 2. Edit via code; takeover without code refused
b="{\"team_name\":\"E2E Alpha\",$base}"; r=$(code /api/impact-lab-submit -X POST "${J[@]}" -d "$b"); check "same name without code is 409" "$r" 409
F=$(sub "{\"action\":\"fetch\",\"edit_code\":\"$ACODE\"}")
check "fetch by code returns team" "$(echo "$F" | python3 -c 'import sys,json;print(json.load(sys.stdin)["team"]["team_name"])')" "E2E Alpha"
check "fetch by email is 404" "$(code /api/impact-lab-submit -X POST "${J[@]}" -d '{"action":"fetch","edit_code":"e2e@example.com"}')" 404
E=$(sub "{\"team_name\":\"E2E Alpha\",${base/E2E test row/E2E edited row},\"edit_code\":\"$ACODE\"}")
check "edit with code updates" "$(echo "$E" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("updated"))')" True

# 3. Judges: 401 without key
check "judges page without key 401" "$(code /judges)" 401
check "scores.json without key 401" "$(code '/judges?format=scores.json')" 401
check "vote without key 401" "$(code /judges -X POST "${J[@]}" -d '{"action":"vote","judge":"Travis","team":"e2e alpha","on":true}')" 401
check "judges link redirects (303)" "$(code "/judges?key=$JK&view=score")" 303

# 4. Shortlist, lock, score, results, CSV with key.
# JSON bodies are built with printf into a variable first: a "{...}" inside "$(...)"
# gets brace-expanded by bash and the server receives fragments, not JSON.
pj() { code /judges -X POST "${J[@]}" "${JH[@]}" -d "$1"; }
for j in Travis Dana; do for t in "e2e alpha" "e2e beta"; do
  b=$(printf '{"action":"vote","judge":"%s","team":"%s","on":true}' "$j" "$t"); r=$(pj "$b")
  check "vote $j/$t" "$r" 200
done; done
r=$(code '/judges?view=shortlist' "${JH[@]}"); check "shortlist view 200" "$r" 200
b=$(printf '{"action":"lock","admin":"%s","confirm":"1"}' "$OK"); r=$(pj "$b"); check "lock with organizer key 303" "$r" 303
for j in Travis Dana; do
  b=$(printf '{"action":"score","judge":"%s","team":"e2e alpha","impact":5,"product":4,"demo":3,"care":2,"note":"e2e"}' "$j"); r=$(pj "$b")
  check "score $j alpha" "$r" 200
  b=$(printf '{"action":"score","judge":"%s","team":"e2e beta","impact":3,"product":3,"demo":3,"care":3,"note":""}' "$j"); r=$(pj "$b")
  check "score $j beta" "$r" 200
done
R=$(c '/judges?view=results' "${JH[@]}")
r=$(echo "$R" | python3 -c 'import sys,re;s=sys.stdin.read();print(bool(re.search(r"Most Redemptive[\s\S]*E2E Alpha[\s\S]*3\.85",s)))')
check "results: Alpha is Most Redemptive at 3.85" "$r" True
b=$(printf '{"action":"reveal","admin":"%s","confirm":"1"}' "$OK"); r=$(pj "$b"); check "reveal with organizer key 303" "$r" 303
SC=$(c '/judges?format=scores.csv' "${JH[@]}")
r=$(echo "$SC" | grep -c '3\.85' | awk '{print ($1>0)?"y":"n"}'); check "scores CSV has 3.85" "$r" y
b=$(printf '{"action":"csv","admin":"%s"}' "$OK"); r=$(pj "$b"); check "submissions CSV refused with organizer key" "$r" 403
b=$(printf '{"action":"csv","admin":"%s"}' "$AK")
CSV=$(c /judges -X POST "${J[@]}" "${JH[@]}" -d "$b")
r=$(echo "$CSV" | grep -c 'e2e@example.com' | awk '{print ($1>0)?"y":"n"}'); check "submissions CSV with admin key has emails" "$r" y

echo; [ $fails = 0 ] && echo "ALL PASSED" || echo "$fails FAILED"
