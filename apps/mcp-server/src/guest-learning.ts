import {createHmac,randomBytes,randomUUID} from 'node:crypto';
import type {Pool} from 'pg';
import {z} from 'zod';
import {DomainError,type Journal} from '@ledgerflow/contracts';
import {digest} from './remote-auth.js';
import {insertRemoteFoundation,tenantFixture} from './remote-workspace.js';
import {insertErpSubledgers} from '../../../scripts/seed-full-database.js';
import {remoteServices} from './remote-services.js';
import type {PublicDataClient} from '@ledgerflow/public-data';

export const GUEST_TTL_SECONDS=86400;
export const GUEST_COOKIE='__Host-lf_guest_review';
const secretSchema=z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
export type GuestWorkspace={id:string;companyId:string;writerId:string;reviewerId:string;expiresAt:string};
export type GuestBrowser={workspace:GuestWorkspace;token:string;journalId:string;version:number;hash:string;csrf:string};
const map=(row:Record<string,any>):GuestWorkspace=>({id:row.id,companyId:row.company_id,writerId:row.writer_id,reviewerId:row.reviewer_id,expiresAt:new Date(row.expires_at).toISOString()});
export const guestCookie=(token:string,clear=false)=>GUEST_COOKIE+'='+token+'; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age='+(clear?'0':'3600');

