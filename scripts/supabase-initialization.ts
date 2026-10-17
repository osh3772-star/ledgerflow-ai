import {createHash} from 'node:crypto';
import {readFile,readdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {PoolClient} from 'pg';
import {DATABASE_TABLES,DATABASE_PROCEDURES} from './database-readiness.js';

const migrationNames=[
  '202610140001_mini_erp.sql','202610140002_erp_subledgers.sql','202610140003_erp_services.sql',
  '202610140004_accounting.sql','202610140005_controls.sql','202610150006_human_sessions.sql',
] as const;
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export interface InitialMigrationBundle{
  migrations:{name:string;sha256:string;bytes:number}[];body:string;bundleHash:string;
}
function bundleHash(migrations:InitialMigrationBundle['migrations'],body:string){
  return hash(JSON.stringify({version:1,migrations,body}));
}
export async function buildInitialMigrationBundle(directory=resolve('supabase/migrations')):Promise<InitialMigrationBundle>{
  // Keep the immutable initial six-file receipt stable; later migrations have
  // their own checked upgrade path, rather than changing existing receipts.
  const names=(await readdir(directory)).filter(name=>/^\d+_.+\.sql$/u.test(name)&&name<'202610170007').sort();
  if(JSON.stringify(names)!==JSON.stringify(migrationNames))throw new Error('INITIAL_MIGRATION_SET_CHANGED');
  const migrations:InitialMigrationBundle['migrations']=[],bodies:string[]=[];
  for(const name of names){
    const bytes=await readFile(resolve(directory,name)),sql=bytes.toString('utf8');
    if((sql.match(/^BEGIN;\r?$/gmu)??[]).length!==1||(sql.match(/^COMMIT;\r?$/gmu)??[]).length!==1
      ||!sql.trimEnd().endsWith('COMMIT;')||/native_test_bootstrap|INSERT\s+INTO\s+auth\.users/iu.test(sql))
      throw new Error('INITIAL_MIGRATION_FRAMING_INVALID');
    migrations.push({name,sha256:hash(bytes),bytes:bytes.length});
    // Preserve original files. Only their outer transaction wrappers are
    // combined in memory, so all six files and the receipt commit together.
    bodies.push('-- '+name+'\n'+sql.replace(/^BEGIN;\r?$/mu,'').replace(/^COMMIT;\s*$/mu,''));
  }
  const body=bodies.join('\n');
  return {migrations,body,bundleHash:bundleHash(migrations,body)};
}

export interface InitialSchemaPlan{
  authReady:boolean;storagePresent:boolean;nativeHarnessPresent:boolean;existingObjects:number;
  receiptPresent:boolean;receiptHash:string|null;schemaReady:boolean;
  state:'fresh'|'already_applied'|'blocked';reason:string|null;
}
// Catalog and our own initialization receipt only. No ledger/user rows.
export async function inspectInitialSchema(client:PoolClient,bundle:InitialMigrationBundle):Promise<InitialSchemaPlan>{
  const result=await client.query<Omit<InitialSchemaPlan,'receiptHash'|'state'|'reason'>>(`
    SELECT to_regclass('auth.users') IS NOT NULL AND to_regprocedure('auth.uid()') IS NOT NULL
      AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated')
      AND EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') AS "authReady",
      to_regclass('storage.objects') IS NOT NULL AND to_regclass('storage.buckets') IS NOT NULL AS "storagePresent",
      to_regclass('private.native_test_bootstrap') IS NOT NULL AS "nativeHarnessPresent",
      to_regclass('private.ledgerflow_initialization') IS NOT NULL AS "receiptPresent",
      ((SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
          WHERE n.nspname IN ('public','private') AND c.relkind IN ('r','p','v','m','S','f')
          AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e'))
       +(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
          WHERE n.nspname IN ('public','private')
          AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e'))
       +(SELECT count(*) FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
          WHERE n.nspname IN ('public','private') AND t.typtype IN ('d','e')
          AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_type'::regclass AND d.objid=t.oid AND d.deptype='e'))
      )::int AS "existingObjects",
      NOT EXISTS(SELECT 1 FROM unnest($1::text[]) name LEFT JOIN pg_class c ON c.oid=to_regclass('public.'||name)
          WHERE c.oid IS NULL OR NOT c.relrowsecurity)
        AND NOT EXISTS(SELECT 1 FROM unnest($2::text[]) signature WHERE to_regprocedure(signature) IS NULL)
        AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.journal_entries')
          AND attname='discarded_at' AND NOT attisdropped)
        AND to_regclass('private.human_sessions') IS NOT NULL AS "schemaReady"`,[DATABASE_TABLES,DATABASE_PROCEDURES]);
  const row=result.rows[0];if(!row)throw new Error('INITIAL_SCHEMA_METADATA_UNAVAILABLE');
  let receiptHash:string|null=null;
  if(row.receiptPresent){
    const receipts=await client.query<{bundle_hash:string}>('SELECT bundle_hash FROM private.ledgerflow_initialization LIMIT 2');
    if(receipts.rows.length===1&&/^[a-f0-9]{64}$/u.test(receipts.rows[0]!.bundle_hash))receiptHash=receipts.rows[0]!.bundle_hash;
  }
  const plan:InitialSchemaPlan={...row,receiptHash,state:'blocked',reason:null};
  if(row.nativeHarnessPresent)plan.reason='NATIVE_TEST_HARNESS_REFUSED';
  else if(!row.authReady)plan.reason='SUPABASE_AUTH_SCHEMA_REQUIRED';
  else if(row.receiptPresent){
    if(receiptHash!==bundle.bundleHash)plan.reason='INITIAL_MIGRATION_HASH_MISMATCH';
    else if(!row.schemaReady)plan.reason='INITIALIZED_SCHEMA_INCOMPLETE';
    else plan.state='already_applied';
  }else if(row.existingObjects)plan.reason='EXISTING_SCHEMA_REQUIRES_REVIEW';
  else plan.state='fresh';
  return plan;
}

// Operator-only source-development bootstrap. Not an MCP/accounting tool or a
// general SQL runner. Existing installations/upgrades are never adopted/reset.
export async function applyInitialSchema(client:PoolClient,bundle:InitialMigrationBundle,expectedHash:string){
  if(!/^[a-f0-9]{64}$/u.test(expectedHash)||bundle.bundleHash!==expectedHash
    ||bundleHash(bundle.migrations,bundle.body)!==expectedHash)throw new Error('INITIAL_MIGRATION_HASH_MISMATCH');
  await client.query('BEGIN');
  try{
    await client.query("SET LOCAL lock_timeout='5s'; SET LOCAL statement_timeout='60s'");
    await client.query('SELECT pg_advisory_xact_lock(20261016,1)');
    const before=await inspectInitialSchema(client,bundle);
    if(before.state==='blocked')throw new Error(before.reason!);
    if(before.state==='already_applied'){
      await client.query('ROLLBACK');return {applied:false,reused:true,migrationsApplied:0};
    }
    await client.query(bundle.body);
    await client.query(`CREATE TABLE private.ledgerflow_initialization(
      singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
      bundle_hash text NOT NULL CHECK(bundle_hash ~ '^[a-f0-9]{64}$'),
      migrations jsonb NOT NULL CHECK(jsonb_typeof(migrations)='array'),applied_at timestamptz NOT NULL DEFAULT now());
      ALTER TABLE private.ledgerflow_initialization ENABLE ROW LEVEL SECURITY;
      ALTER TABLE private.ledgerflow_initialization FORCE ROW LEVEL SECURITY;
      REVOKE ALL ON private.ledgerflow_initialization FROM PUBLIC,anon,authenticated;`);
    // Keep the receipt private to the migration owner, including non-superuser
    // hosted owners under FORCE RLS. Grant no Auth client access.
    await client.query(`DO $$BEGIN EXECUTE format('CREATE POLICY initialization_owner ON private.ledgerflow_initialization TO %I USING(true) WITH CHECK(true)',current_user); END;$$`);
    await client.query('INSERT INTO private.ledgerflow_initialization(bundle_hash,migrations) VALUES($1,$2::jsonb)',
      [bundle.bundleHash,JSON.stringify(bundle.migrations)]);
    const after=await inspectInitialSchema(client,bundle);
    if(after.state!=='already_applied')throw new Error('INITIAL_SCHEMA_VERIFICATION_FAILED');
    await client.query('COMMIT');return {applied:true,reused:false,migrationsApplied:bundle.migrations.length};
  }catch(error){await client.query('ROLLBACK');throw error;}
}
