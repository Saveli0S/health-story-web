"""Loopback-only Sign in with ChatGPT client. The remote provider sees selected text only."""
import base64
import hashlib
import json
import os
import re
import secrets
import tempfile
import threading
import time
import uuid
from http.cookies import SimpleCookie
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlencode, urlsplit
from urllib.request import Request, urlopen

import jwt

ISSUER = "https://auth.openai.com"
API = "https://api.openai.com/v1"
SCOPE = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"
GRANT = "chatgpt.tokens.use.direct"
COOKIE = "hs_chatgpt_session"


class ClientError(Exception):
    def __init__(self, status, message):
        super().__init__(message)
        self.status = status


def form_request(url, fields):
    return Request(url, data=urlencode(fields).encode(), method="POST",
                   headers={"Content-Type": "application/x-www-form-urlencoded"})


def read_json(request):
    with urlopen(request, timeout=25) as response:
        return json.load(response)


def write_private(path, value):
    fd, name = tempfile.mkstemp(dir=path.parent)
    try:
        with os.fdopen(fd, "w") as stream:
            json.dump(value, stream)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def answer_stream(lines):
    parts = []
    for line in lines:
        if not line.startswith(b"data:"):
            continue
        payload = line[5:].strip()
        if not payload or payload == b"[DONE]":
            continue
        event = json.loads(payload)
        kind = event.get("type")
        if kind == "response.output_text.delta":
            parts.append(event["delta"])
        if kind == "response.completed" and "".join(parts).strip():
            return "".join(parts)
        if kind in ("error", "response.failed", "response.incomplete"):
            break
    raise ClientError(502, "Ответ не завершён. Запрос сохранён в дневнике.")


