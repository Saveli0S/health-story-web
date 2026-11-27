import { DurableObject } from "cloudflare:workers";
import { createRemoteJWKSet, jwtVerify } from "jose";

const issuer = "https://auth.openai.com";
const resource = "https://api.openai.com/v1";
const planScope = "chatgpt.tokens.use.direct";
const scope = "openid profile email offline_access resource.invoke " + planScope;
const keys = createRemoteJWKSet(new URL(issuer + "/.well-known/jwks.json"), { timeoutDuration: 8000 });
const shortToken = /^[A-Za-z0-9_-]{43}$/;
const encode = new TextEncoder();
const decode = new TextDecoder();
const apiPath = "/chatgpt/";
const callbackPath = apiPath + "callback";
const to64 = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll("+","-").replaceAll("/","_").replace(/=+$/,"");
const from64 = value => Uint8Array.from(atob(value.replaceAll("-","+").replaceAll("_","/")), c => c.charCodeAt(0));
const opaque = () => to64(crypto.getRandomValues(new Uint8Array(32)));
const digest = async value => to64(await crypto.subtle.digest("SHA-256", encode.encode(value)));
const json = (value, status = 200) => Response.json(value, {status, headers: {"Cache-Control":"no-store","Referrer-Policy":"no-referrer"}});
const failure = (status, error) => json({error}, status);
const bearer = req => (req.headers.get("Authorization") || "").match(/^Bearer (.+)$/)?.[1] || "";
const approved = env => env.OPENAI_PLAN_ONLY_APPROVED === "yes" && /^oaiapp_[\w-]+$/.test(env.OPENAI_CLIENT_ID || "") &&
  shortToken.test(env.SESSION_SEAL_KEY || "") &&
  (env.OPENAI_TOKEN_AUTH === "none" || (["client_secret_basic","client_secret_post"].includes(env.OPENAI_TOKEN_AUTH) && !!env.OPENAI_CLIENT_SECRET));
const planGranted = tokens => typeof tokens.scope === "string" && tokens.scope.split(/\s+/).includes(planScope);
const disconnected = available => ({available, connected:false, planOnly:false});

async function readJSON(req, limit) {
  if (req.headers.get("Content-Type")?.split(";")[0].trim() !== "application/json" || !req.body) throw new Error();
  const reader = req.body.getReader();
  let bytes = 0, text = "";
  const decoder = new TextDecoder("utf-8", {fatal:true});
  for (;;) {
    const {done, value} = await reader.read();
    if (done) return JSON.parse(text + decoder.decode());
    bytes += value.byteLength;
    if (bytes > limit) { await reader.cancel(); throw new Error(); }
    text += decoder.decode(value, {stream:true});
  }
}

function callbackURI(env) { return env.GATEWAY_ORIGIN + callbackPath; }
function returnToClient(env, client, values) {
  const url = new URL(client === "web" ? env.WEB_RETURN : env.IOS_RETURN);
  const params = new URLSearchParams(values);
  if (client === "web") url.hash = params.toString();
  else url.search = params.toString();
  return new Response(null, { status:303, headers:{ Location:url.href,"Cache-Control":"no-store","Referrer-Policy":"no-referrer" } });
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get("Origin");
    const allowed = new URL(env.WEB_RETURN).origin;
    if (origin && origin !== allowed) return failure(403, "Этот источник не разрешён.");
    const url = new URL(req.url);
    if (url.origin !== env.GATEWAY_ORIGIN || !url.pathname.startsWith(apiPath)) return failure(404, "Маршрут недоступен.");
    const action = url.pathname.slice(apiPath.length);
    if (!["status","connect","callback","redeem","disconnect","send"].includes(action)) return failure(404, "Маршрут недоступен.");
    const cors = {
      "Access-Control-Allow-Origin":allowed, "Vary":"Origin", "Access-Control-Allow-Methods":"GET, POST, OPTIONS",
      "Access-Control-Allow-Headers":"Authorization, Content-Type", "Access-Control-Max-Age":"600"
    };
    if (origin && req.method === "OPTIONS") return new Response(null, {status:204,headers:cors});
    const method = ["status","callback"].includes(action) ? "GET" : "POST";
    const signedIn = bearer(req);
    let result;
    if (req.method !== method) result = failure(405, "Неверный метод запроса.");
    else if (action === "status" && (!approved(env) || !signedIn)) result = json(disconnected(approved(env)));
    else if (!approved(env)) result = failure(503, "Подключение ожидает допуска OpenAI.");
    else {
      try { result = await env.ACCOUNTS.getByName("accounts").fetch(req); }
      catch { result = failure(502, "Не удалось связаться со шлюзом ChatGPT."); }
    }
    const headers = new Headers(result.headers);
    if (origin) for (const [key,value] of Object.entries(cors)) headers.set(key,value);
    return new Response(result.body,{status:result.status,headers});
  }
};

