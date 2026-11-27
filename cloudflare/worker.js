// Store ciphertext and grant metadata only. Each family's conditional writes run in one SQLite transaction.
import { pharmacySearch } from "./pharmacy.js";
import { DurableObject } from "cloudflare:workers";

const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const maxBytes = 16 * 1024 * 1024;
const chunkSize = 512 * 1024;
const response = (status, data = null, rev) => new Response(data, {
  status, headers: { "Cache-Control": "no-store", ...(rev === undefined ? {} : {ETag: '"' + rev + '"'}) }
});

async function digest(text) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, "0")).join("");
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");
    if (origin && origin !== env.WEB_ORIGIN) return response(403);
    if (new URL(request.url).pathname==="/pharmacy/search") {
      const headers={"Access-Control-Allow-Origin":env.WEB_ORIGIN,"Vary":"Origin","Access-Control-Allow-Methods":"POST, OPTIONS","Access-Control-Allow-Headers":"Content-Type"};
      if(request.method==="OPTIONS")return new Response(null,{status:204,headers});
      const result=await pharmacySearch(request);
      return new Response(result.body,{status:result.status,headers:{...Object.fromEntries(result.headers),...headers}});
    }
    const path = new URL(request.url).pathname.split("/").slice(1);
    if (path[0] !== "sync" || path.length < 2 || path.length > 5 || !path.slice(1).every(x => idPattern.test(x))) return response(404);
    const cors = {
      "Access-Control-Allow-Origin": env.WEB_ORIGIN, "Vary": "Origin",
      "Access-Control-Allow-Methods": "GET, PUT, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Authorization, If-Match, Content-Type, X-Family-Setup",
      "Access-Control-Expose-Headers": "ETag", "Access-Control-Max-Age": "600"
    };
    if (request.method === "OPTIONS") return new Response(null, {status:204,headers:cors});
    const auth = request.headers.get("Authorization") || "";
    if (!auth.startsWith("Bearer ") || !tokenPattern.test(auth.slice(7))) return response(401);
    // One object prevents arbitrary URLs from allocating a database per unauthenticated family.
    const store = env.FAMILIES.getByName("household");
    const result = await store.fetch(request);
    const headers = new Headers(result.headers);
    for (const [name,value] of Object.entries(cors)) headers.set(name,value);
    return new Response(result.body,{status:result.status,headers});
  }
};

export class FamilyStore extends DurableObject {
  constructor(ctx,env) {
    super(ctx,env);
    this.sql = ctx.storage.sql;
    this.sql.exec(`CREATE TABLE IF NOT EXISTS family(id TEXT PRIMARY KEY, admin TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS device(f TEXT,id TEXT,token TEXT,grants TEXT,revoked INTEGER DEFAULT 0,PRIMARY KEY(f,id),UNIQUE(f,token));
      CREATE TABLE IF NOT EXISTS head(f TEXT,p TEXT,n TEXT,rev INTEGER NOT NULL,PRIMARY KEY(f,p,n));
      CREATE TABLE IF NOT EXISTS chunk(f TEXT,p TEXT,n TEXT,i INTEGER,v BLOB NOT NULL,PRIMARY KEY(f,p,n,i));`);
  }
  async fetch(req) {
    const parts = new URL(req.url).pathname.split("/").slice(2);
    const token = await digest(req.headers.get("Authorization").slice(7));
    if (Number(req.headers.get("Content-Length")) > maxBytes) return response(413);
    const body = [];
    let total = 0;
    if (req.body) {
      const reader = req.body.getReader();
      for (;;) {
        const {done,value} = await reader.read();
        if (done) break;
        total += value.length;
        if (total > maxBytes) { await reader.cancel(); return response(413); }
        body.push(value);
      }
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const block of body) { bytes.set(block,offset); offset += block.length; }
    return this.ctx.storage.transactionSync(() => this.dispatch(req,parts,token,bytes));
  }
  dispatch(req,parts,token,bytes) {
    const [f,kind,id,object] = parts, method = req.method;
    const row = (sql,...args) => this.sql.exec(sql,...args).toArray()[0];
    const family = row("SELECT admin FROM family WHERE id=?",f);
    if (parts.length===1 && method==="PUT") {
      if (family) return response(token===family.admin ? 204 : 403);
      if (!this.env.SETUP_CODE || req.headers.get("X-Family-Setup")!==this.env.SETUP_CODE) return response(403);
      this.sql.exec("INSERT INTO family VALUES(?,?)",f,token);
      return response(204);
    }
    if (!family) return response(404);
    const admin = token===family.admin;
    const device = admin ? null : row("SELECT id,grants FROM device WHERE f=? AND token=? AND revoked=0",f,token);
    if (!admin && !device) return response(403);
    if (kind==="devices" && parts.length===3 && admin) {
      if (method==="DELETE") { this.sql.exec("UPDATE device SET revoked=1 WHERE f=? AND id=?",f,id); return response(204); }
      if (method!=="PUT") return response(405);
      let grant;
      try { grant=JSON.parse(new TextDecoder().decode(bytes)); } catch { return response(400); }
      if (!grant || typeof grant.tokenHash!=="string" || !/^[a-f0-9]{64}$/.test(grant.tokenHash) ||
          !grant.grants || typeof grant.grants!=="object" || Array.isArray(grant.grants) || !Object.keys(grant.grants).length ||
          !Object.entries(grant.grants).every(([k,v]) => idPattern.test(k) && ["read","self","edit"].includes(v))) return response(400);
      const old=row("SELECT revoked,token FROM device WHERE f=? AND id=?",f,id);
      if (old && (old.revoked || old.token!==grant.tokenHash)) return response(403);
      this.sql.exec("INSERT INTO device(f,id,token,grants) VALUES(?,?,?,?) ON CONFLICT(f,id) DO UPDATE SET grants=excluded.grants",f,id,grant.tokenHash,JSON.stringify(grant.grants));
      return response(204);
    }
    const roster = kind==="devices" && object==="roster";
    if (parts.length!==4 || (!roster && (kind!=="profiles" || !(["records","consent"].includes(object) || object.startsWith("blob-"))))) return response(404);
    if (!admin) {
      if (roster && (method!=="GET" || device.id!==id)) return response(403);
      if (!roster) {
        const grants=JSON.parse(device.grants), access=Object.hasOwn(grants,id) && grants[id];
        if (!access || (method!=="GET" && (access==="read" || (object==="consent" && access!=="self")))) return response(403);
      }
    }
    const key=[f,roster ? "@"+id : id, object];
    const rev=row("SELECT rev FROM head WHERE f=? AND p=? AND n=?",...key)?.rev || 0;
    if (method==="GET") {
      if (!rev) return response(404);
      const chunks=this.sql.exec("SELECT v FROM chunk WHERE f=? AND p=? AND n=? ORDER BY i",...key);
      return response(200,new Blob(Array.from(chunks,c=>c.v)),rev);
    }
    if (method!=="PUT" || !bytes.length) return response(400);
    if (req.headers.get("If-Match")!=='"'+rev+'"' || (rev && object.startsWith("blob-"))) return response(412);
    this.sql.exec("INSERT INTO head VALUES(?,?,?,?) ON CONFLICT(f,p,n) DO UPDATE SET rev=excluded.rev",...key,rev+1);
    this.sql.exec("DELETE FROM chunk WHERE f=? AND p=? AND n=?",...key);
    for (let i=0;i<bytes.length;i+=chunkSize) this.sql.exec("INSERT INTO chunk VALUES(?,?,?,?,?)",...key,i,bytes.slice(i,i+chunkSize).buffer);
    return response(204,null,rev+1);
  }
}
