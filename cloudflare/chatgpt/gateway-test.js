import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { convertV4MiniflareOptions, Miniflare } from "miniflare";
import { exportJWK, generateKeyPair, SignJWT } from "jose";

const issuer = "https://auth.openai.com";
const gateway = "https://health-story-chatgpt.xzx89s.workers.dev";
const website = "https://saveli0s.github.io";
const clientID = "oaiapp_health_story_test";
const secureToken = () => randomBytes(32).toString("base64url");
const challenge = verifier => createHash("sha256").update(verifier).digest("base64url");
const expected = [];
function expect(method, url, handle) { expected.push({method,url,handle}); }
async function outboundService(req) {
  const index = expected.findIndex(e=>e.method===req.method && e.url===req.url);
  if (index<0) throw new Error("Unexpected upstream request: "+req.method+" "+req.url);
  return expected.splice(index,1)[0].handle(req);
}
const configuration = {
  modules: true, scriptPath: ".wrangler/test-build/worker.js", compatibilityDate:"2026-05-01",
  durableObjects: {ACCOUNTS:{className:"ChatGPTAccounts",useSQLite:true}},
  outboundService,
  bindings: {
    GATEWAY_ORIGIN:gateway, WEB_RETURN:website+"/health-story-web/?section=consults",
    IOS_RETURN:"by.healthstory.familyjournal.chatgpt://account/callback",
    SESSION_SEAL_KEY:secureToken(), OPENAI_CLIENT_ID:clientID, OPENAI_TOKEN_AUTH:"none"
  }
};

function client(instance, origin) {
  return (path,{body,token,raw}={}) => instance.dispatchFetch(gateway+"/chatgpt/"+path,{
    method:body ? "POST":"GET",redirect:"manual",
    headers:{...(origin && {Origin:origin}),...(token && {Authorization:"Bearer "+token}),
      ...(body && {"Content-Type":"application/json"})},
    ...(body && {body:raw ?? JSON.stringify(body)})
  });
}
const disabled = new Miniflare(convertV4MiniflareOptions(configuration));
try {
  const web = client(disabled,website);
  assert.deepEqual(await (await web("status")).json(),{available:false,connected:false,planOnly:false});
  assert.equal((await web("connect",{body:{challenge:secureToken()}})).status,503);
  assert.equal((await web("send",{body:{messages:[]},token:secureToken()})).status,503);
} finally { await disabled.dispose(); }