class ChatGPT:
    def __init__(self, origin, folder):
        self.origin = origin
        self.folder = Path(folder)
        self.folder.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.folder.chmod(0o700)
        host_file = self.folder / "host.json"
        if not host_file.exists():
            write_private(host_file, "urn:uuid:" + str(uuid.uuid4()))
        self.host = json.loads(host_file.read_text())
        self.pending = {}
        self.lock = threading.RLock()
        self.keys = None

    def path(self, sid):
        return self.folder / (hashlib.sha256(sid.encode()).hexdigest() + ".json")

    def saved(self, sid):
        p = self.path(sid)
        return json.loads(p.read_text()) if p.exists() else {}

    def begin(self, sid):
        state, nonce, verifier = (secrets.token_urlsafe(36) for _ in range(3))
        challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
        with self.lock:
            self.pending = {s:v for s,v in self.pending.items() if v[0] > time.monotonic() and v[1] != sid}
            old = self.saved(sid)
            self.pending[state] = (time.monotonic()+600, sid, nonce, verifier)
        params = dict(client_id=old.get("client_id","dynamic_agent_client"), ext_agent_host_id=self.host,
                      response_type="code", redirect_uri=self.origin+"/auth/callback", scope=SCOPE, resource=API,
                      state=state, nonce=nonce, code_challenge_method="S256", code_challenge=challenge)
        if not old:
            params["agent_name_hint"] = "Лист здоровья"
        return ISSUER + "/api/accounts/authorize?" + urlencode(params)

    def callback(self, sid, query):
        state = query.get("state",[""])[0]
        with self.lock:
            attempt = self.pending.get(state)
            if not attempt or attempt[1] != sid or attempt[0] < time.monotonic():
                raise ClientError(400, "Вход истёк. Начните подключение заново.")
            del self.pending[state]
            if "error" in query or not query.get("code"):
                raise ClientError(403, "Разрешение на подключение не получено.")
            old = self.saved(sid)
            issued = query.get("client_id",[old.get("client_id","")])[0]
            if not issued or issued=="dynamic_agent_client" or old and old["client_id"]!=issued:
                raise ClientError(400,"Не подтверждена регистрация приложения.")
            data = read_json(form_request(ISSUER+"/api/accounts/oauth/token",dict(
                grant_type="authorization_code",code=query["code"][0],code_verifier=attempt[3],
                redirect_uri=self.origin+"/auth/callback",resource=API,client_id=issued)))
            if self.keys is None:
                config = read_json(ISSUER+"/.well-known/openid-configuration")
                if config["issuer"]!=ISSUER or not config["jwks_uri"].startswith(ISSUER+"/"):
                    raise ClientError(502,"Не удалось проверить подпись OpenAI.")
                self.keys = jwt.PyJWKClient(config["jwks_uri"],timeout=15)
            token = data["id_token"]
            claims = jwt.decode(token,self.keys.get_signing_key_from_jwt(token).key,algorithms=["RS256"],
                                issuer=ISSUER,audience=issued,options={"require":["exp","sub","nonce","iat"]})
            if claims["nonce"]!=attempt[2] or old and old["sub"]!=claims["sub"]:
                raise ClientError(403,"Аккаунт не совпал с выбранным подключением.")
            if GRANT not in data.get("scope","").split():
                raise ClientError(403,"Аккаунт не предоставил доступ к квоте ChatGPT.")
            record = dict(client_id=issued,sub=claims["sub"],email=claims.get("email",""),
                          access=data["access_token"],refresh=data["refresh_token"],
                          expires=time.time()+int(data["expires_in"]))
            write_private(self.path(sid), record)

    def access(self,sid):
        with self.lock:
            saved = self.saved(sid)
            if not saved.get("access"):
                raise ClientError(401,"Подключите свой аккаунт ChatGPT.")
            if saved["expires"] < time.time()+60:
                result = read_json(form_request(ISSUER+"/api/accounts/oauth/token",dict(
                    grant_type="refresh_token",refresh_token=saved["refresh"],client_id=saved["client_id"],resource=API)))
                if "scope" in result and GRANT not in result["scope"].split():
                    raise ClientError(403,"Разрешите использование квоты ChatGPT.")
                saved.update(access=result["access_token"],refresh=result.get("refresh_token",saved["refresh"]),
                             expires=time.time()+int(result["expires_in"]))
                write_private(self.path(sid),saved)
            return saved["access"]

    def disconnect(self,sid):
        with self.lock:
            self.pending = {s:v for s,v in self.pending.items() if v[1]!=sid}
            saved = self.saved(sid)
            confirmed = True
            if saved.get("refresh"):
                try:
                    with urlopen(form_request(ISSUER+"/api/accounts/oauth/revoke",dict(
                        token=saved["refresh"],token_type_hint="refresh_token",client_id=saved["client_id"])),timeout=10):
                        pass
                except OSError:
                    confirmed = False
            self.path(sid).unlink(missing_ok=True)
            return {"revoked":confirmed}

    def reply(self,sid,messages):
        if not isinstance(messages,list) or not messages or len(messages)%2!=1 or any(
                not isinstance(m,dict) or set(m)!={"role","content"} or m["role"]!=("user" if i%2==0 else "assistant")
                or not isinstance(m["content"],str) or not m["content"].strip() for i,m in enumerate(messages)):
            raise ClientError(400,"Проверьте текст переписки.")
        headers = {"Authorization":"Bearer "+self.access(sid)}
        catalog = read_json(Request(API+"/models",headers=headers))
        model = next((m["slug"] for m in catalog.get("models",[]) if m.get("visibility")=="list" and m.get("slug")),None)
        if not model:
            raise ClientError(403,"В этом аккаунте нет доступной модели.")
        body = json.dumps(dict(model=model,input=messages,store=False,stream=True)).encode()
        request = Request(API+"/responses",data=body,headers={**headers,"Content-Type":"application/json","Accept":"text/event-stream"})
        with urlopen(request,timeout=120) as stream:
            return {"answer":answer_stream(stream),"model":model}

    def handle(self,h):
        url = urlsplit(h.path)
        def respond(status,value,cookie=None,location=None):
            data = json.dumps(value,ensure_ascii=False).encode()
            h.send_response(status)
            h.send_header("Content-Type","application/json; charset=utf-8")
            h.send_header("Cache-Control","no-store")
            h.send_header("X-Content-Type-Options","nosniff")
            if cookie:
                h.send_header("Set-Cookie",f"{COOKIE}={cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000")
            if location:
                h.send_header("Location",location)
            h.send_header("Content-Length",str(len(data)))
            h.end_headers()
            h.wfile.write(data)
        try:
            if h.headers.get("Host")!=urlsplit(self.origin).netloc:
                raise ClientError(403,"Откройте дневник по локальному адресу.")
            cookies=SimpleCookie()
            cookies.load(h.headers.get("Cookie",""))
            sid=cookies[COOKIE].value if COOKIE in cookies else ""
            if not re.fullmatch(r"[A-Za-z0-9_-]{43}",sid):
                sid=""
            if url.path=="/auth/callback" and h.command=="GET":
                self.callback(sid,parse_qs(url.query))
                respond(303,{} ,location="/?section=consults&chatgpt=connected")
                return
            if h.command=="GET" and url.path=="/chatgpt/status":
                saved=self.saved(sid) if sid else {}
                respond(200,{"connected":bool(saved.get("access")),"account":saved.get("email","")})
                return
            if h.command!="POST" or h.headers.get("Origin")!=self.origin or h.headers.get_content_type()!="application/json":
                raise ClientError(403,"Откройте действие из дневника.")
            length=int(h.headers.get("Content-Length","0"))
            if not 0<length<=1024*1024:
                raise ClientError(413,"Переписка слишком велика. Начните новую консультацию.")
            body=json.loads(h.rfile.read(length))
            if not isinstance(body,dict):
                raise ClientError(400,"Некорректный запрос.")
            if url.path=="/chatgpt/connect":
                sid=sid or secrets.token_urlsafe(32)
                respond(200,{"url":self.begin(sid)},sid)
            elif not sid:
                raise ClientError(401,"Подключите свой аккаунт ChatGPT.")
            elif url.path=="/chatgpt/disconnect":
                respond(200,self.disconnect(sid))
            elif url.path=="/chatgpt/send":
                respond(200,self.reply(sid,body.get("messages")))
            else:
                raise ClientError(404,"Нет такого действия.")
        except HTTPError as e:
            status=e.code if e.code in (400,401,403,429) else 502
            message={400:"Проверьте подключение и размер запроса.",401:"Подключите ChatGPT повторно.",
                     403:"ChatGPT не разрешил этот запрос для аккаунта.",429:"Квота ChatGPT исчерпана. Повторите позже."}
            respond(status,{"error":message.get(status,"Сервис ChatGPT недоступен.")})
        except ClientError as e:
            respond(e.status,{"error":str(e)})
        except (jwt.PyJWTError,KeyError,ValueError,OSError,TypeError):
            respond(502,{"error":"Не удалось завершить операцию с ChatGPT. Вернитесь в дневник и повторите позже."})
