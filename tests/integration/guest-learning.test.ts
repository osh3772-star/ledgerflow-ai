import {afterAll,beforeAll,describe,it,expect} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {PublicDataService} from '@ledgerflow/public-data';
import {startLocalPostgres} from '../../scripts/local-postgres.js';
import {createRemoteRouter} from '../../apps/mcp-server/src/remote-router.js';
import {GuestLearning} from '../../apps/mcp-server/src/guest-learning.js';
import {verifyLearningMcp} from '../../scripts/learning-in-place.js';

describe('isolated guest learning and journal-bound human review',()=>{
 const origin='https://guest.example',key=Buffer.alloc(32,19).toString('base64');
 let db:Awaited<ReturnType<typeof startLocalPostgres>>,router:ReturnType<typeof createRemoteRouter>,guest:GuestLearning,a:any,b:any;
 const clients:Client[]=[];
 const fetcher:typeof fetch=async(input,init)=>await router(new Request(input as string,init))??new Response(null,{status:404});
 const call=(path:string,body?:unknown,headers:Record<string,string>={})=>fetcher(origin+path,{...(body?{method:'POST',body:JSON.stringify(body),headers:{'Content-Type':'application/json',Origin:origin,'Sec-Fetch-Site':'same-origin',...headers}}:{headers})});
 async function connect(token?:string){
  const c=new Client({name:'guest-test',version:'1'});
  await c.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{fetch:fetcher,...(token?{requestInit:{headers:{Authorization:'Bearer '+token}}}:{})}));clients.push(c);return c;
 }
 const tool=async(c:Client,name:string,args:Record<string,unknown>={})=>(await c.callTool({name,arguments:args})).structuredContent as any;
 async function draft(c:Client,companyId:string){
  const tx=(await tool(c,'get_transactions',{companyId,kind:'sale',from:'2026-01-01',to:'2026-01-31'})).data.items[0];
  const j=(await tool(c,'propose_journal_entry',{companyId,transactionId:tx.id,idempotencyKey:randomUUID()})).data;
  const q={companyId,journalId:j.id};expect((await tool(c,'validate_journal_entry',q)).ok).toBe(true);
  const pending=await tool(c,'request_journal_approval',q);expect(pending.ok).toBe(true);return {j:pending.data,q};
 }
 async function browser(j:any){
  const ticket=new URLSearchParams(new URL(j.approvalUrl).hash.slice(1)).get('ticket');
  const response=await call('/api/remote/guest-review/open',{ticket});expect(response.status).toBe(200);
  const cookie=response.headers.get('set-cookie')!.split(';')[0]!,body=await response.json();return {ticket,cookie,csrf:body.csrf};
 }
 beforeAll(async()=>{
  db=await startLocalPostgres();const publicData=new PublicDataService({},'mock');guest=new GuestLearning(db.pool,origin,key,publicData);
  router=createRemoteRouter({pool:db.pool,publicData,auth:{origin,encryptionKey:key,supabaseUrl:'https://auth.example',publishableKey:'test'},
   authFetch:async()=>Response.json({external:{google:true}}),assets:{fetch:async()=>new Response('test')}});
  a=await guest.provision({bootstrapKey:randomBytes(32).toString('base64url')});b=await guest.provision({bootstrapKey:randomBytes(32).toString('base64url')});
 });
 afterAll(async()=>{for(const c of clients)await c.close();if(db)await db.stop();});
 it('seeds separate companies with 1000 rows and never creates anonymous Auth users',async()=>{
  expect(a.companyId).not.toBe(b.companyId);
  expect((await db.pool.query('SELECT count(*)::int AS n FROM auth.users')).rows[0].n).toBe(0);
  const rows=(await db.pool.query('SELECT count(*)::int AS n FROM public.business_transactions GROUP BY company_id')).rows;
  expect(rows.map(r=>r.n)).toEqual([1000,1000]);
  const bootstrapKey=randomBytes(32).toString('base64url'),one=await guest.provision({bootstrapKey}),two=await guest.provision({bootstrapKey});
  expect(two).toMatchObject({...one,reused:true});
  expect((await call('/api/remote/guest',{bootstrapKey},{Origin:'https://bad.example'})).status).toBe(403);
 });
 it('initializes tokenless MCP without OAuth and keeps the same company through standard SDK session headers',async()=>{
  const c=await connect(),s=await tool(c,'get_system_status'),first=await tool(c,'get_company_context'),second=await tool(c,'get_company_context');
  expect(s.data.tools).toHaveLength(41);expect(first.ok).toBe(true);expect(second.data.companyId).toBe(first.data.companyId);
  expect(first.data.name).toBe('한빛유통 주식회사');
  expect(first.data.companyId).not.toBe(a.companyId);
  expect((await call('/mcp',{})).status).toBe(428);
 });
 it('verifies actual MCP calls for a pinned guest key, not native app hot-reload',async()=>{
  expect(await verifyLearningMcp(origin+'/mcp',a.token,fetcher)).toMatchObject({get_system_status:true,get_company_context:true,companyId:a.companyId,toolCount:41});
  const c=await connect(a.token);expect((await tool(c,'get_transactions',{companyId:b.companyId,from:'2026-01-01',to:'2026-01-31'})).error.code).toBe('FORBIDDEN');
  const bad=await call('/mcp',{jsonrpc:'2.0',id:1,method:'initialize'},{Authorization:'Bearer lf_guest_'+'x'.repeat(43)});
  expect(bad.status).toBe(403);expect(bad.headers.has('www-authenticate')).toBe(false);
 });
 it('cannot post or approve via writer tools; merely opening a link does not approve',async()=>{
  const c=await connect(a.token),{j,q}=await draft(c,a.companyId);
  expect(j.approvalUrl).toMatch(/^https:\/\/guest.example\/guest\/approval\/#ticket=/u);
  expect((await c.listTools()).tools.some(t=>/decide|approve_journal/u.test(t.name))).toBe(false);
  expect((await tool(c,'post_journal_entry',{...q,expectedHash:j.hash})).error.code).toBe('APPROVAL_REQUIRED');
  const web=await browser(j),review=await (await call('/api/remote/guest-review',undefined,{Cookie:web.cookie})).json();
  expect(review.approval.status).toBe('pending');expect(review.identityMode).toBe('temporary_guest_not_verified_human');
  expect((await call('/api/remote/guest-review/open',{ticket:web.ticket})).status).toBe(400);
  for(const extra of [{Origin:'https://bad.example'},{'X-CSRF-Token':'forged'},{'Sec-Fetch-Site':'cross-site'}])
   expect((await call('/api/remote/guest-review/decision',{decision:'approved'},{Cookie:web.cookie,'X-CSRF-Token':web.csrf,...extra})).status).toBe(403);
  expect((await call('/api/remote/guest-review/decision',{decision:'approved',journalId:randomUUID()},{Cookie:web.cookie,'X-CSRF-Token':web.csrf})).status).toBe(400);
  // This is the test-owned human browser fixture; production approvals are never automated.
  expect((await call('/api/remote/guest-review/decision',{decision:'approved'},{Cookie:web.cookie,'X-CSRF-Token':web.csrf})).status).toBe(200);
  const posted=await tool(c,'post_journal_entry',{...q,expectedHash:j.hash});expect(posted.data.state).toBe('Posted');
  const trial=await tool(c,'get_trial_balance',{companyId:a.companyId,from:'2026-01-01',to:'2026-01-31'});
  expect(trial.ok).toBe(true);expect(trial.data.totalDebit).toBe(trial.data.totalCredit);expect(trial.data.totalDebit).not.toBe('0');
  expect((await call('/api/journals',undefined,{Cookie:web.cookie})).status).toBe(200);
  const client=await db.pool.connect();try{await client.query('BEGIN');await client.query('SET LOCAL ROLE authenticated');await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[a.writerId]);
   expect((await client.query("SELECT private.has_company_scope($1,'accounting:approve') allowed",[a.companyId])).rows[0].allowed).toBe(false);
   expect((await client.query('SELECT count(*)::int AS n FROM public.business_transactions WHERE company_id=$1',[b.companyId])).rows[0].n).toBe(0);
  }finally{await client.query('ROLLBACK');client.release();}
 });
 it('respects reviewer scope revocation and guest expiration, including after a human decision',async()=>{
  const c=await connect(b.token),{j,q}=await draft(c,b.companyId),web=await browser(j);
  await call('/api/remote/guest-review/decision',{decision:'approved'},{Cookie:web.cookie,'X-CSRF-Token':web.csrf});
  await db.pool.query("DELETE FROM public.principal_scopes WHERE principal_id=$1 AND scope='accounting:approve'",[b.reviewerId]);
  expect((await tool(c,'post_journal_entry',{...q,expectedHash:j.hash})).error.code).toBe('APPROVAL_REQUIRED');
  await db.pool.query('UPDATE private.guest_workspaces SET expires_at=now()-interval \'1 second\',created_at=now()-interval \'1 day\' WHERE id=$1',[b.id]);
  expect((await call('/mcp',{},{Authorization:'Bearer '+b.token})).status).toBe(403);
  expect((await call('/api/remote/guest-review',undefined,{Cookie:web.cookie})).status).not.toBe(200);
 });
 it('claims an unchanged guest company only for a verified account and revokes old capabilities',async()=>{
  const fresh=await guest.provision({bootstrapKey:randomBytes(32).toString('base64url')}),user=randomUUID();
  await db.pool.query('INSERT INTO auth.users(id) VALUES($1)',[user]);await guest.claim(fresh.id,user);
  expect(await guest.byToken(fresh.token)).toBeUndefined();
  expect((await db.pool.query('SELECT company_id FROM private.remote_workspaces WHERE user_id=$1',[user])).rows[0].company_id).toBe(fresh.companyId);
  const second=await guest.provision({bootstrapKey:randomBytes(32).toString('base64url')});
  await expect(guest.claim(second.id,user)).rejects.toMatchObject({code:'WORKSPACE_CONFLICT'});
 });
});
