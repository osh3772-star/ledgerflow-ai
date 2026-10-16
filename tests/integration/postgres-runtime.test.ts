import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {generateFullErpSeed} from '@ledgerflow/test-data';
import {startLocalPostgres} from '../../scripts/local-postgres.js';
import {seedFullDatabase} from '../../scripts/seed-full-database.js';
import {createMcpRuntime} from '../../scripts/mcp-runtime.js';
import {readSupabaseMetadata} from '../../scripts/supabase-readiness.js';

describe('existing PostgreSQL runtime preserves its database and fails closed',()=>{
 const seed=generateFullErpSeed(),companyId=seed.companies[0]!.id,writer=seed.identities.find(r=>r.companyId===companyId&&r.role==='preparer')!;
 let db:Awaited<ReturnType<typeof startLocalPostgres>>,environment:NodeJS.ProcessEnv;
 beforeAll(async()=>{
   db=await startLocalPostgres({throughMigration:'202610140003_erp_services.sql'});
   await seedFullDatabase(db.pool,seed);
   const options=db.pool.options,url=new URL('postgresql://127.0.0.1');
   url.port=String(options.port);url.username=String(options.user);url.password=String(options.password);url.pathname='/'+String(options.database);
   environment={LEDGERFLOW_MCP_MODE:'postgres',LEDGERFLOW_DATABASE_URL:url.href,LEDGERFLOW_COMPANY_ID:companyId,LEDGERFLOW_USER_ID:writer.userId,ADAPTER_MODE:'mock'};
 });
 afterAll(async()=>{if(db)await db.stop();});
 const count=async()=>(await db.pool.query('SELECT count(*)::int AS n FROM public.business_transactions')).rows[0]!.n as number;
 const connections=async()=>(await db.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='ledgerflow-mcp'")).rows[0]!.n as number;
 it('refuses missing accounting schema without auto-migrating, seeding or leaking its pool',async()=>{
   await expect(createMcpRuntime(environment)).rejects.toMatchObject({code:'DATABASE_SCHEMA_INCOMPLETE'});
   expect((await db.pool.query("SELECT to_regclass('public.journal_entries') AS name")).rows[0]!.name).toBeNull();
   expect(await count()).toBe(1001);expect(await connections()).toBe(0);
 });
 it('reads hosted-setup metadata from an existing database without changing ERP rows or applying missing migrations',async()=>{
   const before=await count();
   const result=await readSupabaseMetadata({connectionString:environment.LEDGERFLOW_DATABASE_URL!});
   expect(result.serverVersionNumber).toBeGreaterThanOrEqual(170000);
   expect(result).toMatchObject({authSchemaPresent:true,storageTablesPresent:false,discardedColumnPresent:false,rlsDisabled:[]});
   expect(result.missingTables).toContain('journal_entries');
   expect(result.missingProcedures).toContain('public.accounting_command(uuid,text,jsonb)');
   expect(await count()).toBe(before);
   expect((await db.pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='ledgerflow-supabase-check'")).rows[0]!.n).toBe(0);
 });
 it('retains a Draft across two app runtimes without resetting rows or enabling anonymous approval',async()=>{
   for(const name of ['202610140004_accounting.sql','202610140005_controls.sql'])await db.pool.query(await readFile('supabase/migrations/'+name,'utf8'));
   await db.pool.query("INSERT INTO public.principal_scopes(company_id,principal_id,scope) VALUES($1,$2,'accounting:write')",[companyId,writer.principalId]);
   const first=await createMcpRuntime(environment);
   let id:string,hash:string;
   try{
     const draft=await first.dependencies.accounting!.propose({companyId,transactionId:seed.transactions.find(t=>t.externalRef==='LF26-SAL-0101')!.id,idempotencyKey:'existing-db-restart'});
     id=draft.id;hash=draft.hash;
     const session=await first.dependencies.humanRouter!(new Request('http://127.0.0.1:8787/api/human/session',{headers:{'Sec-Fetch-Site':'same-origin'}}));
     expect(session.status).toBe(401);
   }finally{await first.close();await first.close();}
   expect(await connections()).toBe(0);
   const second=await createMcpRuntime(environment);
   try{
     expect(await second.dependencies.accounting!.get({companyId,journalId:id!})).toMatchObject({id:id!,hash:hash!,state:'Draft'});
     expect(await count()).toBe(1001);
     expect((await db.pool.query("SELECT count(*)::int AS n FROM public.business_transactions WHERE status='unprocessed'")).rows[0]!.n).toBe(1001);
   }finally{await second.close();}
 });
 it('closes connections on invalid external Auth configuration and rejects tenant spoofing',async()=>{
   await expect(createMcpRuntime({...environment,SUPABASE_URL:'http://not-local.example',SUPABASE_PUBLISHABLE_KEY:'fixture-publishable'})).rejects.toThrow('HTTPS');
   expect(await connections()).toBe(0);
   await expect(createMcpRuntime({...environment,LEDGERFLOW_COMPANY_ID:seed.companies[1]!.id})).rejects.toMatchObject({code:'FORBIDDEN'});
   expect(await connections()).toBe(0);expect(await count()).toBe(1001);
 });
});
