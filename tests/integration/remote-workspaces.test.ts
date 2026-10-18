import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {PublicDataService} from '@ledgerflow/public-data';
import {startLocalPostgres} from '../../scripts/local-postgres.js';
import {createRemoteRouter} from '../../apps/mcp-server/src/remote-router.js';
import {RemoteAuth,digest,sealSession,openSession} from '../../apps/mcp-server/src/remote-auth.js';
import {provisionWorkspace,tenantFixture} from '../../apps/mcp-server/src/remote-workspace.js';
import {SERVER_NAME} from '../../apps/mcp-server/src/server.js';
import {GuestLearning} from '../../apps/mcp-server/src/guest-learning.js';
import {collectLearningBundle} from '../../scripts/build-learning-bundle.js';

describe('remote verified users, OAuth and isolated human-approved ledgers',()=>{
 const origin='https://accounting.example',resource=origin+'/mcp',a=randomUUID(),b=randomUUID();
 const key=Buffer.alloc(32,17).toString('base64');
 let db:Awaited<ReturnType<typeof startLocalPostgres>>,router:ReturnType<typeof createRemoteRouter>;
 const cookies=new Map<string,{cookie:string;csrf:string}>(),clients:Client[]=[];
 const users=new Map([['a@example.test',a],['b@example.test',b]]);
 const providerCodes=new Map<string,{id:string;challenge:string}>();let googleEnabled=true;
 const authFetch:typeof fetch=async(input,init)=>{
  const url=String(input);
  if(url.endsWith('/settings'))return Response.json({external:{google:googleEnabled}});
  if(url.includes('/token?grant_type=pkce')){
   const q=JSON.parse(String(init?.body)),record=providerCodes.get(q.auth_code);providerCodes.delete(q.auth_code);
   if(!record||createHash('sha256').update(q.code_verifier).digest('base64url')!==record.challenge)return Response.json({error:'invalid_grant'},{status:400});
   return Response.json({access_token:'verified-'+record.id,refresh_token:'refresh-'+record.id,provider_token:'must-not-persist-google-token'});
  }
  if(url.endsWith('/user')){
   const token=new Headers(init?.headers).get('authorization')?.replace('Bearer verified-','');
   const email=[...users].find(([,id])=>id===token)?.[0];
   return email?Response.json({id:token,email,email_confirmed_at:'2026-10-17T00:00:00Z',identities:[{provider:'google'}]}):Response.json({error:'invalid'},{status:401});
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
 async function googleStart(email:string,returnTo='/'){
  const response=await call('/api/remote/google/start',post({returnTo}));expect(response.status).toBe(200);
  const location=new URL((await response.json()).redirect),code=randomUUID();
  expect(location.origin).toBe('https://auth.example');expect(location.pathname).toBe('/auth/v1/authorize');
  expect(location.searchParams.get('provider')).toBe('google');expect(location.searchParams.get('code_challenge_method')).toBe('s256');
  expect(location.searchParams.get('redirect_to')).toBe(origin+'/api/remote/google/callback');
  expect(location.href).not.toMatch(/code_verifier|access_token|refresh_token/u);
  providerCodes.set(code,{id:users.get(email)!,challenge:location.searchParams.get('code_challenge')!});
  return {code,cookie:response.headers.get('set-cookie')!.split(';')[0]!,response};
 }
 const googleCallback=(flow:{code:string;cookie:string},query='code='+flow.code)=>call('/api/remote/google/callback?'+query,{headers:{Cookie:flow.cookie}});
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
  const bundle=(await collectLearningBundle()).bundle;
  router=createRemoteRouter({pool:db.pool,publicData:new PublicDataService({},'mock'),auth:{origin,supabaseUrl:'https://auth.example',publishableKey:'fixture-key',encryptionKey:key},
   authFetch,assets:{fetch:async request=>new URL(request.url).pathname==='/learning-bundle.json'?Response.json(bundle):new Response('<html>sign in and consent</html>',{headers:{'Content-Type':'text/html'}})}});
  for(const email of users.keys()){
   const response=await googleCallback(await googleStart(email));expect(response.status).toBe(303);
   const cookie=response.headers.getSetCookie().find(value=>value.startsWith('lf_remote='))!.split(';')[0]!;
   const session=await (await call('/api/remote/session',{headers:{Cookie:cookie}})).json();
   cookies.set(email,{cookie,csrf:session.csrf});
   expect(response.headers.get('set-cookie')).toContain('HttpOnly; Secure; SameSite=Lax');
  }
 });
 afterAll(async()=>{for(const c of clients)await c.close();if(db)await db.stop();});
 it('offers only configured Google sign-in, requires same-origin start and retires password endpoints',async()=>{
  expect((await (await call('/api/remote/config')).json()).googleLogin).toEqual({enabled:true,checked:true});
  for(const path of ['/api/remote/login','/api/remote/signup'])expect((await call(path,post({email:'a@example.test',password:'unused'}))).status).toBe(410);
  expect((await call('/api/remote/google/start',{...post({}),headers:{Origin:'https://attacker.example','Content-Type':'application/json'}})).status).toBe(403);
  expect((await call('/api/remote/google/start')).status).toBe(403);
  for(const returnTo of ['https://attacker.example','//attacker.example','/\\attacker.example','/api/human/decision','/#fragment','/oauth/authorize?client_id=unknown'])
   expect((await call('/api/remote/google/start',post({returnTo}))).status).not.toBe(200);
  googleEnabled=false;
  try{const r=await call('/api/remote/google/start',post({}));expect((await r.json()).error).toBe('GOOGLE_PROVIDER_NOT_CONFIGURED');expect(r.headers.has('set-cookie')).toBe(false);}
  finally{googleEnabled=true;}
 });
 it('binds one-time Google codes to the original browser and keeps provider tokens server-side',async()=>{
  const first=await googleStart('a@example.test'),other=await googleStart('b@example.test');
  const invalid=await googleCallback({...first,cookie:other.cookie});expect(invalid.status).toBe(303);
  expect(invalid.headers.get('location')).toBe(origin+'/?auth_error=google_failed');
  expect(invalid.headers.getSetCookie().some(value=>value.startsWith('lf_remote='))).toBe(false);
  const good=await googleStart('a@example.test'),success=await googleCallback(good);
  expect(success.headers.get('location')).toBe(origin+'/');expect(success.headers.get('referrer-policy')).toBe('no-referrer');
  expect(success.headers.get('set-cookie')).not.toMatch(/verified-|refresh-|must-not-persist/u);
  const replay=await googleCallback(good);expect(replay.headers.get('location')).toContain('google_failed');
  const stored=await db.pool.query('SELECT token_hash,encrypted_session FROM private.remote_browser_sessions');
  expect(JSON.stringify(stored.rows)).not.toMatch(/verified-|refresh-|must-not-persist/u);
  expect(stored.rows.every(row=>!JSON.stringify(openSession(row.encrypted_session,key,row.token_hash)).includes('must-not-persist'))).toBe(true);
  const x=await googleStart('a@example.test'),y=await googleStart('b@example.test');
  await db.pool.query('UPDATE private.remote_login_flows SET encrypted_flow=(SELECT encrypted_flow FROM private.remote_login_flows WHERE token_hash=$1) WHERE token_hash=$2',
   [digest(x.cookie.split('=')[1]!),digest(y.cookie.split('=')[1]!)]);
  expect((await googleCallback(y)).headers.get('location')).toContain('google_failed');
 });
 it('expires/cancels Google flows and refuses missing cookies without disclosing callback inputs',async()=>{
  const expired=await googleStart('a@example.test');
  await db.pool.query('UPDATE private.remote_login_flows SET expires_at=now()-interval \'1 second\' WHERE token_hash=$1',[digest(expired.cookie.split('=')[1]!)]);
  expect((await googleCallback(expired)).headers.get('location')).toContain('google_failed');
  const cancelled=await googleStart('a@example.test'),failure=await googleCallback(cancelled,'error=access_denied&error_description=private-marker');
  expect(failure.headers.get('location')).toBe(origin+'/?auth_error=google_failed');expect(failure.headers.get('set-cookie')).toContain('Max-Age=0');
  expect((await call('/api/remote/google/callback?code=private-marker')).headers.get('location')).not.toContain('private-marker');
 });
 it('returns Google users to the pending MCP consent without granting access or approval automatically',async()=>{
  const registration=await (await call('/oauth/register',post({client_name:'Google round trip',redirect_uris:['http://localhost:4567/callback']}))).json();
  const query=new URLSearchParams({response_type:'code',client_id:registration.client_id,redirect_uri:'http://localhost:4567/callback',code_challenge:'a'.repeat(43),
   code_challenge_method:'S256',state:'mcp-state-preserved',resource,scope:'ledgerflow'});
  const path='/oauth/authorize?'+query;
  const before=(await db.pool.query('SELECT count(*)::int AS n FROM private.remote_oauth_grants')).rows[0].n;
  const response=await googleCallback(await googleStart('a@example.test',path));expect(response.headers.get('location')).toBe(origin+path);
  expect((await db.pool.query('SELECT count(*)::int AS n FROM private.remote_oauth_grants')).rows[0].n).toBe(before);
 });
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
  const anonymous=await call('/mcp',post({}));expect(anonymous.status).toBe(428);expect(anonymous.headers.has('www-authenticate')).toBe(false);
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
 it('redeems a browser-issued ticket into the exact Google company and exposes its journal in the same approval list',async()=>{
  expect((await call('/api/remote/setup-ticket',post({}))).status).toBe(401);
  expect((await call('/api/remote/setup-ticket',{...post({}),headers:{Origin:'https://attacker.example','Content-Type':'application/json'}},'a@example.test')).status).toBe(403);
  const before=(await db.pool.query('SELECT count(*)::int AS n FROM private.guest_workspaces')).rows[0].n;
  const session=await (await call('/api/remote/session',undefined,'a@example.test')).json();
  const issued=await (await call('/api/remote/setup-ticket',post({}),'a@example.test')).json();
  expect(issued.companyId).toBe(session.companyId);
  const bootstrapKey=randomBytes(32).toString('base64url'),body={claimCode:issued.claimCode,bootstrapKey,client:'codex'};
  const linked=await (await call('/api/remote/claim',post(body))).json();expect(linked.companyId).toBe(session.companyId);
  expect((await (await call('/api/remote/claim',post(body))).json()).token).toBe(linked.token);
  expect((await (await call('/api/remote/claim',post({...body,bootstrapKey:randomBytes(32).toString('base64url')}))).json()).error).toBe('CLAIM_CODE_USED');
  expect((await call('/api/remote/guest',post({bootstrapKey}),'a@example.test')).status).toBe(409);
  const c=await connect(linked.token);expect((await tool(c,'get_system_status')).ok).toBe(true);
  expect((await tool(c,'get_company_context')).data.companyId).toBe(session.companyId);
  const prepared=await tool(c,'propose_journal_entry',{companyId:session.companyId,idempotencyKey:randomUUID(),firstSale:{from:'2026-01-01',to:'2026-01-31'},validateAndRequestApproval:true,client:'codex'});
  expect(prepared.ok).toBe(true);expect(prepared.data.state).toBe('Approval');expect(prepared.data.approvalUrl).toBe(origin+'/?journal='+prepared.data.id);
  const journals=await (await call('/api/journals',undefined,'a@example.test')).json();expect(journals.some((j:any)=>j.id===prepared.data.id)).toBe(true);
  const status=await (await call('/api/remote/workspace-status',undefined,'a@example.test')).json();expect(status.companyId).toBe(session.companyId);expect(status.lastMcpCall.tool).toBe('propose_journal_entry');expect(status.aiPreparedJournals.some((j:any)=>j.id===prepared.data.id)).toBe(true);
  expect((await tool(c,'post_journal_entry',{companyId:session.companyId,journalId:prepared.data.id,expectedHash:prepared.data.hash})).error?.code).toBe('APPROVAL_REQUIRED');
  expect((await tool(c,'get_transactions',{companyId:(await provisionWorkspace(db.pool,b)).companyId,from:'2026-01-01',to:'2026-01-31'})).error?.code).toBe('FORBIDDEN');
  const other=await (await call('/api/remote/workspace-status',undefined,'b@example.test')).json();expect(other.aiPreparedJournals.some((j:any)=>j.id===prepared.data.id)).toBe(false);
  const expired=await (await call('/api/remote/setup-ticket',post({}),'a@example.test')).json();await db.pool.query("UPDATE private.remote_setup_tickets SET expires_at=now()-interval '1 second' WHERE code_hash=$1",[digest(expired.claimCode)]);
  expect((await (await call('/api/remote/claim',post({...body,claimCode:expired.claimCode}))).json()).error).toBe('CLAIM_CODE_EXPIRED');
  expect((await db.pool.query('SELECT count(*)::int AS n FROM private.guest_workspaces')).rows[0].n).toBe(before);
  const connection=(await (await call('/api/remote/connections',undefined,'a@example.test')).json()).find((l:any)=>l.name==='codex'&&!l.revoked);
  await call('/api/remote/connections',post({id:connection.id}),'b@example.test');expect((await tool(c,'get_company_context')).ok).toBe(true);
  await call('/api/remote/connections',post({id:connection.id}),'a@example.test');expect((await call('/mcp',{...post({}),headers:{Authorization:'Bearer '+linked.token,'Content-Type':'application/json'}})).status).toBe(403);
 });
 it('adopts existing guest work over an untouched Google fixture, keeps the old AI URL working, and preserves both companies',async()=>{
  const id=randomUUID(),email='bridge@example.test';users.set(email,id);await db.pool.query('INSERT INTO auth.users(id) VALUES($1)',[id]);
  const response=await googleCallback(await googleStart(email)),cookie=response.headers.getSetCookie().find(v=>v.startsWith('lf_remote='))!.split(';')[0]!;
  const session=await (await call('/api/remote/session',{headers:{Cookie:cookie}})).json();cookies.set(email,{cookie,csrf:session.csrf});
  const guest=new GuestLearning(db.pool,origin,key,new PublicDataService({},'mock')),g=await guest.provision({bootstrapKey:randomBytes(32).toString('base64url')});
  const c=await connect(g.token);await tool(c,'get_system_status');await tool(c,'get_company_context');
  const prepared=await tool(c,'propose_journal_entry',{companyId:g.companyId,idempotencyKey:randomUUID(),firstSale:{from:'2026-01-01',to:'2026-01-31'},validateAndRequestApproval:true,client:'codex'});expect(prepared.ok).toBe(true);
  const ticket=await (await call('/api/remote/setup-ticket',post({}),email)).json();
  const params=new URLSearchParams({client:'codex',requestId:randomUUID(),claimCode:ticket.claimCode,bootstrapKey:randomBytes(32).toString('base64url'),guestToken:g.token});
  const boot=await call('/api/remote/bootstrap?'+params),bundle=await boot.json();expect(boot.status).toBe(200);expect(bundle.companyId).toBe(g.companyId);expect(bundle.identityMode).toBe('personal');
  expect(bundle.files['.codex/config.toml']).toContain('/mcp/p/lf_personal_');
  expect(JSON.parse(bundle.files['.ledgerflow/guest-session.json'])).toMatchObject({mode:'personal',companyId:g.companyId});
  expect((await tool(c,'get_company_context')).data.companyId).toBe(g.companyId);
  const renewal=await (await call('/api/remote/setup-ticket',post({}),email)).json();
  expect((await (await call('/api/remote/claim',post({claimCode:renewal.claimCode,bootstrapKey:randomBytes(32).toString('base64url'),client:'codex',guestToken:g.token}))).json()).companyId).toBe(g.companyId);
  expect((await (await call('/api/remote/session',undefined,email)).json()).companyId).toBe(g.companyId);
  const journals=await (await call('/api/journals',undefined,email)).json();expect(journals.some((j:any)=>j.id===prepared.data.id)).toBe(true);
  expect((await (await call('/api/approval?id='+prepared.data.id,undefined,email)).json()).status).toBe('pending');
  expect((await db.pool.query('SELECT count(*)::int AS n FROM public.business_transactions WHERE company_id=ANY($1::uuid[])',[ [session.companyId,g.companyId] ])).rows[0].n).toBe(2000);
  expect((await db.pool.query('SELECT previous_company_id,company_id FROM private.remote_workspace_history WHERE user_id=$1',[id])).rows[0]).toMatchObject({previous_company_id:session.companyId,company_id:g.companyId});
  const other=await guest.provision({bootstrapKey:randomBytes(32).toString('base64url')});await expect(guest.claim(other.id,id)).rejects.toMatchObject({code:'WORKSPACE_SELECTION_REQUIRED'});
  expect((await tool(c,'get_company_context')).data.companyId).toBe(g.companyId);
  expect((await tool(c,'get_transactions',{companyId:session.companyId,from:'2026-01-01',to:'2026-01-31'})).error?.code).toBe('FORBIDDEN');
  // Explicit human decision in the test-owned browser, never in production.
  expect((await call('/api/human/decision',post({companyId:g.companyId,journalId:prepared.data.id,expectedHash:prepared.data.hash,decision:'approved'}),email)).status).toBe(200);
  expect((await tool(c,'post_journal_entry',{companyId:g.companyId,journalId:prepared.data.id,expectedHash:prepared.data.hash})).data.state).toBe('Posted');
  expect((await (await call('/api/journal?id='+prepared.data.id,undefined,email)).json()).state).toBe('Posted');
 },60000);
 it('links a reviewed guest into an already signed-in Google browser without approving it or giving the writer approval scope',async()=>{
  const id=randomUUID(),email='web-link@example.test';users.set(email,id);await db.pool.query('INSERT INTO auth.users(id) VALUES($1)',[id]);
  const response=await googleCallback(await googleStart(email)),cookie=response.headers.getSetCookie().find(v=>v.startsWith('lf_remote='))!.split(';')[0]!;
  const session=await (await call('/api/remote/session',{headers:{Cookie:cookie}})).json();cookies.set(email,{cookie,csrf:session.csrf});
  const guest=new GuestLearning(db.pool,origin,key,new PublicDataService({},'mock')),g=await guest.provision({bootstrapKey:randomBytes(32).toString('base64url')}),c=await connect(g.token);
  await tool(c,'get_system_status');await tool(c,'get_company_context');
  const prepared=await tool(c,'propose_journal_entry',{companyId:g.companyId,idempotencyKey:randomUUID(),firstSale:{from:'2026-01-01',to:'2026-01-31'},validateAndRequestApproval:true,client:'codex'});
  // Test-owned human fixture only. No production approval URL is opened.
  const ticket=new URLSearchParams(new URL(prepared.data.approvalUrl).hash.slice(1)).get('ticket');
  const opened=await call('/api/remote/guest-review/open',{...post({ticket}),headers:{'Sec-Fetch-Site':'same-origin','Content-Type':'application/json'}},email);expect(opened.status).toBe(200);
  const combined=cookie+'; '+opened.headers.getSetCookie()[0]!.split(';')[0];
  const headers={Cookie:combined,'Content-Type':'application/json'};
  expect((await call('/api/remote/link-guest',{...post({}),headers:{...headers,'X-CSRF-Token':'invalid'}},email)).status).toBe(403);
  expect((await call('/api/remote/guest-review',{headers:{Cookie:combined}})).status).toBe(200);
  const linked=await call('/api/remote/link-guest',{...post({}),headers},email);expect(linked.status).toBe(200);expect((await linked.json()).companyId).toBe(g.companyId);
  expect((await (await call('/api/context',{headers:{Cookie:combined}})).json()).company.companyId).toBe(g.companyId);
  expect((await (await call('/api/approval?id='+prepared.data.id,undefined,email)).json()).status).toBe('pending');
  expect((await tool(c,'get_company_context')).data.companyId).toBe(g.companyId);
  expect((await tool(c,'post_journal_entry',{companyId:g.companyId,journalId:prepared.data.id,expectedHash:prepared.data.hash})).error?.code).toBe('APPROVAL_REQUIRED');
 },60000);
});
