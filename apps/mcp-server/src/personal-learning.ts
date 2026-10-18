import {createHmac,randomBytes} from 'node:crypto';
import type {Pool} from 'pg';
import {z} from 'zod';
import {DomainError} from '@ledgerflow/contracts';
import {digest} from './remote-auth.js';
import {provisionWorkspace,type Workspace} from './remote-workspace.js';
import type {GuestLearning} from './guest-learning.js';

const secret=z.string().regex(/^[A-Za-z0-9_-]{43}$/u);
export class PersonalLearning {
 constructor(readonly pool:Pool,readonly origin:string,private key:string,readonly guest:GuestLearning){}
 async issue(userId:string){
  const workspace=await provisionWorkspace(this.pool,userId),claimCode=randomBytes(32).toString('base64url');
  const row=(await this.pool.query("INSERT INTO private.remote_setup_tickets(code_hash,user_id,company_id) VALUES($1,$2,$3) RETURNING expires_at",[digest(claimCode),userId,workspace.companyId])).rows[0];
  return {claimCode,companyId:workspace.companyId,expiresAt:new Date(row.expires_at).toISOString()};
 }
 async redeem(input:unknown){
  const {claimCode,bootstrapKey,guestToken,client:name}=z.strictObject({claimCode:secret,bootstrapKey:secret,guestToken:z.string().regex(/^lf_guest_[A-Za-z0-9_-]{43}$/u).optional(),client:z.enum(['codex','claude','antigravity'])}).parse(input);
  const client=await this.pool.connect();
  const token='lf_personal_'+createHmac('sha256',Buffer.from(this.key,'base64')).update('personal-learning-v1\0'+claimCode+'\0'+bootstrapKey).digest('base64url');
  try{
   await client.query('BEGIN');
   const ticket=(await client.query('SELECT * FROM private.remote_setup_tickets WHERE code_hash=$1 AND expires_at>now() FOR UPDATE',[digest(claimCode)])).rows[0];
   if(!ticket)throw new DomainError('CLAIM_CODE_EXPIRED','사이트에서 내 장부 연결 요청문을 다시 발급하세요.');
   if(ticket.redeemed_key_hash&&ticket.redeemed_key_hash!==digest(bootstrapKey))throw new DomainError('CLAIM_CODE_USED','이미 사용한 연결 코드입니다.');
   await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['remote-workspace/'+ticket.user_id]);
   let row=(await client.query('SELECT company_id,writer_id FROM private.remote_workspaces WHERE user_id=$1',[ticket.user_id])).rows[0];
   if(!row||(!ticket.redeemed_at&&row.company_id!==ticket.company_id))throw new DomainError('WORKSPACE_CHANGED','현재 장부의 연결 요청문을 다시 발급하세요.');
   if(!ticket.redeemed_at&&guestToken){
    const old=(await client.query('SELECT id,claimed_user_id FROM private.guest_workspaces WHERE access_hash=$1 AND (claimed_user_id=$2 OR (NOT revoked AND claimed_user_id IS NULL AND expires_at>now()))',[digest(guestToken),ticket.user_id])).rows[0];
    if(!old)throw new DomainError('GUEST_EXPIRED','이전 임시 연결을 확인하세요. 새 게스트 장부는 만들지 않았습니다.');
    if(!old.claimed_user_id)await this.guest.claim(old.id,ticket.user_id,client);
    row=(await client.query('SELECT company_id,writer_id FROM private.remote_workspaces WHERE user_id=$1',[ticket.user_id])).rows[0];
   }
   if(!ticket.redeemed_at){
    await client.query("INSERT INTO private.remote_learning_links(user_id,access_hash,name,expires_at) VALUES($1,$2,$3,now()+interval '7 days')",[ticket.user_id,digest(token),name]);
    await client.query('UPDATE private.remote_setup_tickets SET redeemed_key_hash=$2,redeemed_at=now() WHERE code_hash=$1',[digest(claimCode),digest(bootstrapKey)]);
   }
   const link=(await client.query('SELECT expires_at FROM private.remote_learning_links WHERE access_hash=$1 AND NOT revoked AND expires_at>now()',[digest(token)])).rows[0];
   if(!link)throw new DomainError('PERSONAL_LINK_EXPIRED','사이트에서 연결 요청문을 다시 발급하세요.');
   await client.query('COMMIT');return {token,mcpUrl:this.origin+'/mcp',companyId:row.company_id,expiresAt:new Date(link.expires_at).toISOString(),mode:'personal'};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 }
 async resolve(token:string):Promise<Workspace|undefined>{
  if(!/^lf_(?:personal|guest)_[A-Za-z0-9_-]{43}$/u.test(token))return undefined;
  const row=(await this.pool.query(`SELECT w.user_id,w.company_id,w.writer_id FROM private.remote_learning_links l
   JOIN private.remote_workspaces w ON w.user_id=l.user_id JOIN public.company_memberships m ON m.company_id=w.company_id AND m.user_id=w.user_id
   JOIN public.principals p ON p.company_id=w.company_id AND p.user_id=w.user_id AND p.kind='human' AND p.active
   WHERE l.access_hash=$1 AND NOT l.revoked AND l.expires_at>now() AND m.active AND (m.expires_at IS NULL OR m.expires_at>now())`,[digest(token)])).rows[0];
  return row?{userId:row.user_id,companyId:row.company_id,writerId:row.writer_id}:undefined;
 }
 async status(companyId:string,writerId:string){
  const last=(await this.pool.query('SELECT tool_name,outcome,created_at FROM public.mcp_tool_calls WHERE company_id=$1 ORDER BY created_at DESC LIMIT 1',[companyId])).rows[0];
  const journals=await this.pool.query('SELECT id,state,created_at FROM public.journal_entries WHERE company_id=$1 AND created_by=$2 ORDER BY created_at DESC LIMIT 5',[companyId,writerId]);
  return {companyId,lastMcpCall:last?{tool:last.tool_name,outcome:last.outcome,at:last.created_at}:null,aiPreparedJournals:journals.rows.map(j=>({id:j.id,state:j.state,at:j.created_at})),note:'최근 도구 호출 기록입니다. 앱의 현재 온라인 상태나 AI 검토 완료를 뜻하지 않습니다.'};
 }
}
