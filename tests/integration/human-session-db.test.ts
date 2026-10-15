import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {generateFullErpSeed} from '@ledgerflow/test-data';
import {startLocalPostgres} from '../../scripts/local-postgres.js';
import {seedFullDatabase} from '../../scripts/seed-full-database.js';
import {createMcpRuntime} from '../../scripts/mcp-runtime.js';
import {PostgresHumanSessionStore} from '../../apps/mcp-server/src/postgres-human-session-store.js';
import {sessionTokenHash} from '../../apps/mcp-server/src/human-session-store.js';

describe('encrypted server-only PostgreSQL human sessions (stubbed Auth, not hosted Supabase)',()=>{
  const seed=generateFullErpSeed(),company=seed.companies[0]!.id,foreign=seed.companies[1]!.id;
  const reader=seed.identities.find(i=>i.companyId===company&&i.role==='viewer')!,human=seed.identities.find(i=>i.companyId===company&&i.role==='preparer')!;
  const key=randomBytes(32).toString('base64');
  let db:Awaited<ReturnType<typeof startLocalPostgres>>,store:PostgresHumanSessionStore,environment:NodeJS.ProcessEnv;
  beforeAll(async()=>{
    db=await startLocalPostgres({throughMigration:'202610140005_controls.sql'});await seedFullDatabase(db.pool,seed);
    store=new PostgresHumanSessionStore(db.pool,company,key);
    const options=db.pool.options,url=new URL('postgresql://127.0.0.1');
    url.port=String(options.port);url.username=String(options.user);url.password=String(options.password);url.pathname='/'+String(options.database);
    environment={LEDGERFLOW_MCP_MODE:'postgres',LEDGERFLOW_DATABASE_URL:url.href,LEDGERFLOW_COMPANY_ID:company,LEDGERFLOW_USER_ID:reader.userId,
      ADAPTER_MODE:'mock',SUPABASE_URL:'https://auth.fixture.example',SUPABASE_PUBLISHABLE_KEY:'fixture-publishable',
      LEDGERFLOW_HUMAN_SESSION_STORE:'postgres',LEDGERFLOW_SESSION_ENCRYPTION_KEY:key};
  });
  afterAll(async()=>{vi.unstubAllGlobals();if(db)await db.stop();});
  const value=()=>({userId:human.userId,csrf:'c'.repeat(48),accessToken:'fixture-jwt-must-stay-encrypted',expires:Date.now()+60000});
  it('rejects an unprepared session schema without changing existing ERP or leaking app connections',async()=>{
    await expect(createMcpRuntime(environment)).rejects.toMatchObject({code:'SESSION_SCHEMA_INCOMPLETE'});
    expect((await db.pool.query("SELECT to_regclass('private.human_sessions') AS name")).rows[0]!.name).toBeNull();
    expect((await db.pool.query('SELECT count(*)::int AS n FROM public.business_transactions')).rows[0]!.n).toBe(1001);
    expect((await db.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='ledgerflow-mcp'")).rows[0]!.n).toBe(0);
    await db.pool.query(await readFile('supabase/migrations/202610150006_human_sessions.sql','utf8'));await store.assertReady();
  });
  it('resumes the same session after runtime restart and revalidates external Auth without writing a journal',async()=>{
    const fetcher=vi.fn(async(input:URL|RequestInfo,init?:RequestInit)=>{
      expect(String(input)).toBe('https://auth.fixture.example/auth/v1/user');
      expect(new Headers(init?.headers).get('authorization')).toBe('Bearer fixture-runtime-jwt');
      return Response.json({id:human.userId,aud:'authenticated',created_at:'2026-01-01T00:00:00Z'});
    });
    vi.stubGlobal('fetch',fetcher);
    let cookie='',csrf='';
    const first=await createMcpRuntime(environment);
    try{
      const response=await first.dependencies.humanRouter!(new Request('http://127.0.0.1:8787/api/human/session',{
        headers:{'Sec-Fetch-Site':'same-origin',Authorization:'Bearer fixture-runtime-jwt'}}));
      expect(response.status).toBe(200);cookie=response.headers.get('set-cookie')!.split(';')[0]!;csrf=(await response.json() as {csrf:string}).csrf;
    }finally{await first.close();}
    const second=await createMcpRuntime(environment);
    try{
      const response=await second.dependencies.humanRouter!(new Request('http://127.0.0.1:8787/api/human/session',{
        headers:{'Sec-Fetch-Site':'same-origin',Cookie:cookie}}));
      expect(response.status).toBe(200);expect(await response.json()).toEqual({ready:true,csrf});expect(response.headers.has('set-cookie')).toBe(false);
      const raw=cookie.split('=')[1]!,row=(await db.pool.query('SELECT * FROM private.human_sessions WHERE company_id=$1 AND token_hash=$2',[company,sessionTokenHash(raw)])).rows[0]!;
      expect(row.token_hash).not.toBe(raw);expect(row.ciphertext.includes(Buffer.from('fixture-runtime-jwt'))).toBe(false);expect(row.ciphertext.includes(Buffer.from(csrf))).toBe(false);
      expect(fetcher).toHaveBeenCalledTimes(2);
      const missingCsrf=await second.dependencies.humanRouter!(new Request('http://127.0.0.1:8787/api/human/decision',{method:'POST',headers:{Cookie:cookie}}));
      expect(missingCsrf.status).toBe(401);
      expect((await db.pool.query('SELECT count(*)::int AS n FROM public.journal_entries')).rows[0]!.n).toBe(0);
    }finally{await second.close();vi.unstubAllGlobals();}
  });
  it('rejects a copied ciphertext under a different company or session hash',async()=>{
    const token=randomBytes(32).toString('hex'),other=randomBytes(32).toString('hex');await store.put(token,value());
    const foreignStore=new PostgresHumanSessionStore(db.pool,foreign,key);
    expect(await foreignStore.get(token)).toBeUndefined();
    await db.pool.query('INSERT INTO private.human_sessions(company_id,token_hash,nonce,ciphertext,auth_tag,expires_at,created_at) SELECT $3,token_hash,nonce,ciphertext,auth_tag,expires_at,created_at FROM private.human_sessions WHERE company_id=$1 AND token_hash=$2',[company,sessionTokenHash(token),foreign]);
    expect(await foreignStore.get(token)).toBeUndefined();
    await db.pool.query('INSERT INTO private.human_sessions(company_id,token_hash,nonce,ciphertext,auth_tag,expires_at,created_at) SELECT company_id,$3,nonce,ciphertext,auth_tag,expires_at,created_at FROM private.human_sessions WHERE company_id=$1 AND token_hash=$2',[company,sessionTokenHash(token),sessionTokenHash(other)]);
    expect(await store.get(other)).toBeUndefined();
  });
  it('rejects tampering and wrong keys; expires and revokes persisted sessions',async()=>{
    const token=randomBytes(32).toString('hex');await store.put(token,value());
    expect(await new PostgresHumanSessionStore(db.pool,company,randomBytes(32).toString('base64')).get(token)).toBeUndefined();
    await db.pool.query('UPDATE private.human_sessions SET ciphertext=set_byte(ciphertext,0,get_byte(ciphertext,0)#1) WHERE company_id=$1 AND token_hash=$2',[company,sessionTokenHash(token)]);
    expect(await store.get(token)).toBeUndefined();await store.delete(token);
    const expired=randomBytes(32).toString('hex');await store.put(expired,value());
    await db.pool.query("UPDATE private.human_sessions SET created_at=now()-interval '1 hour',expires_at=now()-interval '40 minutes' WHERE company_id=$1 AND token_hash=$2",[company,sessionTokenHash(expired)]);
    expect(await store.get(expired)).toBeUndefined();
    const active=randomBytes(32).toString('hex');await store.put(active,value());
    expect((await db.pool.query('SELECT 1 FROM private.human_sessions WHERE company_id=$1 AND token_hash=$2',[company,sessionTokenHash(expired)])).rows).toHaveLength(0);
    await store.delete(active);expect(await store.get(active)).toBeUndefined();
  });
  it('denies anon/authenticated direct access and enables forced RLS',async()=>{
    const row=(await db.pool.query("SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='private.human_sessions'::regclass")).rows[0]!;
    expect(row).toMatchObject({relrowsecurity:true,relforcerowsecurity:true});
    for(const role of ['anon','authenticated']){
      const client=await db.pool.connect();
      try{await client.query('BEGIN');await client.query('SET LOCAL ROLE '+role);await expect(client.query('SELECT * FROM private.human_sessions')).rejects.toThrow();}
      finally{await client.query('ROLLBACK');client.release();}
    }
    await db.pool.query('ALTER TABLE private.human_sessions DISABLE ROW LEVEL SECURITY');
    try{await expect(store.assertReady()).rejects.toMatchObject({code:'SESSION_SCHEMA_INCOMPLETE'});}
    finally{await db.pool.query('ALTER TABLE private.human_sessions ENABLE ROW LEVEL SECURITY');}
    await db.pool.query('GRANT SELECT ON private.human_sessions TO authenticated');
    try{await expect(store.assertReady()).rejects.toMatchObject({code:'SESSION_SCHEMA_INCOMPLETE'});}
    finally{await db.pool.query('REVOKE SELECT ON private.human_sessions FROM authenticated');}
  });
});
