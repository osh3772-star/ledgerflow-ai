import {afterAll,beforeAll,describe,it,expect} from 'vitest';
import {randomBytes,randomUUID} from 'node:crypto';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {PublicDataService} from '@ledgerflow/public-data';
import {startLocalPostgres} from '../../scripts/local-postgres.js';
import {createRemoteRouter} from '../../apps/mcp-server/src/remote-router.js';
import {GuestLearning} from '../../apps/mcp-server/src/guest-learning.js';
import {verifyLearningMcp} from '../../scripts/learning-in-place.js';
import {collectLearningBundle} from '../../scripts/build-learning-bundle.js';

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
  const bundle=(await collectLearningBundle()).bundle;
  router=createRemoteRouter({pool:db.pool,publicData,auth:{origin,encryptionKey:key,supabaseUrl:'https://auth.example',publishableKey:'test'},
   authFetch:async()=>Response.json({external:{google:true}}),assets:{fetch:async request=>new URL(request.url).pathname==='/learning-bundle.json'?Response.json(bundle):new Response('test')}});
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
  await guest.claim(second.id,user);
  expect((await db.pool.query('SELECT company_id FROM private.remote_workspaces WHERE user_id=$1',[user])).rows[0].company_id).toBe(second.companyId);
  expect((await db.pool.query('SELECT count(*)::int AS n FROM public.business_transactions WHERE company_id=$1',[fresh.companyId])).rows[0].n).toBe(1000);
 });
 it('prepares the first sale with exactly three calls, records once, and never approves or posts',async()=>{
  const fresh=await guest.provision({bootstrapKey:randomBytes(32).toString('base64url')}),c=await connect(fresh.token);
  const s=await tool(c,'get_system_status'),ctx=await tool(c,'get_company_context');
  expect(s.ok&&ctx.ok).toBe(true);
  const input={companyId:ctx.data.companyId,idempotencyKey:'first-sale-january',firstSale:{from:'2026-01-01',to:'2026-01-31'},validateAndRequestApproval:true,client:'antigravity'};
  const prepared=await tool(c,'propose_journal_entry',input);
  expect(prepared.ok).toBe(true);expect(prepared.data).toMatchObject({state:'Approval',preparation:{validation:'passed',approvalStatus:'pending',humanApprovalRequired:true,journalPosted:false,roleResult:{recorded:true}}});
  expect(prepared.data.approvalUrl).toContain('/guest/approval/#ticket=');expect(prepared.data.preparation.documents.length).toBeGreaterThan(0);
  const repeated=await Promise.all([tool(c,'propose_journal_entry',input),tool(c,'propose_journal_entry',input)]);
  expect(repeated.every(r=>r.ok&&r.data.id===prepared.data.id&&r.data.hash===prepared.data.hash)).toBe(true);
  const counts=(await db.pool.query(`SELECT (SELECT count(*)::int FROM public.journal_entries WHERE company_id=$1) journals,
    (SELECT count(*)::int FROM public.agent_tasks WHERE company_id=$1) tasks,
    (SELECT count(*)::int FROM public.approval_requests WHERE company_id=$1 AND status='pending') pending,
    (SELECT count(*)::int FROM public.journal_entries WHERE company_id=$1 AND state='Posted') posted`,[fresh.companyId])).rows[0];
  expect(counts).toEqual({journals:1,tasks:1,pending:1,posted:0});
  expect((await tool(c,'post_journal_entry',{companyId:fresh.companyId,journalId:prepared.data.id,expectedHash:prepared.data.hash})).error.code).toBe('APPROVAL_REQUIRED');
  expect((await tool(c,'propose_journal_entry',{...input,companyId:a.companyId})).error.code).toBe('FORBIDDEN');
  expect((await tool(c,'propose_journal_entry',{...input,idempotencyKey:'missing-sale',firstSale:{from:'2028-01-01',to:'2028-01-31'}})).error.code).toBe('NO_UNPROCESSED_SALE');
 });
 it('bootstraps a workspace plugin by one GET, uses a path credential, and rejects mixed identities',async()=>{
  const response=await call('/api/remote/bootstrap?client=antigravity&requestId='+randomUUID());expect(response.status).toBe(200);
  expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('referrer-policy')).toBe('no-referrer');
  const result=await response.json(),path='.agents/plugins/ledgerflow-learning/mcp_config.json';
  const config=JSON.parse(result.files[path]),url=config.mcpServers['ledgerflow-accounting-mcp'].serverUrl;
  expect(Object.keys(result.files).every(p=>!p.startsWith('/')&&!p.includes('..')&&!p.includes('~'))).toBe(true);
  expect(result.files['AGENTS.md']).toContain('외부 스키마 대신');expect(result.files['GEMINI.md']).toContain('view_file로 읽지 않는다');
  expect(JSON.parse(result.files['.ledgerflow/guest-session.json'])).toMatchObject({mode:'guest',companyId:result.companyId});
  expect(result.sensitivePaths).toContain('.ledgerflow/guest-session.json');
  expect(JSON.parse(result.files['docs/MCP_CATALOG.json']).tools.find((t:any)=>t.name==='propose_journal_entry').inputSchema.properties.validateAndRequestApproval).toBeDefined();
  const c=new Client({name:'workspace-path-client',version:'1'});clients.push(c);
  await c.connect(new StreamableHTTPClientTransport(new URL(url),{fetch:fetcher}));
  expect((await tool(c,'get_system_status')).ok).toBe(true);expect((await tool(c,'get_company_context')).data.companyId).toBe(result.companyId);
  expect((await fetcher(url,{method:'POST',headers:{Authorization:'Bearer '+a.token,'Content-Type':'application/json'},body:'{}'})).status).toBe(403);
  expect((await call('/mcp/g/lf_guest_'+'z'.repeat(43),{})).status).toBe(403);
  expect((await call('/mcp/g/bad',{})).status).toBe(400);
  expect((await call('/api/remote/bootstrap?client=antigravity&requestId='+randomUUID(),undefined,{Purpose:'prefetch'})).status).toBe(400);
 });
 it('concurrent first requests share one immutable journal and one mechanical result',async()=>{
  const fresh=await guest.provision({bootstrapKey:randomBytes(32).toString('base64url')}),c=await connect(fresh.token);
  await tool(c,'get_system_status');await tool(c,'get_company_context');
  const input={companyId:fresh.companyId,idempotencyKey:'concurrent-first-sale',firstSale:{from:'2026-01-01',to:'2026-01-31'},validateAndRequestApproval:true,client:'codex'};
  const results=await Promise.all([tool(c,'propose_journal_entry',input),tool(c,'propose_journal_entry',input)]);
  expect(results.every(r=>r.ok)).toBe(true);expect(results[0].data.id).toBe(results[1].data.id);expect(results[0].data.hash).toBe(results[1].data.hash);
  const counts=(await db.pool.query('SELECT (SELECT count(*)::int FROM public.journal_entries WHERE company_id=$1) journals,(SELECT count(*)::int FROM public.agent_tasks WHERE company_id=$1) tasks',[fresh.companyId])).rows[0];
  expect(counts).toEqual({journals:1,tasks:1});
 });
 it('does not mislabel a non-sale composite proposal as a sales-role result',async()=>{
  const fresh=await guest.provision({bootstrapKey:randomBytes(32).toString('base64url')}),c=await connect(fresh.token);
  await tool(c,'get_system_status');await tool(c,'get_company_context');
  const transaction=(await tool(c,'get_transactions',{companyId:fresh.companyId,from:'2026-01-01',to:'2026-01-31',kind:'purchase'})).data.items[0];
  const result=await tool(c,'propose_journal_entry',{companyId:fresh.companyId,transactionId:transaction.id,idempotencyKey:'purchase-composite',validateAndRequestApproval:true,client:'codex'});
  expect(result.ok).toBe(true);expect(result.data.state).toBe('Approval');expect(result.data.preparation.roleResult).toBeNull();
  expect((await db.pool.query('SELECT count(*)::int n FROM public.agent_tasks WHERE company_id=$1',[fresh.companyId])).rows[0].n).toBe(0);
 });
});
