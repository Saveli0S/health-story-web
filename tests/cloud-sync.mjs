import {randomBytes,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const [endpoint, setupPath] = process.argv.slice(2);
if (!endpoint || !setupPath) throw Error('Usage: node tests/cloud-sync.mjs https://worker /path/to/setup-code');
const setup=(await readFile(setupPath,'utf8')).trim();
const secret=()=>randomBytes(32).toString('base64url');
const space=secret(), admin=secret(), child=secret(), adult=secret();
async function call(method, token, suffix, status, body, headers={}) {
  const res=await fetch(new URL('/sync/'+space+suffix,endpoint),{method,body,headers:{Authorization:'Bearer '+token,...headers}});
  assert.equal(res.status,status,method+' '+suffix+' expected '+status+', got '+res.status);
  return res;
}
await call('PUT',admin,'',403);
await call('PUT',admin,'',204,undefined,{'X-Family-Setup':setup});
await call('PUT',adult,'',403);
for (const [id,token,grants] of [['child',child,{'p-child':'read'}],['adult',adult,{'p-child':'edit','p-adult':'self'}]]) {
  await call('PUT',admin,'/devices/'+id,204,JSON.stringify({tokenHash:createHash('sha256').update(token).digest('hex'),grants}));
}
const match=rev=>({'If-Match':'"'+rev+'"'});
const path='/profiles/p-child/records';
await call('PUT',adult,path,204,'test revision',match(0));
await call('PUT',adult,path,412,'stale',match(0));
const received=await call('GET',child,path,200);
assert.equal(received.headers.get('etag'),'"1"');
assert.equal(await received.text(),'test revision');
await call('PUT',child,path,403,'child write',match(1));
await call('GET',child,'/profiles/p-adult/records',403);
await call('PUT',adult,'/profiles/p-child/consent',403,'change');
const bytes=randomBytes(1150000), file='/profiles/p-child/blob-test';
await call('PUT',admin,file,204,bytes,match(0));
assert.deepEqual(Buffer.from(await (await call('GET',child,file,200)).arrayBuffer()),bytes);
await call('PUT',admin,file,412,bytes,match(1));
await call('DELETE',admin,'/devices/child',204);
await call('GET',child,file,403);
await call('GET',adult,path,403,undefined,{Origin:'https://example.org'});
console.log('PASS registration, grants, revisions, immutable multi-chunk file, origin and revocation');
