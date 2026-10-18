import {createHash,randomBytes,createCipheriv,createDecipheriv} from 'node:crypto';
import {z} from 'zod';
import {DomainError} from '@ledgerflow/contracts';
import {RemoteAuth,digest} from './remote-auth.js';

const flowSchema=z.strictObject({verifier:z.string().regex(/^[A-Za-z0-9_-]{43}$/u),returnTo:z.string().max(10000),claimGuestId:z.uuid().optional()});
export const GOOGLE_FLOW_COOKIE='__Host-lf_google';
export const googleCookie=(value:string,clear=false)=>GOOGLE_FLOW_COOKIE+'='+value+'; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age='+(clear?'0':'600');
export function googleReturnTo(value:string,origin:string){
  const url=new URL(value,origin);
  if(!value.startsWith('/')||value.startsWith('//')||value.includes('\\')||url.origin!==origin||url.hash||
    !(url.pathname==='/'&&!url.search||url.pathname==='/oauth/authorize'&&url.search))
    throw new DomainError('FORBIDDEN','돌아갈 주소를 확인하세요.');
  return url.pathname+url.search;
}
export class RemoteGoogleAuth {
  constructor(private auth:RemoteAuth){}
  async configuration(){
    try{const data=await this.auth.provider('settings');
      return {enabled:(data.external as {google?:unknown}|undefined)?.google===true,checked:true};
    }catch{return {enabled:false,checked:false};}
  }
  private seal(value:z.infer<typeof flowSchema>,binding:string){
    const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(this.auth.config.encryptionKey,'base64'),iv);
    cipher.setAAD(Buffer.from(this.auth.config.origin+'/google-pkce-v1/'+binding));
    // Match browser-session encryption on Node and Cloudflare Workerd.
    return Buffer.concat([iv,cipher.update(Buffer.from(JSON.stringify(value),'utf8')),cipher.final(),cipher.getAuthTag()]).toString('base64');
  }
  private open(value:string,binding:string){
    const bytes=Buffer.from(value,'base64'),decipher=createDecipheriv('aes-256-gcm',Buffer.from(this.auth.config.encryptionKey,'base64'),bytes.subarray(0,12));
    decipher.setAAD(Buffer.from(this.auth.config.origin+'/google-pkce-v1/'+binding));decipher.setAuthTag(bytes.subarray(-16));
    return flowSchema.parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString('utf8')));
  }
  async begin(input:unknown,claimGuestId?:string){
    const q=z.strictObject({returnTo:z.string().max(10000).default('/')}).parse(input);
    const returnTo=googleReturnTo(q.returnTo,this.auth.config.origin);
    if(returnTo!=='/')await this.auth.authorization(new URL(returnTo,this.auth.config.origin));
    const configured=await this.configuration();
    if(!configured.checked)throw new DomainError('GOOGLE_PROVIDER_UNAVAILABLE','Google 로그인 설정을 확인하지 못했습니다.');
    if(!configured.enabled)throw new DomainError('GOOGLE_PROVIDER_NOT_CONFIGURED','운영자의 Google 연결 설정이 필요합니다.');
    const token=randomBytes(32).toString('hex'),verifier=randomBytes(32).toString('base64url'),binding=digest(token);
    await this.auth.pool.query('DELETE FROM private.remote_login_flows WHERE expires_at<=now()');
    await this.auth.pool.query('INSERT INTO private.remote_login_flows(token_hash,encrypted_flow,expires_at) VALUES($1,$2,now()+interval \'10 minutes\')',
      [binding,this.seal({verifier,returnTo,...(claimGuestId?{claimGuestId}: {})},binding)]);
    const redirect=new URL(this.auth.config.supabaseUrl+'/auth/v1/authorize');
    redirect.search=new URLSearchParams({provider:'google',redirect_to:this.auth.config.origin+'/api/remote/google/callback',
      code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'s256',scopes:'openid email profile'}).toString();
    return {redirect:redirect.href,token};
  }
  async finish(request:Request){
    const token=request.headers.get('cookie')?.match(/(?:^|;\s*)__Host-lf_google=([a-f0-9]{64})(?:;|$)/u)?.[1];
    if(!token)throw new DomainError('AUTH_FAILED','같은 브라우저에서 로그인을 다시 시작하세요.');
    const binding=digest(token);
    const row=(await this.auth.pool.query('DELETE FROM private.remote_login_flows WHERE token_hash=$1 AND expires_at>now() RETURNING encrypted_flow',[binding])).rows[0];
    if(!row)throw new DomainError('AUTH_FAILED','로그인을 다시 시작하세요.');
    const flow=this.open(row.encrypted_flow,binding),url=new URL(request.url);
    if(url.searchParams.has('error')||url.searchParams.getAll('code').length!==1)throw new DomainError('AUTH_FAILED','Google 로그인을 완료하지 못했습니다.');
    const code=z.string().min(1).max(4096).parse(url.searchParams.get('code'));
    const tokens=await this.auth.provider('token?grant_type=pkce',{auth_code:code,code_verifier:flow.verifier});
    const session=await this.auth.createBrowserSession(tokens,true);
    return {...session,returnTo:googleReturnTo(flow.returnTo,this.auth.config.origin),...(flow.claimGuestId?{claimGuestId:flow.claimGuestId}:{})};
  }
}