export class ChatGPTAccounts extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS oauth (id TEXT PRIMARY KEY, kind TEXT, data TEXT, expiry INTEGER);
      CREATE INDEX IF NOT EXISTS oauth_expiry ON oauth(expiry);`);
    this.refreshes = new Map();
  }
  row(id, kind) {
    return this.sql.exec("SELECT data,expiry FROM oauth WHERE id=? AND kind=? AND expiry>?", id, kind, Date.now()).toArray()[0];
  }
  put(id, kind, data, expiry) {
    this.sql.exec("INSERT OR REPLACE INTO oauth VALUES(?,?,?,?)", id, kind, data, expiry);
  }
  take(id, kind) {
    return this.sql.exec("DELETE FROM oauth WHERE id=? AND kind=? AND expiry>? RETURNING data,expiry", id, kind, Date.now()).toArray()[0];
  }
  async alarm() {
    this.sql.exec("DELETE FROM oauth WHERE expiry<=?", Date.now());
    const next = this.sql.exec("SELECT MIN(expiry) AS at FROM oauth").one().at;
    if (next != null) await this.ctx.storage.setAlarm(next);
  }
  async scheduleCleanup() {
    const next = this.sql.exec("SELECT MIN(expiry) AS at FROM oauth").one().at;
    if (next != null) await this.ctx.storage.setAlarm(next);
  }
  async seal(id, value) {
    const secret = from64(this.env.SESSION_SEAL_KEY);
    const key = await crypto.subtle.importKey("raw", secret, "AES-GCM", false, ["encrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:encode.encode(id)}, key, encode.encode(JSON.stringify(value)));
    return to64(iv) + "." + to64(data);
  }
  async open(id, envelope) {
    const [iv, data] = envelope.split(".").map(from64);
    const key = await crypto.subtle.importKey("raw", from64(this.env.SESSION_SEAL_KEY), "AES-GCM", false, ["decrypt"]);
    const clear = await crypto.subtle.decrypt({name:"AES-GCM",iv,additionalData:encode.encode(id)}, key, data);
    return JSON.parse(decode.decode(clear));
  }
  async fetch(req) {
    const url = new URL(req.url);
    const action = url.pathname.slice(apiPath.length);
    const client = req.headers.has("Origin") ? "web" : "ios";
    try {
      if (action === "callback") return await this.callback(url);
      if (action === "connect") return await this.connect(req,client);
      if (action === "redeem") return await this.redeem(req,client);
      const token = bearer(req);
      if (!shortToken.test(token)) return action === "status" ? json(disconnected(true)) : failure(401,"Подключите ChatGPT повторно.");
      const id = await digest(token);
      const row = this.row(id, "session-" + client);
      if (!row) return action === "status" ? json(disconnected(true)) : failure(401,"Подключите ChatGPT повторно.");
      if (action === "disconnect") return await this.disconnect(id, client);
      const saved = await this.open(id, row.data);
      if (action === "status") return json({available:true,connected:true,planOnly:true,account:saved.account});
      return await this.send(req, id, row, saved, client);
    } catch { return failure(502,"Не удалось завершить операцию с ChatGPT."); }
  }
  async connect(req, client) {
    const body = await readJSON(req,1024).catch(() => null);
    if (!shortToken.test(body?.challenge || "")) return failure(400,"Начните вход из дневника.");
    const state = opaque(), verifier = opaque(), nonce = opaque();
    const args = {
      client_id:this.env.OPENAI_CLIENT_ID, redirect_uri:callbackURI(this.env), response_type:"code", scope, resource,
      state, nonce, code_challenge:await digest(verifier), code_challenge_method:"S256"
    };
    this.put(state,"transaction",JSON.stringify({client,verifier,nonce,challenge:body.challenge}),Date.now()+600_000);
    await this.scheduleCleanup();
    return json({url:issuer+"/api/accounts/authorize?"+new URLSearchParams(args)});
  }
  async callback(url) {
    const state = url.searchParams.get("state") || "";
    const row = shortToken.test(state) && this.take(state,"transaction");
    if (!row) return failure(400,"Вход истёк. Начните подключение заново.");
    const attempt = JSON.parse(row.data);
    const fail = () => returnToClient(this.env,attempt.client,{chatgpt:"denied"});
    const code = url.searchParams.get("code");
    const returned = url.searchParams.get("client_id");
    if (!code || url.searchParams.has("error") || (returned && returned !== this.env.OPENAI_CLIENT_ID)) return fail();
    try {
      const res = await this.openAI("token", {grant_type:"authorization_code", code, code_verifier:attempt.verifier, redirect_uri:callbackURI(this.env),resource});
      if (!res.ok) return fail();
      const tokens = await res.json();
      if (!validTokens(tokens) || !planGranted(tokens) || !tokens.refresh_token) return fail();
      const {payload} = await jwtVerify(tokens.id_token,keys,{
        algorithms:["RS256"],issuer,audience:this.env.OPENAI_CLIENT_ID,requiredClaims:["exp","sub","iat","nonce"]
      });
      if (payload.nonce !== attempt.nonce || (payload.azp != null && payload.azp !== this.env.OPENAI_CLIENT_ID) ||
          (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== this.env.OPENAI_CLIENT_ID)) return fail();
      const ticket = opaque(), id = await digest(ticket);
      const record = {challenge:attempt.challenge,account:payload.email_verified === true ? payload.email || "" : "",tokens:tokensForStorage(tokens)};
      this.put(id,"ticket-"+attempt.client,await this.seal(id,record),Date.now()+120_000);
      await this.scheduleCleanup();
      return returnToClient(this.env,attempt.client,{chatgpt:"connected",ticket});
    } catch { return fail(); }
  }
  async redeem(req, client) {
    const body = await readJSON(req,1024).catch(() => null);
    if (!shortToken.test(body?.ticket || "") || !shortToken.test(body?.verifier || "")) return failure(400,"Начните вход заново.");
    const id = await digest(body.ticket), row = this.row(id,"ticket-"+client);
    if (!row) return failure(401,"Вход истёк. Начните подключение заново.");
    const saved = await this.open(id,row.data);
    if (saved.challenge !== await digest(body.verifier)) return failure(401,"Вход начат на другом устройстве или в другой вкладке.");
    const session = opaque(), sessionID = await digest(session), kind = "session-"+client;
    const data = await this.seal(sessionID,{account:saved.account,tokens:saved.tokens});
    if (!this.ctx.storage.transactionSync(() => {
      if (!this.take(id,"ticket-"+client)) return false;
      this.put(sessionID,kind,data,Date.now()+(client === "web" ? 3_600_000 : 2_592_000_000));
      return true;
    })) return failure(401,"Вход уже завершён.");
    await this.scheduleCleanup();
    return json({session,account:saved.account,planOnly:true});
  }
  openAI(action, params) {
    const auth = this.env.OPENAI_TOKEN_AUTH, headers = {};
    params.client_id = this.env.OPENAI_CLIENT_ID;
    if (auth === "client_secret_post") params.client_secret = this.env.OPENAI_CLIENT_SECRET;
    else if (auth === "client_secret_basic") headers.Authorization = "Basic "+btoa([params.client_id,this.env.OPENAI_CLIENT_SECRET]
      .map(value=>new URLSearchParams({value}).toString().slice(6)).join(":"));
    return fetch(issuer+"/api/accounts/oauth/"+action,{
      method:"POST",headers,body:new URLSearchParams(params),redirect:"manual",signal:AbortSignal.timeout(15_000)
    });
  }
  async disconnect(id, client) {
    const row = this.take(id,"session-"+client);
    if (!row) return json({revoked:false});
    try {
      const {tokens} = await this.open(id,row.data);
      const res = await this.openAI("revoke",{token:tokens.refresh,token_type_hint:"refresh_token"});
      return json({revoked:res.ok});
    } catch { return json({revoked:false}); }
  }
  async access(id, row, saved, client) {
    if (saved.tokens.expires > Date.now()+60_000) return saved.tokens.access;
    if (!this.refreshes.has(id)) this.refreshes.set(id,this.refresh(id,row,saved,client).finally(()=>this.refreshes.delete(id)));
    return this.refreshes.get(id);
  }
  async refresh(id, row, saved, client) {
    const kind = "session-"+client;
    const current = this.row(id,kind);
    if (!current) return "";
    if (current.data !== row.data) return (await this.open(id,current.data)).tokens.access;
    const res = await this.openAI("token",{grant_type:"refresh_token",refresh_token:saved.tokens.refresh,resource});
    if ([400,401,403].includes(res.status)) { this.take(id,kind); return ""; }
    if (!res.ok) throw new Error();
    const tokens = await res.json();
    if (!validTokens(tokens) || (tokens.scope != null && !planGranted(tokens))) { this.take(id,kind); return ""; }
    saved.tokens = tokensForStorage(tokens,saved.tokens.refresh);
    const sealed = await this.seal(id,saved);
    if (!this.row(id,kind)) return "";
    this.put(id,kind,sealed,row.expiry);
    return saved.tokens.access;
  }
  async send(req, id, row, saved, client) {
    const value = await readJSON(req,1_048_576).catch(() => null);
    const messages = value?.messages;
    if (Object.keys(value || {}).length !== 1 || !validMessages(messages)) return failure(400,"Проверьте текст переписки.");
    const token = await this.access(id,row,saved,client);
    if (!token || !this.row(id,"session-"+client)) return failure(401,"Подключите ChatGPT повторно.");
    const headers = {Authorization:"Bearer "+token};
    const listing = await fetch(resource+"/models",{headers,redirect:"manual",signal:AbortSignal.timeout(12_000)});
    if (listing.status === 401) this.take(id,"session-"+client);
    if (!listing.ok) return providerFailure(listing.status);
    const catalog = await listing.json();
    const model = catalog.models?.find(m=>m.visibility==="list" && typeof m.slug==="string")?.slug;
    if (!model) return failure(403,"Для тарифа нет доступной модели.");
    if (!this.row(id,"session-"+client)) return failure(401,"Подключите ChatGPT повторно.");
    const response = await fetch(resource+"/responses",{
      method:"POST",headers:{...headers,"Content-Type":"application/json",Accept:"text/event-stream"},
      body:JSON.stringify({model,input:messages,store:false,stream:true}),redirect:"manual",signal:AbortSignal.timeout(110_000)
    });
    if (response.status === 401) this.take(id,"session-"+client);
    if (!response.ok) return providerFailure(response.status);
    const answer = await readAnswer(response);
    return answer ? json({answer,model}) : failure(502,"Ответ не завершён.");
  }
}

function validTokens(tokens) {
  return typeof tokens.access_token === "string" && !!tokens.access_token &&
    Number.isFinite(Number(tokens.expires_in)) && Number(tokens.expires_in)>0;
}
function tokensForStorage(tokens, priorRefresh) {
  return {access:tokens.access_token,refresh:tokens.refresh_token || priorRefresh,expires:Date.now()+Number(tokens.expires_in)*1000};
}
function validMessages(messages) {
  return Array.isArray(messages) && messages.length>0 && messages.length<=101 && messages.length%2===1 &&
    messages.every((m,i)=>m && Object.keys(m).length===2 && m.role===(i%2 ? "assistant" : "user") &&
      typeof m.content==="string" && !!m.content.trim());
}
function providerFailure(status) {
  if (status===429) return failure(429,"Квота ChatGPT исчерпана.");
  if (status===401) return failure(401,"Подключите ChatGPT повторно.");
  if (status===403) return failure(403,"ChatGPT не разрешил запрос для этого аккаунта.");
  return failure(502,"Не удалось получить ответ ChatGPT.");
}
async function readAnswer(response) {
  if (!response.body) return "";
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "", answer = "";
  try {
    for (;;) {
      const {done,value} = await reader.read();
      if (done) return "";
      buffer += value;
      if (buffer.length + answer.length > 1_048_576) return "";
      let lineEnd;
      while ((lineEnd=buffer.indexOf("\n"))>=0) {
        const line = buffer.slice(0,lineEnd).trimEnd();
        buffer = buffer.slice(lineEnd+1);
        if (!line.startsWith("data:")) continue;
        const part = line.slice(5).trim();
        if (!part || part==="[DONE]") continue;
        const event = JSON.parse(part);
        if (event.type==="response.output_text.delta" && typeof event.delta==="string") answer+=event.delta;
        if (event.type==="response.completed") return answer.trim();
        if (["response.failed","response.incomplete","error"].includes(event.type)) return "";
      }
    }
  } finally { await reader.cancel().catch(()=>{}); }
}