export class GuestLearning{
 constructor(readonly pool:Pool,readonly origin:string,private key:string,readonly publicData:PublicDataClient){}
 private mac(purpose:string,value:string){return createHmac('sha256',Buffer.from(this.key,'base64')).update(purpose+'\0'+value).digest('base64url');}
 async provision(input:unknown){
  const {bootstrapKey}=z.strictObject({bootstrapKey:secretSchema}).parse(input);
  const bootstrapHash=digest(bootstrapKey),token='lf_guest_'+this.mac('guest-mcp-v1',bootstrapKey),client=await this.pool.connect();
  try{
   await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='60s'");
   await client.query('SELECT pg_advisory_xact_lock(20261018,9)');
   const previous=(await client.query('SELECT * FROM private.guest_workspaces WHERE bootstrap_hash=$1',[bootstrapHash])).rows[0];
   if(previous){
    if(previous.revoked||previous.claimed_user_id||new Date(previous.expires_at).getTime()<=Date.now())throw new DomainError('GUEST_EXPIRED','새 임시 학습 세션이 필요합니다.');
    await client.query('COMMIT');return {...map(previous),token,mcpUrl:this.origin+'/mcp',reused:true};
   }
   // Bounded portfolio storage. Expiry revokes access; immutable posted/audit
   // records are not silently deleted, and no unattended cleanup job is added.
   if(Number((await client.query('SELECT count(*) AS n FROM private.guest_workspaces')).rows[0].n)>=20)
    throw new DomainError('GUEST_CAPACITY_REACHED','임시 학습 공간 정원이 찼습니다.');
   const id=randomUUID(),writerId=randomUUID(),reviewerId=randomUUID(),data=tenantFixture(id),companyId=data.companies[0]!.id;
   data.companies[0]!.name='한빛유통 주식회사';
   await insertRemoteFoundation(client,data);await insertErpSubledgers(client,data);
   for(const [actor,scopes] of [[writerId,['erp:read','accounting:write','accounting:close']],[reviewerId,['erp:read','accounting:approve']]] as const){
    await client.query('INSERT INTO private.execution_actors(id,company_id) VALUES($1,$2)',[actor,companyId]);
    await client.query("INSERT INTO public.principals(id,company_id,kind,service_subject) VALUES($1,$2,'service',$3)",[actor,companyId,'guest-learning/'+id+'/'+actor]);
    for(const scope of scopes)await client.query('INSERT INTO public.principal_scopes(company_id,principal_id,scope) VALUES($1,$2,$3)',[companyId,actor,scope]);
   }
   const row=(await client.query("INSERT INTO private.guest_workspaces(id,bootstrap_hash,access_hash,company_id,writer_id,reviewer_id,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval '24 hours') RETURNING *",
    [id,bootstrapHash,digest(token),companyId,writerId,reviewerId])).rows[0];
   await client.query('SET CONSTRAINTS ALL IMMEDIATE');await client.query('COMMIT');
   return {...map(row),token,mcpUrl:this.origin+'/mcp',reused:false};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
 async byToken(token:string):Promise<GuestWorkspace|undefined>{
  if(!/^lf_guest_[A-Za-z0-9_-]{43}$/u.test(token))return undefined;
  const row=(await this.pool.query('SELECT * FROM private.guest_workspaces WHERE access_hash=$1 AND NOT revoked AND claimed_user_id IS NULL AND expires_at>now()',[digest(token)])).rows[0];
  return row?map(row):undefined;
 }
 async byId(id:string):Promise<GuestWorkspace>{
  const row=(await this.pool.query('SELECT * FROM private.guest_workspaces WHERE id=$1 AND NOT revoked AND claimed_user_id IS NULL AND expires_at>now()',[id])).rows[0];
  if(!row)throw new DomainError('GUEST_EXPIRED','임시 학습 연결이 만료됐습니다.');return map(row);
 }
 services(workspace:GuestWorkspace,actor:'mcp'|'human'){
  const services=remoteServices(this.pool,{userId:workspace.reviewerId,companyId:workspace.companyId,writerId:workspace.writerId},actor,this.publicData);
  if(actor==='mcp')services.approvalLink=journal=>this.approvalLink(workspace,journal);
  return services;
 }
 async approvalLink(workspace:GuestWorkspace,journal:Journal){
  if(journal.companyId!==workspace.companyId||journal.state!=='Approval')throw new DomainError('FORBIDDEN','승인 대상이 아닙니다.');
  const ticket=randomBytes(32).toString('base64url');
  await this.pool.query("INSERT INTO private.guest_review_tickets(token_hash,guest_id,journal_id,version,content_hash,expires_at) VALUES($1,$2,$3,$4,$5,least($6::timestamptz,now()+interval '15 minutes'))",
   [digest(ticket),workspace.id,journal.id,journal.version,journal.hash,workspace.expiresAt]);
  // Fragment credentials do not enter request URLs, access logs or Referer.
  return this.origin+'/guest/approval/#ticket='+ticket;
 }
 async openReview(input:unknown){
  const {ticket}=z.strictObject({ticket:secretSchema}).parse(input);
  const row=(await this.pool.query('DELETE FROM private.guest_review_tickets WHERE token_hash=$1 AND expires_at>now() RETURNING *',[digest(ticket)])).rows[0];
  if(!row)throw new DomainError('REVIEW_LINK_EXPIRED','승인 링크를 다시 요청하세요.');
  const workspace=await this.byId(row.guest_id),service=this.services(workspace,'human').accounting!;
  const journal=await service.get({companyId:workspace.companyId,journalId:row.journal_id});
  if(journal.hash!==row.content_hash||journal.version!==row.version||journal.state!=='Approval')throw new DomainError('REVIEW_CHANGED','현재 전표의 승인 링크를 다시 요청하세요.');
  const token=randomBytes(32).toString('hex'),csrf=this.mac('guest-web-csrf-v1',token);
  await this.pool.query("INSERT INTO private.guest_browser_sessions(token_hash,guest_id,journal_id,version,content_hash,csrf_hash,expires_at) VALUES($1,$2,$3,$4,$5,$6,least($7::timestamptz,now()+interval '1 hour'))",
   [digest(token),workspace.id,journal.id,journal.version,journal.hash,digest(csrf),workspace.expiresAt]);
  return {token,csrf};
 }
 async browser(request:Request):Promise<GuestBrowser|undefined>{
  const token=request.headers.get('cookie')?.match(/(?:^|;\s*)__Host-lf_guest_review=([a-f0-9]{64})(?:;|$)/u)?.[1];
  if(!token)return undefined;
  const row=(await this.pool.query('SELECT * FROM private.guest_browser_sessions WHERE token_hash=$1 AND expires_at>now()',[digest(token)])).rows[0];
  if(!row)throw new DomainError('GUEST_EXPIRED','승인 링크를 다시 요청하세요.');
  return {workspace:await this.byId(row.guest_id),token,journalId:row.journal_id,version:row.version,hash:row.content_hash,csrf:this.mac('guest-web-csrf-v1',token)};
 }
 csrf(request:Request,browser:GuestBrowser){
  if(request.headers.get('origin')!==this.origin||request.headers.get('sec-fetch-site')!=='same-origin'||digest(request.headers.get('x-csrf-token')??'')!==digest(browser.csrf))
   throw new DomainError('FORBIDDEN','동일 사이트의 승인 화면에서 직접 결정하세요.');
 }
 async review(browser:GuestBrowser){
  const service=this.services(browser.workspace,'human').accounting!,q={companyId:browser.workspace.companyId,journalId:browser.journalId};
  const journal=await service.get(q);
  if(journal.hash!==browser.hash||journal.version!==browser.version)throw new DomainError('REVIEW_CHANGED','전표 내용이 변경됐습니다.');
  const accounts=(await this.pool.query('SELECT code,name FROM public.accounts WHERE company_id=$1',[q.companyId])).rows;
  return {journal,accounts:Object.fromEntries(accounts.map(row=>[row.code,row.name])),approval:await service.approval(q),documents:await service.documents({companyId:q.companyId,transactionId:journal.payload.transactionId}),csrf:browser.csrf,expiresAt:browser.workspace.expiresAt,identityMode:'temporary_guest_not_verified_human'};
 }
 async decide(browser:GuestBrowser,input:unknown){
  const {decision}=z.strictObject({decision:z.enum(['approved','rejected'])}).parse(input);
  await this.review(browser);
  return this.services(browser.workspace,'human').accounting!.decide({companyId:browser.workspace.companyId,journalId:browser.journalId,expectedHash:browser.hash,decision});
 }
 async claim(guestId:string,verifiedUserId:string){
  const client=await this.pool.connect();
  try{
   await client.query('BEGIN');await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['remote-workspace/'+verifiedUserId]);
   const guest=(await client.query('SELECT * FROM private.guest_workspaces WHERE id=$1 AND NOT revoked AND claimed_user_id IS NULL AND expires_at>now() FOR UPDATE',[guestId])).rows[0];
   if(!guest)throw new DomainError('GUEST_EXPIRED','임시 장부가 만료됐습니다.');
   if((await client.query('SELECT 1 FROM private.remote_workspaces WHERE user_id=$1',[verifiedUserId])).rowCount)throw new DomainError('WORKSPACE_CONFLICT','이미 보관 중인 개인 장부가 있어 자동으로 합치지 않았습니다.');
   await client.query('SELECT pg_advisory_xact_lock(20261017,1000)');
   if(Number((await client.query('SELECT count(*) AS n FROM private.remote_workspaces')).rows[0].n)>=25)throw new DomainError('WORKSPACE_CAPACITY_REACHED','보관할 수 있는 학습 계정 정원이 찼습니다.');
   if((await client.query("SELECT 1 FROM public.approval_requests a JOIN public.journal_entries j ON j.id=a.journal_id WHERE a.company_id=$1 AND a.status='approved' AND j.state<>'Posted'",[guest.company_id])).rowCount)
    throw new DomainError('GUEST_PENDING_POSTING','승인한 전표의 장부 반영을 먼저 마쳐 주세요.');
   await client.query("INSERT INTO public.company_memberships(company_id,user_id,role) VALUES($1,$2,'admin')",[guest.company_id,verifiedUserId]);
   const principal=randomUUID();await client.query("INSERT INTO public.principals(id,company_id,kind,user_id) VALUES($1,$2,'human',$3)",[principal,guest.company_id,verifiedUserId]);
   for(const scope of ['erp:read','accounting:approve','accounting:close'])await client.query('INSERT INTO public.principal_scopes(company_id,principal_id,scope) VALUES($1,$2,$3)',[guest.company_id,principal,scope]);
   await client.query('INSERT INTO private.remote_workspaces(user_id,company_id,writer_id) VALUES($1,$2,$3)',[verifiedUserId,guest.company_id,guest.writer_id]);
   await client.query('UPDATE private.guest_workspaces SET claimed_user_id=$2 WHERE id=$1',[guest.id,verifiedUserId]);
   await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
}
