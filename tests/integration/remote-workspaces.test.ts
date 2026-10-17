import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID,createHash} from 'node:crypto';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {PublicDataService} from '@ledgerflow/public-data';
import {startLocalPostgres} from '../../scripts/local-postgres.js';
import {createRemoteRouter} from '../../apps/mcp-server/src/remote-router.js';
import {RemoteAuth,digest,sealSession,openSession} from '../../apps/mcp-server/src/remote-auth.js';
import {provisionWorkspace,tenantFixture} from '../../apps/mcp-server/src/remote-workspace.js';
import {SERVER_NAME} from '../../apps/mcp-server/src/server.js';

describe('remote verified users, OAuth and isolated human-approved ledgers',()=>{
 const origin='https://accounting.example',resource=origin+'/mcp',a=randomUUID(),b=randomUUID();
 const key=Buffer.alloc(32,17).toString('base64');
 let db:Awaited<ReturnType<typeof startLocalPostgres>>,router:ReturnType<typeof createRemoteRouter>;
 const cookies=new Map<string,{cookie:string;csrf:string}>(),clients:Client[]=[];
 const users=new Map([['a@example.test',a],['b@example.test',b]]);
 const authFetch:typeof fetch=async(input,init)=>{
  const url=String(input);
  if(url.includes('/token?grant_type=password')){
   const q=JSON.parse(String(init?.body));const id=users.get(q.email);
   if(q.password!=='fixture-password'||!id)return Response.json({error:'invalid_credentials'},{status:400});
   return Response.json({access_token:'verified-'+id,refresh_token:'refresh-'+id});
  }
  if(url.endsWith('/user')){
   const token=new Headers(init?.headers).get('authorization')?.replace('Bearer verified-','');
   const email=[...users].find(([,id])=>id===token)?.[0];
   return email?Response.json({id:token,email,email_confirmed_at:'2026-10-17T00:00:00Z'}):Response.json({error:'invalid'},{status:401});
  }
  return Response.json({error:'unsupported'},{status:400});
 };
 const call=async(path:string,init?:RequestInit,user?:string)=>{
  const session=user?cookies.get(user):undefined;
  const response=await router(new Request(origin+path,{...init,headers:{...(session?{cookie:session.cookie,'X-CSRF-Token':session.csrf}:{}),
   ...(init?.method&&init.method!=='GET'?{Origin:origin}:{}),...Object.fromEntries(new Headers(init?.headers))}}));
  return response??new Response('not found',{status:404});
 };
 const post=(body:unknown):RequestInit=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 async function authorize(user:string){
  const registration=await (await call('/oauth/register',post({client_name:user+' client',redirect_uris:['http://127.0.0.1:4567/callback'],token_endpoint_auth_method:'none'}))).json();
  const verifier='a'.repeat(50),query=new URLSearchParams({response_type:'code',client_id:registration.client_id,redirect_uri:'http://127.0.0.1:4567/callback',
   code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256',state:'fixture-state',resource,scope:'ledgerflow'});
  const path='/oauth/authorize?'+query;
  const permission=await (await call('/api/remote/authorization?request='+encodeURIComponent(path),post({}),user)).json();
  const redirect=new URL(permission.redirect);expect(redirect.searchParams.get('state')).toBe('fixture-state');expect(redirect.searchParams.get('iss')).toBe(origin);
  const fields=new URLSearchParams({grant_type:'authorization_code',client_id:registration.client_id,redirect_uri:'http://127.0.0.1:4567/callback',
   code_verifier:verifier,code:redirect.searchParams.get('code')!,resource});
  const response=await call('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:fields.toString()});
  expect(response.status).toBe(200);return {tokens:await response.json(),fields,registration,path};
 }
 async function connect(token:string){
  const client=new Client({name:'fixture-codex',version:'1'});
  const fetcher:typeof fetch=async(input,init)=>await router(new Request(input as string,init))??new Response(null,{status:404});
  await client.connect(new StreamableHTTPClientTransport(new URL(resource),{fetch:fetcher,requestInit:{headers:{Authorization:'Bearer '+token}}}));
  clients.push(client);return client;
 }
 const tool=async(client:Client,name:string,args:Record<string,unknown>={})=>(await client.callTool({name,arguments:args})).structuredContent as {ok:boolean;data:any;error?:{code:string}};
 beforeAll(async()=>{
  db=await startLocalPostgres();
  // Test-owned Auth harness only; real provisioning must use Supabase Auth.
  await db.pool.query('INSERT INTO auth.users(id) VALUES($1),($2)',[a,b]);
  router=createRemoteRouter({pool:db.pool,publicData:new PublicDataService({},'mock'),auth:{origin,supabaseUrl:'https://auth.example',publishableKey:'fixture-key',encryptionKey:key},
   authFetch,assets:{fetch:async()=>new Response('<html>sign in and consent</html>',{headers:{'Content-Type':'text/html'}})}});
  for(const email of users.keys()){
   const response=await call('/api/remote/login',post({email,password:'fixture-password'}));expect(response.status).toBe(200);
   const body=await response.json();cookies.set(email,{cookie:response.headers.get('set-cookie')!.split(';')[0]!,csrf:body.csrf});
   expect(response.headers.get('set-cookie')).toContain('HttpOnly; Secure; SameSite=Lax');
  }
 });
 afterAll(async()=>{for(const c of clients)await c.close();if(db)await db.stop();});
 it('provisions exactly 1000 isolated rows per verified user and never reseeds existing workspaces',async()=>{
  const wa=await provisionWorkspace(db.pool,a),wb=await provisionWorkspace(db.pool,b);
  expect(wa.companyId).not.toBe(wb.companyId);expect(wa.writerId).not.toBe(a);
  const rows=await db.pool.query('SELECT company_id,count(*)::int AS n FROM public.business_transactions GROUP BY company_id');
  expect(rows.rows).toHaveLength(2);expect(rows.rows.every(row=>row.n===1000)).toBe(true);
  expect(tenantFixture(a).transactions[0]!.id).not.toBe(tenantFixture(b).transactions[0]!.id);
  expect(await provisionWorkspace(db.pool,a)).toEqual(wa);
  await expect(provisionWorkspace(db.pool,randomUUID())).rejects.toThrow('AUTH_USER_REQUIRED');
 });
 it('discovers OAuth and requires S256, registered callbacks, matching resource and single-use codes',async()=>{
  const anonymous=await call('/mcp',post({}));expect(anonymous.status).toBe(401);expect(anonymous.headers.get('www-authenticate')).toContain('/.well-known/oauth-protected-resource/mcp');
  expect((await (await call('/.well-known/oauth-protected-resource/mcp')).json()).resource).toBe(resource);
  expect((await (await call('/.well-known/oauth-authorization-server')).json()).code_challenge_methods_supported).toEqual(['S256']);
  expect((await call('/oauth/register',post({redirect_uris:['javascript:alert(1)']}))).status).toBe(400);
  const grant=await authorize('a@example.test');
  expect((await call('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:grant.fields.toString()})).status).toBe(400);
  const foreign=new URL(grant.path,origin);foreign.searchParams.set('redirect_uri','https://attacker.example/callback');
  expect((await call(foreign.pathname+foreign.search)).status).toBe(400);
  const altered=new URL(grant.path,origin);altered.searchParams.set('resource','https://attacker.example/mcp');
  expect((await call(altered.pathname+altered.search)).status).toBe(400);
  const again=await call('/api/remote/authorization?request='+encodeURIComponent(grant.path),post({}),'a@example.test');
  const code=new URL((await again.json()).redirect).searchParams.get('code')!;
  const fields=new URLSearchParams(grant.fields);fields.set('code',code);fields.set('code_verifier','z'.repeat(50));
  expect((await call('/oauth/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:fields.toString()})).status).toBe(400);
 });
 it('runs the same 41 tools and 6 prompts, blocks foreign tenants/self-approval, and posts only after human web approval',async()=>{
  const ga=await authorize('a@example.test'),gb=await authorize('b@example.test'),ca=await connect(ga.tokens.access_token),cb=await connect(gb.tokens.access_token);
  expect((await tool(ca,'get_system_status')).data.server).toBe(SERVER_NAME);
  expect((await tool(cb,'get_system_status')).data.tools).toHaveLength(41);
  const ctxA=(await tool(ca,'get_company_context')).data,ctxB=(await tool(cb,'get_company_context')).data;
  expect((await ca.listPrompts()).prompts).toHaveLength(6);
  const prompt=await ca.getPrompt({name:'ledgerflow-audit'});expect(JSON.stringify(prompt)).toContain('전표 생성·승인·전기는 하지 않는다');
  const range={companyId:ctxA.companyId,from:'2026-01-01',to:'2026-01-31',kind:'sale'};
  const transaction=(await tool(ca,'get_transactions',range)).data.items[0];
  expect((await tool(cb,'get_transactions',range)).error?.code).toBe('FORBIDDEN');
  const j=(await tool(ca,'propose_journal_entry',{companyId:ctxA.companyId,transactionId:transaction.id,idempotencyKey:'remote-sale-test'})).data;
  expect(j.state).toBe('Draft');
  const journal={companyId:ctxA.companyId,journalId:j.id};
  expect((await tool(ca,'validate_journal_entry',journal)).ok).toBe(true);
  expect((await tool(ca,'request_journal_approval',journal)).ok).toBe(true);
  expect((await tool(ca,'post_journal_entry',{...journal,expectedHash:j.hash})).error?.code).toBe('APPROVAL_REQUIRED');
  const decision={...journal,expectedHash:j.hash,decision:'approved'};
  expect((await call('/api/human/decision',post(decision),'b@example.test')).status).toBe(403);
  expect((await call('/api/human/decision',{...post(decision),headers:{'Content-Type':'application/json','X-CSRF-Token':'forged'}},'a@example.test')).status).toBe(403);
  expect((await call('/api/human/decision',post({...decision,expectedHash:'0'.repeat(64)}),'a@example.test')).status).toBe(400);
  const accepted=await call('/api/human/decision',post(decision),'a@example.test');expect(accepted.status).toBe(200);
  const posted=await tool(ca,'post_journal_entry',{...journal,expectedHash:j.hash});expect(posted.data.state).toBe('Posted');
  expect((await tool(cb,'get_journal_entry',journal)).error?.code).toBe('FORBIDDEN');
  expect(await (await call('/api/journals',undefined,'b@example.test')).json()).toEqual([]);
  const reports=await (await call('/api/trial-balance?from=2026-01-01&to=2026-01-31',undefined,'a@example.test')).json();
  expect(reports.items.find((row:{accountCode:string})=>row.accountCode==='1100').balance).toBe(transaction.gross);
  expect(reports.totalDebit).toBe(reports.totalCredit);
  const other=await (await call('/api/trial-balance?from=2026-01-01&to=2026-01-31',undefined,'b@example.test')).json();
  expect(other.totalDebit).toBe('0');
  const actor=(await db.pool.query('SELECT created_by FROM public.journal_entries WHERE id=$1',[j.id])).rows[0].created_by;
  expect(actor).not.toBe(a);
  // Even a direct typed DB approval command by the MCP actor is forbidden.
  const workspace=await provisionWorkspace(db.pool,a),c=await db.pool.connect();
  try{await c.query('BEGIN');await c.query('SET LOCAL ROLE authenticated');await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[workspace.writerId]);
   expect((await c.query("SELECT private.has_company_scope($1,'accounting:approve') AS allowed",[workspace.companyId])).rows[0].allowed).toBe(false);
   expect((await c.query('SELECT count(*)::int AS n FROM public.business_transactions WHERE company_id=$1',[ctxB.companyId])).rows[0].n).toBe(0);
  }finally{await c.query('ROLLBACK');c.release();}
 });
 it('rotates refresh tokens and revokes only the requesting owner connection',async()=>{
  const grant=await authorize('a@example.test');
  const refresh=new URLSearchParams({grant_type:'refresh_token',client_id:grant.registration.client_id,refresh_token:grant.tokens.refresh_token,resource});
  const request={method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:refresh.toString()};
  const rotated=await (await call('/oauth/token',request)).json();expect(rotated.access_token).toBeTruthy();
  expect((await call('/oauth/token',request)).status).toBe(400);
  const access=(token:string)=>call('/mcp',{...post({}),headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'}});
  expect((await access(grant.tokens.access_token)).status).toBe(401);
  const id=(await db.pool.query('SELECT id FROM private.remote_oauth_grants WHERE access_hash=$1',[digest(rotated.access_token)])).rows[0].id;
  await call('/api/remote/connections',post({id}),'b@example.test');
  const auth=new RemoteAuth(db.pool,{origin,supabaseUrl:'https://auth.example',publishableKey:'fixture-key',encryptionKey:key},authFetch);
  expect(await auth.bearer(new Request(resource,{headers:{Authorization:'Bearer '+rotated.access_token}}))).toBe(a);
  await call('/api/remote/connections',post({id}),'a@example.test');
  expect((await access(rotated.access_token)).status).toBe(401);
 });
 it('encrypts provider sessions and rejects modification/wrong keys',()=>{
  const session={userId:a,email:'a@example.test',accessToken:'secret-access',refreshToken:'secret-refresh',csrf:'csrf'};
  const sealed=sealSession(session,key);expect(sealed).not.toContain('secret');
  expect(openSession(sealed,key)).toEqual(session);
  expect(()=>openSession(sealed,Buffer.alloc(32,18).toString('base64'))).toThrow();
  const bound=sealSession(session,key,'session-a');expect(()=>openSession(bound,key,'session-b')).toThrow();
 });
 it('rejects unverified identities, cross-origin browser writes and tokens for a different resource',async()=>{
  const unverified=new RemoteAuth(db.pool,{origin,supabaseUrl:'https://auth.example',publishableKey:'fixture-key',encryptionKey:key},
   async()=>Response.json({id:a,email:'a@example.test',email_confirmed_at:null}));
  await expect(unverified.verify('unverified-provider-token')).rejects.toMatchObject({code:'EMAIL_VERIFICATION_REQUIRED'});
  expect((await call('/api/remote/logout',{...post({}),headers:{Origin:'https://attacker.example','Content-Type':'application/json'}},'a@example.test')).status).toBe(403);
  const grant=await authorize('a@example.test');
  const foreign=new RemoteAuth(db.pool,{origin:'https://another.example',supabaseUrl:'https://auth.example',publishableKey:'fixture-key',encryptionKey:key},authFetch);
  expect(await foreign.bearer(new Request('https://another.example/mcp',{headers:{Authorization:'Bearer '+grant.tokens.access_token}}))).toBeUndefined();
  expect((await call('/api/human/session',{headers:{Authorization:'Bearer '+grant.tokens.access_token}})).status).not.toBe(200);
  await db.pool.query('UPDATE private.remote_oauth_grants SET expires_at=now()-interval \'1 second\' WHERE access_hash=$1',[digest(grant.tokens.access_token)]);
  expect((await call('/mcp',{...post({}),headers:{Authorization:'Bearer '+grant.tokens.access_token,'Content-Type':'application/json'}})).status).toBe(401);
 });
});