const instance = new Miniflare(convertV4MiniflareOptions({...configuration,bindings:{...configuration.bindings,OPENAI_PLAN_ONLY_APPROVED:"yes"}}));
try {
  const web = client(instance,website), ios = client(instance);
  assert.equal((await client(instance,"https://unrelated.example")("status")).status,403);
  const {publicKey,privateKey} = await generateKeyPair("RS256");
  const jwks = {keys:[{...await exportJWK(publicKey),kid:"test",alg:"RS256"}]};
  expect("GET",issuer+"/.well-known/jwks.json",()=>Response.json(jwks));
  async function prepare(call) {
    const verifier = secureToken();
    const res = await call("connect",{body:{challenge:challenge(verifier)}});
    assert.equal(res.status,200,await res.clone().text());
    const auth = new URL((await res.json()).url);
    assert.equal(auth.origin,issuer);
    assert.equal(auth.searchParams.get("redirect_uri"),gateway+"/chatgpt/callback");
    assert.equal(auth.searchParams.get("client_id"),clientID);
    assert.equal(auth.searchParams.get("code_challenge_method"),"S256");
    return {verifier,auth};
  }
  async function deliver(call,{auth},{grant=true,validNonce=true}={}) {
    const nonce = auth.searchParams.get("nonce");
    const idToken = await new SignJWT({email:"qa@example.invalid",email_verified:true,nonce:validNonce ? nonce : "other"})
      .setProtectedHeader({alg:"RS256",kid:"test"}).setIssuer(issuer).setAudience(clientID)
      .setSubject("qa").setIssuedAt().setExpirationTime("2m").sign(privateKey);
    expect("POST",issuer+"/api/accounts/oauth/token",async req=>{
      const args = new URLSearchParams(await req.text());
      assert.equal(args.get("redirect_uri"),gateway+"/chatgpt/callback");
      assert.equal(args.get("client_id"),clientID);
      assert.equal(challenge(args.get("code_verifier")),auth.searchParams.get("code_challenge"));
      return Response.json({id_token:idToken,scope:grant ? "chatgpt.tokens.use.direct" : "openid",
        access_token:"test-access",refresh_token:"test-refresh",expires_in:3600});
    });
    const path = "callback?code=TEMP&state="+auth.searchParams.get("state");
    const response = await call(path);
    assert.equal(response.status,303,await response.clone().text());
    assert.equal((await call(path)).status,400,"OAuth state is one-time");
    return new URL(response.headers.get("Location"));
  }
  const denied = await deliver(web,await prepare(web),{grant:false});
  assert.equal(denied.hash,"#chatgpt=denied");
  const badIdentity = await deliver(web,await prepare(web),{validNonce:false});
  assert.equal(badIdentity.hash,"#chatgpt=denied");
  const attempt = await prepare(web);
  const redirect = await deliver(web,attempt);
  assert.equal(redirect.origin,website);
  const callback = new URLSearchParams(redirect.hash.slice(1));
  assert.equal(callback.get("chatgpt"), "connected", "The verified account returns to the site.");
  const ticket = callback.get("ticket");
  const body = {ticket,verifier:attempt.verifier};
  assert.equal((await ios("redeem",{body})).status,401,"Web tickets cannot be redeemed by iOS");
  assert.equal((await web("redeem",{body:{ticket,verifier:secureToken()}})).status,401);
  const {session,planOnly} = await (await web("redeem",{body})).json();
  assert.equal(planOnly,true);
  assert.equal((await web("redeem",{body})).status,401,"Ticket is single use");
  assert.deepEqual(await (await web("status",{token:session})).json(),{available:true,connected:true,planOnly:true,account:"qa@example.invalid"});
  assert.equal((await ios("status",{token:session})).status,200);
  assert.equal((await (await ios("status",{token:session})).json()).connected,false);
  const native = await prepare(ios);
  const nativeReturn = await deliver(ios,native);
  assert.equal(nativeReturn.protocol,"by.healthstory.familyjournal.chatgpt:");
  const nativeSession = await (await ios("redeem",{body:{ticket:nativeReturn.searchParams.get("ticket"),verifier:native.verifier}})).json();
  assert.equal(nativeSession.planOnly,true);
  assert.equal((await (await ios("status",{token:nativeSession.session})).json()).connected,true);

  const messages = [{role:"user",content:"Первый учебный вопрос"},{role:"assistant",content:"готово"},{role:"user",content:"Что было в ответе?"}];
  assert.equal((await web("send",{token:session,body:{messages,patient:"qa"}})).status,400);
  const api = "https://api.openai.com/v1";
  for(const status of [429,200]){
    expect("GET",api+"/models",req=>{
      assert.equal(req.headers.get("Authorization"),"Bearer test-access");
      return Response.json({models:[{slug:"example-chatgpt",visibility:"list"}]});
    });
    expect("POST",api+"/responses",async req=>{
      assert.equal(req.headers.get("Authorization"),"Bearer test-access");
      assert.deepEqual(await req.json(),{model:"example-chatgpt",input:messages,store:false,stream:true});
      return new Response('data: {"type":"response.output_text.delta","delta":"готово"}\n\ndata: {"type":"response.completed"}\n\n',{status});
    });
  }
  assert.equal((await web("send",{token:session,body:{messages}})).status,429);
  const reply = await (await web("send",{token:session,body:{messages}})).json();
  assert.deepEqual(reply,{answer:"готово",model:"example-chatgpt"});
  expect("POST",issuer+"/api/accounts/oauth/revoke",()=>Response.json({}));
  assert.deepEqual(await (await web("disconnect",{token:session,body:{}})).json(),{revoked:true});
  assert.equal((await web("send",{token:session,body:{messages}})).status,401);
  assert.deepEqual(expected,[]);
  console.log("PASS disabled gateway, authorization, signed identity, one-time callbacks, isolated platform sessions, quota, history and disconnect");
} finally { await instance.dispose(); }
