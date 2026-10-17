import {createHash,randomBytes,createCipheriv,createDecipheriv,timingSafeEqual} from 'node:crypto';
import type {Pool} from 'pg';
import {z} from 'zod';
import {DomainError,uuidSchema} from '@ledgerflow/contracts';

export const digest=(v:string)=>createHash('sha256').update(v).digest('hex');
const secret=()=>randomBytes(32).toString('base64url');
const secureEqual=(a:string,b:string)=>timingSafeEqual(Buffer.from(digest(a),'hex'),Buffer.from(digest(b),'hex'));
const sessionSchema=z.object({userId:uuidSchema,email:z.string(),accessToken:z.string(),refreshToken:z.string(),csrf:z.string()});
export type BrowserIdentity=z.infer<typeof sessionSchema>;
export function sealSession(value:BrowserIdentity,key:string,binding=''){
  const bytes=Buffer.from(key,'base64');if(bytes.length!==32)throw new Error('REMOTE_KEY_INVALID');
  const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',bytes,iv);
  cipher.setAAD(Buffer.from('ledgerflow-remote-browser-v1/'+binding));
  return Buffer.concat([iv,cipher.update(JSON.stringify(value)),cipher.final(),cipher.getAuthTag()]).toString('base64');
}
export function openSession(value:string,key:string,binding=''):BrowserIdentity{
  const bytes=Buffer.from(value,'base64'),decipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'base64'),bytes.subarray(0,12));
  decipher.setAAD(Buffer.from('ledgerflow-remote-browser-v1/'+binding));decipher.setAuthTag(bytes.subarray(-16));
  return sessionSchema.parse(JSON.parse(Buffer.concat([decipher.update(bytes.subarray(12,-16)),decipher.final()]).toString('utf8')));
}
export interface RemoteAuthConfiguration {origin:string;supabaseUrl:string;publishableKey:string;encryptionKey:string;}
export class RemoteAuth {
  constructor(readonly pool:Pool,readonly config:RemoteAuthConfiguration,private fetcher:typeof fetch=fetch){}
  async provider(path:string,body?:unknown,accessToken?:string){
    // Workerd's native fetch must not receive this RemoteAuth as its receiver.
    const fetcher=this.fetcher;
    const response=await fetcher(this.config.supabaseUrl+'/auth/v1/'+path,{method:body?'POST':'GET',
      headers:{apikey:this.config.publishableKey,'Content-Type':'application/json',...(accessToken?{Authorization:'Bearer '+accessToken}:{})},
      ...(body?{body:JSON.stringify(body)}:{}),redirect:'manual',signal:AbortSignal.timeout(8000)});
    if(!response.ok)throw new DomainError('AUTH_FAILED','인증 정보와 연결 설정을 확인하세요.');
    return await response.json() as Record<string,unknown>;
  }
  async verify(accessToken:string,requireGoogle=false){
    const user=await this.provider('user',undefined,accessToken);
    if(!user.email_confirmed_at||user.is_anonymous===true)throw new DomainError('EMAIL_VERIFICATION_REQUIRED','이메일 인증이 필요합니다.');
    if(requireGoogle&&(!Array.isArray(user.identities)||!user.identities.some(identity=>identity?.provider==='google')))
      throw new DomainError('AUTH_FAILED','Google 신원을 확인하지 못했습니다.');
    return {userId:uuidSchema.parse(user.id),email:z.string().parse(user.email)};
  }
  async createBrowserSession(tokens:Record<string,unknown>,requireGoogle=false){
    const accessToken=z.string().parse(tokens.access_token),refreshToken=z.string().parse(tokens.refresh_token);
    const identity=await this.verify(accessToken,requireGoogle);
    const session={...identity,accessToken,refreshToken,csrf:secret()},token=randomBytes(32).toString('hex');
    await this.pool.query('INSERT INTO private.remote_browser_sessions(token_hash,user_id,encrypted_session,expires_at) VALUES($1,$2,$3,now()+interval \'7 days\')',
      [digest(token),identity.userId,sealSession(session,this.config.encryptionKey,digest(token))]);
    return {token,session};
  }
  cookie(request:Request){return request.headers.get('cookie')?.match(/(?:^|;\s*)lf_remote=([a-f0-9]{64})(?:;|$)/u)?.[1];}
  async browser(request:Request):Promise<BrowserIdentity|undefined>{
    const token=this.cookie(request);if(!token)return undefined;
    const row=(await this.pool.query('SELECT encrypted_session FROM private.remote_browser_sessions WHERE token_hash=$1 AND expires_at>now()',[digest(token)])).rows[0];
    if(!row)throw new DomainError('UNAUTHENTICATED','다시 로그인하세요.');
    let session=openSession(row.encrypted_session,this.config.encryptionKey,digest(token));
    try{const verified=await this.verify(session.accessToken);if(verified.userId!==session.userId)throw new Error('IDENTITY_MISMATCH');}
    catch{
      // Serialize refresh rotation across requests without sharing provider tokens.
      const client=await this.pool.connect();
      try{
        await client.query('BEGIN');
        const locked=(await client.query('SELECT encrypted_session FROM private.remote_browser_sessions WHERE token_hash=$1 AND expires_at>now() FOR UPDATE',[digest(token)])).rows[0];
        if(!locked)throw new Error('SESSION_EXPIRED');session=openSession(locked.encrypted_session,this.config.encryptionKey,digest(token));
        const refreshed=await this.provider('token?grant_type=refresh_token',{refresh_token:session.refreshToken});
        session={...session,accessToken:z.string().parse(refreshed.access_token),refreshToken:z.string().parse(refreshed.refresh_token)};
        if((await this.verify(session.accessToken)).userId!==session.userId)throw new Error('IDENTITY_MISMATCH');
        await client.query('UPDATE private.remote_browser_sessions SET encrypted_session=$2 WHERE token_hash=$1',[digest(token),sealSession(session,this.config.encryptionKey,digest(token))]);
        await client.query('COMMIT');
      }catch{await client.query('ROLLBACK');await this.pool.query('DELETE FROM private.remote_browser_sessions WHERE token_hash=$1',[digest(token)]);throw new DomainError('UNAUTHENTICATED','다시 로그인하세요.');}
      finally{client.release();}
    }
    return session;
  }
  csrf(request:Request,identity:BrowserIdentity){
    if(request.headers.get('origin')!==this.config.origin||!secureEqual(request.headers.get('x-csrf-token')??'',identity.csrf))
      throw new DomainError('FORBIDDEN','같은 사이트에서 명시적으로 요청하세요.');
  }
  async register(input:unknown){
    const q=z.object({client_name:z.string().min(1).max(100).default('MCP client'),redirect_uris:z.array(z.string().max(2048)).min(1).max(5),
      token_endpoint_auth_method:z.literal('none').optional(),grant_types:z.array(z.enum(['authorization_code','refresh_token'])).optional(),response_types:z.array(z.literal('code')).optional()}).parse(input);
    for(const uri of q.redirect_uris){const u=new URL(uri);if(u.username||u.password||u.hash||
      !(u.protocol==='https:'||u.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(u.hostname)))throw new Error('REDIRECT_URI_INVALID');}
    const id=secret();await this.pool.query('INSERT INTO private.remote_oauth_clients(id,name,redirect_uris) VALUES($1,$2,$3)',[id,q.client_name,JSON.stringify(q.redirect_uris)]);
    return {client_id:id,client_name:q.client_name,redirect_uris:q.redirect_uris,token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']};
  }
  async authorization(url:URL){
    const q=z.object({response_type:z.literal('code'),client_id:z.string().max(200),redirect_uri:z.string().max(2048),
      code_challenge:z.string().regex(/^[A-Za-z0-9_-]{43}$/u),code_challenge_method:z.literal('S256'),state:z.string().min(1).max(2048),
      resource:z.literal(this.config.origin+'/mcp'),scope:z.literal('ledgerflow').default('ledgerflow')}).parse(Object.fromEntries(url.searchParams));
    // Reject ambiguous duplicate OAuth parameters.
    for(const key of Object.keys(q))if(url.searchParams.getAll(key).length>1)throw new Error('OAUTH_PARAMETER_DUPLICATED');
    const client=(await this.pool.query('SELECT name,redirect_uris FROM private.remote_oauth_clients WHERE id=$1',[q.client_id])).rows[0];
    if(!client||!client.redirect_uris.includes(q.redirect_uri))throw new Error('OAUTH_CLIENT_INVALID');
    return {request:q,clientName:String(client.name)};
  }
  async consent(url:URL,userId:string){
    const {request:q}=await this.authorization(url),code=secret();
    await this.pool.query('INSERT INTO private.remote_oauth_codes(code_hash,client_id,user_id,redirect_uri,challenge,resource,expires_at) VALUES($1,$2,$3,$4,$5,$6,now()+interval \'5 minutes\')',
      [digest(code),q.client_id,userId,q.redirect_uri,q.code_challenge,q.resource]);
    const redirect=new URL(q.redirect_uri);redirect.searchParams.set('code',code);redirect.searchParams.set('state',q.state);redirect.searchParams.set('iss',this.config.origin);
    return redirect.href;
  }
  async exchange(input:URLSearchParams){
    const type=input.get('grant_type'),clientId=input.get('client_id'),resource=input.get('resource');
    if(resource!==this.config.origin+'/mcp')throw new Error('RESOURCE_MISMATCH');
    const client=await this.pool.connect();
    try{
      await client.query('BEGIN');let userId:string;
      if(type==='authorization_code'){
        const verifier=input.get('code_verifier')??'';if(!/^[A-Za-z0-9._~-]{43,128}$/u.test(verifier))throw new Error('PKCE_REQUIRED');
        const code=(await client.query('DELETE FROM private.remote_oauth_codes WHERE code_hash=$1 AND expires_at>now() RETURNING *',[digest(input.get('code')??'')])).rows[0];
        if(!code||code.client_id!==clientId||code.redirect_uri!==input.get('redirect_uri')||code.resource!==resource||
          !secureEqual(code.challenge,createHash('sha256').update(verifier).digest('base64url')))throw new Error('CODE_INVALID');
        userId=code.user_id;
      }else if(type==='refresh_token'){
        const previous=(await client.query('UPDATE private.remote_oauth_grants SET revoked=true WHERE refresh_hash=$1 AND client_id=$2 AND resource=$3 AND NOT revoked AND refresh_expires_at>now() RETURNING user_id',
          [digest(input.get('refresh_token')??''),clientId,resource])).rows[0];
        if(!previous)throw new Error('REFRESH_INVALID');userId=previous.user_id;
      }else throw new Error('GRANT_INVALID');
      const access=secret(),refresh=secret();
      await client.query('INSERT INTO private.remote_oauth_grants(client_id,user_id,resource,access_hash,refresh_hash,expires_at,refresh_expires_at) VALUES($1,$2,$3,$4,$5,now()+interval \'1 hour\',now()+interval \'30 days\')',
        [clientId,userId,resource,digest(access),digest(refresh)]);
      await client.query('COMMIT');return {access_token:access,refresh_token:refresh,token_type:'Bearer',expires_in:3600,scope:'ledgerflow'};
    }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  }
  async bearer(request:Request){
    const token=request.headers.get('authorization')?.match(/^Bearer ([A-Za-z0-9_-]{43})$/u)?.[1];if(!token)return undefined;
    const row=(await this.pool.query('SELECT user_id FROM private.remote_oauth_grants WHERE access_hash=$1 AND resource=$2 AND NOT revoked AND expires_at>now()',[digest(token),this.config.origin+'/mcp'])).rows[0];
    return row?uuidSchema.parse(row.user_id):undefined;
  }
}
