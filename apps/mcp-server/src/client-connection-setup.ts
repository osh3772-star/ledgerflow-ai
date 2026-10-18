import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import type {Pool} from 'pg';
import {z} from 'zod';
import {DomainError} from '@ledgerflow/contracts';
import {digest} from './remote-auth.js';

export const workspacePathSchema=z.string().min(1).max(2048)
 .refine(p=>!/[\x00-\x1f]/u.test(p)&&(/^[A-Za-z]:[\\/]/u.test(p)||p.startsWith('/')&&!p.startsWith('//')),'Absolute workspace path required');
const tokenSchema=z.string().regex(/^lf_(?:guest|personal)_[A-Za-z0-9_-]{43}$/u);
const payloadSchema=z.strictObject({token:tokenSchema,workspacePath:workspacePathSchema.optional()});
type Resolved={companyId:string;userId?:string};
export const setupCookie=(value:string)=>'__Host-lf_setup='+value+'; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=1800';

// This is an encrypted, one-use human setup handoff, never a journal approval.
// The capability is the very same credential issued by bootstrap; no new company.
export class ClientConnectionSetup {
 constructor(private pool:Pool,private origin:string,private key:string,private resolve:(token:string)=>Promise<Resolved|undefined>){}
 private seal(value:z.infer<typeof payloadSchema>,binding:string){
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(this.key,'base64'),iv);
  cipher.setAAD(Buffer.from(this.origin+'/codex-setup-v1/'+binding));
  return Buffer.concat([iv,cipher.update(Buffer.from(JSON.stringify(value),'utf8')),cipher.final(),cipher.getAuthTag()]).toString('base64');
 }
 private openPayload(value:string,binding:string){
  const data=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',Buffer.from(this.key,'base64'),data.subarray(0,12));
  cipher.setAAD(Buffer.from(this.origin+'/codex-setup-v1/'+binding));cipher.setAuthTag(data.subarray(-16));
  return payloadSchema.parse(JSON.parse(Buffer.concat([cipher.update(data.subarray(12,-16)),cipher.final()]).toString('utf8')));
 }
 async issue(input:unknown){
  const value=payloadSchema.parse(input),resolved=await this.resolve(value.token);
  if(!resolved)throw new DomainError('CONNECTION_EXPIRED','사이트에서 새 연결 요청문을 받으세요.');
  const ticket=randomBytes(32).toString('base64url'),binding=digest(ticket);
  await this.pool.query('DELETE FROM private.client_connection_setups WHERE expires_at<=now() AND (browser_expires_at IS NULL OR browser_expires_at<=now())');
  const row=(await this.pool.query(`INSERT INTO private.client_connection_setups(handoff_hash,company_id,owner_user_id,access_hash,encrypted_payload)
    VALUES($1,$2,$3,$4,$5) RETURNING expires_at`,[binding,resolved.companyId,resolved.userId??null,digest(value.token),this.seal(value,binding)])).rows[0];
  return {state:'native_connection_pending' as const,companyId:resolved.companyId,
   setupUrl:this.origin+'/connect/codex/#ticket='+ticket,expiresAt:new Date(row.expires_at).toISOString(),
   nativeClientVerified:false,action:'먼저 현재 폴더의 .ledgerflow/connect-codex.mjs로 자동 등록·실행 중 앱 재읽기를 시도한다. 수동 등록 메뉴를 찾게 하지 않는다. 이 링크는 사람용 상태/복구 화면이며 AI는 열지 않는다.'};
 }
 async exchange(input:unknown,userId?:string){
  const {ticket}=z.strictObject({ticket:z.string().regex(/^[A-Za-z0-9_-]{43}$/u)}).parse(input),binding=digest(ticket);
  const row=(await this.pool.query('SELECT * FROM private.client_connection_setups WHERE handoff_hash=$1 AND expires_at>now() AND opened_at IS NULL',[binding])).rows[0];
  if(!row)throw new DomainError('SETUP_LINK_EXPIRED','설치한 AI에게 Codex 연결 안내를 다시 요청하세요.');
  const value=await this.authorized(row,userId),browserToken=randomBytes(32).toString('hex');
  const updated=await this.pool.query(`UPDATE private.client_connection_setups SET opened_at=now(),browser_hash=$2,browser_expires_at=now()+interval '30 minutes'
    WHERE handoff_hash=$1 AND opened_at IS NULL AND expires_at>now() RETURNING handoff_hash`,[binding,digest(browserToken)]);
  if(!updated.rowCount)throw new DomainError('SETUP_LINK_EXPIRED','이 연결 안내는 이미 열렸습니다. 기존 브라우저에서 이어가세요.');
  return {browserToken,...this.view(row,value)};
 }
 async state(request:Request,userId?:string){
  const connectionId=z.string().regex(/^[a-f0-9]{64}$/u).parse(new URL(request.url).searchParams.get('connectionId'));
  const token=request.headers.get('cookie')?.match(/(?:^|;\s*)__Host-lf_setup=([a-f0-9]{64})(?:;|$)/u)?.[1];
  const row=token?(await this.pool.query('SELECT * FROM private.client_connection_setups WHERE browser_hash=$1 AND handoff_hash=$2 AND browser_expires_at>now()',[digest(token),connectionId])).rows[0]:undefined;
  if(!row)throw new DomainError('SETUP_LINK_EXPIRED','AI가 준 Codex 연결 마치기 링크를 열어 주세요.');
  return this.view(row,await this.authorized(row,userId));
 }
 private async authorized(row:Record<string,any>,userId?:string){
  if(row.owner_user_id&&!userId)throw new DomainError('UNAUTHENTICATED','이 연결을 만든 Google 계정으로 로그인하세요.');
  if(row.owner_user_id&&row.owner_user_id!==userId)throw new DomainError('FORBIDDEN','다른 계정의 연결 안내입니다.');
  const value=this.openPayload(row.encrypted_payload,row.handoff_hash),resolved=await this.resolve(value.token);
  if(!resolved||resolved.companyId!==row.company_id||row.owner_user_id&&resolved.userId!==row.owner_user_id)
   throw new DomainError('CONNECTION_EXPIRED','연결이 만료·취소되었거나 회사가 변경됐습니다. 새 연결 요청문을 받으세요.');
  return value;
 }
 private view(row:Record<string,any>,value:z.infer<typeof payloadSchema>){
  const verificationPrompt=`ledgerflow-accounting-mcp의 실제 MCP 도구 get_system_status({}) → get_company_context({})를 순서대로 호출해 줘. 기대 companyId는 ${row.company_id}야. 실제 성공 여부와 회사 ID 일치, 도구 수를 알려줘. 별도 SDK/터미널 검사로 대신하지 말고 분개·승인·장부 반영은 하지 마.`;
  const resume=new URL('codex://threads/new');resume.searchParams.set('prompt',verificationPrompt);
  if(value.workspacePath)resume.searchParams.set('path',value.workspacePath);
  return {connectionId:row.handoff_hash,companyId:row.company_id,server:'ledgerflow-accounting-mcp',
   mcpUrl:this.origin+'/mcp/'+(value.token.startsWith('lf_personal_')?'p/':'g/')+value.token,
   settingsUrl:'codex://settings',resumeUrl:value.workspacePath?resume.href:null,verificationPrompt,
   workspacePath:value.workspacePath??null,clientName:row.client_name??null,
   checks:{get_system_status:row.status_checked_at??null,get_company_context:row.context_checked_at??null},
   verified:Boolean(row.status_checked_at&&row.context_checked_at),
   evidence:'이 연결 키로 설치 이후 성공한 도구 호출의 서버 수신 기록입니다. 클라이언트 이름은 자체 신고이며 앱 신원 인증이 아닙니다. 설치기의 별도 SDK 검사는 제외됩니다.'};
 }
 async initialized(token:string,clientName:string){
  await this.pool.query('UPDATE private.client_connection_setups SET client_name=$2 WHERE access_hash=$1 AND (expires_at>now() OR browser_expires_at>now())',[digest(token),clientName.slice(0,100)]);
 }
 async received(token:string,tool:string){
  if(tool!=='get_system_status'&&tool!=='get_company_context')return;
  const column=tool==='get_system_status'?'status_checked_at':'context_checked_at';
  // Column is a source constant. No user-supplied identifier is interpolated.
  await this.pool.query('UPDATE private.client_connection_setups SET '+column+'=now() WHERE access_hash=$1 AND (expires_at>now() OR browser_expires_at>now())',[digest(token)]);
 }
}
