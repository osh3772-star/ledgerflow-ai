import {mkdir,writeFile} from 'node:fs/promises';
import pg from 'pg';
import {loadServerEnvironment} from './server-env.js';
import {databasePoolOptions} from './postgres-connection.js';
import {checkSupabaseConnection} from './supabase-readiness.js';
import {buildInitialMigrationBundle,inspectInitialSchema,applyInitialSchema} from './supabase-initialization.js';

// No mode/server/environment changes, Auth users, fixture rows or ledger actions.
async function main(){
  const args=process.argv.slice(2),apply=args.includes('--apply'),offline=args.includes('--offline');
  const project=args.find(arg=>arg.startsWith('--project='))?.slice(10);
  const expectedHash=args.find(arg=>arg.startsWith('--hash='))?.slice(7);
  if(args.some(arg=>!['--apply','--offline'].includes(arg)&&!arg.startsWith('--project=')&&!arg.startsWith('--hash='))
    ||offline&&(apply||project||expectedHash)||apply&&(!project||!expectedHash))throw new Error('INITIALIZATION_ARGUMENTS_INVALID');
  const bundle=await buildInitialMigrationBundle();
  const report={generatedAt:new Date().toISOString(),bundleHash:bundle.bundleHash,migrations:bundle.migrations,
    offline,applyRequested:apply,projectRef:null as string|null,connectionChecksPassed:false,
    plan:null as Awaited<ReturnType<typeof inspectInitialSchema>>|null,
    result:null as Awaited<ReturnType<typeof applyInitialSchema>>|null,errorCode:null as string|null,
    authUsersCreated:0,seedRowsWritten:0,accountingRowsRead:0,accountingMutations:0,paidModelApiCalls:0};
  if(!offline){
    loadServerEnvironment();
    const connection=await checkSupabaseConnection(process.env);
    report.projectRef=connection.projectRef;report.connectionChecksPassed=connection.connectionChecksPassed;
    if(!connection.connectionChecksPassed){
      report.errorCode=connection.errorCode??connection.database.errorCode??connection.authHealth.errorCode;
      process.exitCode=1;
    }else{
      if(apply&&(project!==connection.projectRef||expectedHash!==bundle.bundleHash))throw new Error('INITIALIZATION_TARGET_MISMATCH');
      const pool=new pg.Pool({...await databasePoolOptions(process.env),max:1,
        application_name:'ledgerflow-supabase-initialize',statement_timeout:60_000,query_timeout:65_000});
      pool.on('error',()=>{});
      try{
        const client=await pool.connect();
        try{
          await client.query('BEGIN READ ONLY');
          try{report.plan=await inspectInitialSchema(client,bundle);}
          finally{await client.query('ROLLBACK');}
          // Real Supabase must already supply its own Auth and Storage schemas.
          if(!report.plan.storagePresent)throw new Error('SUPABASE_STORAGE_SCHEMA_REQUIRED');
          if(report.plan.state==='blocked'){
            report.errorCode=report.plan.reason;process.exitCode=1;
          }else if(apply)report.result=await applyInitialSchema(client,bundle,expectedHash!);
        }finally{client.release();}
      }finally{await pool.end();}
    }
  }
  await mkdir('.ledgerflow/supabase',{recursive:true});
  await writeFile('.ledgerflow/supabase/initialization-plan.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify(report,null,2));
}
try{await main();}catch(error){
  const codes=['INITIALIZATION_ARGUMENTS_INVALID','INITIAL_MIGRATION_SET_CHANGED','INITIAL_MIGRATION_FRAMING_INVALID',
    'INITIALIZATION_TARGET_MISMATCH','INITIAL_MIGRATION_HASH_MISMATCH','SUPABASE_STORAGE_SCHEMA_REQUIRED',
    'NATIVE_TEST_HARNESS_REFUSED','SUPABASE_AUTH_SCHEMA_REQUIRED','EXISTING_SCHEMA_REQUIRES_REVIEW',
    'INITIALIZED_SCHEMA_INCOMPLETE','INITIAL_SCHEMA_VERIFICATION_FAILED'];
  console.error(JSON.stringify({errorCode:error instanceof Error&&codes.includes(error.message)?error.message:'SUPABASE_INITIALIZATION_FAILED',
    credentialsLogged:false,appliedNotConfirmed:true}));process.exitCode=1;
}
