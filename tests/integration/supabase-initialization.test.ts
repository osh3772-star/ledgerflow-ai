import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {startLocalPostgres} from '../../scripts/local-postgres.js';
import {buildInitialMigrationBundle,inspectInitialSchema,applyInitialSchema} from '../../scripts/supabase-initialization.js';

describe('fresh Supabase initialization on a test-owned native database',()=>{
  let db:Awaited<ReturnType<typeof startLocalPostgres>>;
  const bundlePromise=buildInitialMigrationBundle();
  beforeAll(async()=>{db=await startLocalPostgres({throughMigration:null});});
  afterAll(async()=>{if(db)await db.stop();});
  it('refuses the local Auth bootstrap and preserves unrelated existing data',async()=>{
    const client=await db.pool.connect(),bundle=await bundlePromise;
    try{
      expect(await inspectInitialSchema(client,bundle)).toMatchObject({state:'blocked',reason:'NATIVE_TEST_HARNESS_REFUSED'});
      await expect(applyInitialSchema(client,bundle,bundle.bundleHash)).rejects.toThrow('NATIVE_TEST_HARNESS_REFUSED');
      // Only this disposable test fixture removes its own marker. The hosted
      // CLI never runs this SQL or accepts a local database URL.
      await client.query('DROP TABLE private.native_test_bootstrap; CREATE TABLE public.keep_me(value int); INSERT INTO public.keep_me VALUES(7)');
      await expect(applyInitialSchema(client,bundle,bundle.bundleHash)).rejects.toThrow('EXISTING_SCHEMA_REQUIRES_REVIEW');
      expect((await client.query('SELECT value FROM public.keep_me')).rows).toEqual([{value:7}]);
      expect((await client.query("SELECT to_regclass('public.companies') AS name")).rows[0]!.name).toBeNull();
      await client.query('DROP TABLE public.keep_me');
    }finally{client.release();}
  });
  it('rolls back earlier migrations and its receipt if later DDL fails',async()=>{
    const client=await db.pool.connect(),bundle=await bundlePromise;
    try{
      await client.query(`CREATE FUNCTION auth.reject_test_journal() RETURNS event_trigger LANGUAGE plpgsql AS $$
        BEGIN IF to_regclass('public.invoices') IS NOT NULL THEN RAISE EXCEPTION 'test-injected-ddl-failure'; END IF; END;$$;
        CREATE EVENT TRIGGER ledgerflow_test_ddl_failure ON ddl_command_start WHEN TAG IN ('CREATE TABLE') EXECUTE FUNCTION auth.reject_test_journal()`);
      try{
        await expect(applyInitialSchema(client,bundle,bundle.bundleHash)).rejects.toThrow('test-injected-ddl-failure');
        for(const name of ['public.companies','public.invoices','private.ledgerflow_initialization'])
          expect((await client.query('SELECT to_regclass($1) AS name',[name])).rows[0]!.name).toBeNull();
      }finally{await client.query('DROP EVENT TRIGGER ledgerflow_test_ddl_failure; DROP FUNCTION auth.reject_test_journal()');}
    }finally{client.release();}
  });
  it('applies all six in one transaction, is idempotent, and creates no users or ERP/journal rows',async()=>{
    const client=await db.pool.connect(),bundle=await bundlePromise;
    try{
      expect(await inspectInitialSchema(client,bundle)).toMatchObject({state:'fresh',existingObjects:0});
      expect(await applyInitialSchema(client,bundle,bundle.bundleHash)).toEqual({applied:true,reused:false,migrationsApplied:6});
      expect(await inspectInitialSchema(client,bundle)).toMatchObject({state:'already_applied',schemaReady:true});
      expect(await applyInitialSchema(client,bundle,bundle.bundleHash)).toEqual({applied:false,reused:true,migrationsApplied:0});
      for(const table of ['auth.users','public.business_transactions','public.journal_entries'])
        expect((await client.query('SELECT count(*)::int AS n FROM '+table)).rows[0]!.n).toBe(0);
      expect((await client.query('SELECT count(*)::int AS n FROM private.ledgerflow_initialization')).rows[0]!.n).toBe(1);
      const tampered={...bundle,bundleHash:'0'.repeat(64)};
      expect(await inspectInitialSchema(client,tampered)).toMatchObject({state:'blocked',reason:'INITIAL_MIGRATION_HASH_MISMATCH'});
    }finally{client.release();}
  });
});
