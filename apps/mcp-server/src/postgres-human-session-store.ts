import type {Pool} from 'pg';
import {DomainError,uuidSchema} from '@ledgerflow/contracts';
import {humanSessionCipher,sessionTokenHash,validateHumanSession,type HumanSession,type HumanSessionStore} from './human-session-store.js';

// Private server-only storage. No human-session SQL/RPC is exposed as an MCP tool.
export class PostgresHumanSessionStore implements HumanSessionStore{
  readonly kind='postgres' as const;
  private readonly cipher:ReturnType<typeof humanSessionCipher>;
  private readonly companyId:string;
  constructor(private readonly pool:Pool,companyId:string,encodedKey:string){
    this.companyId=uuidSchema.parse(companyId);this.cipher=humanSessionCipher(encodedKey,companyId);
  }
  async assertReady(){
    try{
      const result=await this.pool.query<{ready:boolean}>(
        "SELECT EXISTS(SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='private' AND c.relname='human_sessions' AND c.relrowsecurity AND c.relforcerowsecurity AND NOT has_table_privilege('anon',c.oid,'SELECT') AND NOT has_table_privilege('authenticated',c.oid,'SELECT') AND NOT has_table_privilege('anon',c.oid,'INSERT') AND NOT has_table_privilege('authenticated',c.oid,'INSERT')) AS ready");
      if(!result.rows[0]?.ready)throw new Error('missing');
      await this.pool.query('SELECT company_id,token_hash,nonce,ciphertext,auth_tag,expires_at FROM private.human_sessions LIMIT 0');
    }catch{throw new DomainError('SESSION_SCHEMA_INCOMPLETE','세션 저장을 선택한 개발 DB에 migration 006과 서버 DB 역할 권한을 먼저 준비하세요.');}
  }
  async get(token:string):Promise<HumanSession|undefined>{
    if(!/^[a-f0-9]{64}$/u.test(token))return undefined;
    try{
      const hash=sessionTokenHash(token),result=await this.pool.query<{nonce:Buffer;ciphertext:Buffer;auth_tag:Buffer;expires_at:Date}>(
        'SELECT nonce,ciphertext,auth_tag,expires_at FROM private.human_sessions WHERE company_id=$1 AND token_hash=$2 AND expires_at>now()',
        [this.companyId,hash]);
      const row=result.rows[0];if(!row)return undefined;
      const value=this.cipher.open(hash,{nonce:row.nonce,ciphertext:row.ciphertext,authTag:row.auth_tag});
      if(!value?.accessToken||value.expires<=Date.now())return undefined;
      return {...value,expires:Math.min(value.expires,row.expires_at.getTime())};
    }catch{throw new DomainError('SESSION_STORE_UNAVAILABLE','세션 저장소 연결을 확인하세요.');}
  }
  async put(token:string,session:HumanSession){
    const value=validateHumanSession(token,session);
    if(!value.accessToken)throw new DomainError('INVALID_SESSION','외부 인증 세션이 필요합니다.');
    const hash=sessionTokenHash(token),sealed=this.cipher.seal(hash,value);
    try{
      await this.pool.query(
        "WITH expired AS (DELETE FROM private.human_sessions WHERE company_id=$1 AND expires_at<=now()) INSERT INTO private.human_sessions(company_id,token_hash,nonce,ciphertext,auth_tag,expires_at) VALUES($1,$2,$3,$4,$5,least($6::timestamptz,now()+interval '30 minutes'))",
        [this.companyId,hash,sealed.nonce,sealed.ciphertext,sealed.authTag,new Date(value.expires)]);
    }catch{throw new DomainError('SESSION_STORE_UNAVAILABLE','세션 저장소 연결을 확인하세요.');}
  }
  async delete(token:string){
    try{await this.pool.query('DELETE FROM private.human_sessions WHERE company_id=$1 AND token_hash=$2',[this.companyId,sessionTokenHash(token)]);}
    catch{throw new DomainError('SESSION_STORE_UNAVAILABLE','세션 저장소 연결을 확인하세요.');}
  }
}
