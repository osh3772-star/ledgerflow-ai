import {randomBytes,createHash} from 'node:crypto';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import pg from 'pg';
import {loadServerEnvironment} from './server-env.js';
import {databasePoolOptions} from './postgres-connection.js';
import {buildInitialMigrationBundle,inspectInitialSchema,applyInitialSchema} from './supabase-initialization.js';
import {checkSupabaseConnection} from './supabase-readiness.js';

// Owner's explicit source-deployment command, never exposed through MCP/web.
// Fail before uploads or activation if DB authentication/schema checks fail.
async function main(){
 loadServerEnvironment();
 const report=await checkSupabaseConnection(process.env);
 if(!report.connectionChecksPassed)throw new Error(report.database.errorCode??'SUPABASE_CHECK_FAILED');
 const pool=new pg.Pool(await databasePoolOptions(process.env));
 try{
  const bundle=await buildInitialMigrationBundle(),client=await pool.connect();
  try{
   const plan=await inspectInitialSchema(client,bundle);
   if(plan.state==='blocked')throw new Error(plan.reason??'SCHEMA_REVIEW_REQUIRED');
   if(plan.state==='fresh')await applyInitialSchema(client,bundle,bundle.bundleHash);
   const sql=await readFile('supabase/migrations/202610170007_remote_workspaces.sql','utf8'),hash=createHash('sha256').update(sql).digest('hex');
   await client.query('BEGIN');
   try{
    await client.query('SELECT pg_advisory_xact_lock(20261017,7)');
    const exists=(await client.query("SELECT to_regclass('private.remote_schema_receipt') IS NOT NULL AS ready")).rows[0].ready;
    if(exists){
     if((await client.query('SELECT hash FROM private.remote_schema_receipt')).rows[0]?.hash!==hash)throw new Error('REMOTE_MIGRATION_HASH_MISMATCH');
    }else{
     if((await client.query("SELECT to_regclass('private.remote_workspaces') IS NOT NULL AS ready")).rows[0].ready)throw new Error('REMOTE_SCHEMA_REVIEW_REQUIRED');
     await client.query(sql.replace(/^BEGIN;\r?$/mu,'').replace(/^COMMIT;\s*$/mu,''));
     await client.query('CREATE TABLE private.remote_schema_receipt(singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),hash text NOT NULL)');
     await client.query('REVOKE ALL ON private.remote_schema_receipt FROM PUBLIC,anon,authenticated');
     await client.query('INSERT INTO private.remote_schema_receipt(hash) VALUES($1)',[hash]);
    }
    await client.query('COMMIT');
   }catch(error){await client.query('ROLLBACK');throw error;}
  }finally{client.release();}
 }finally{await pool.end();}
 if(!process.env.LEDGERFLOW_REMOTE_ENCRYPTION_KEY){
  const line='LEDGERFLOW_REMOTE_ENCRYPTION_KEY='+randomBytes(32).toString('base64');
  const env=await readFile('.env.local','utf8');await writeFile('.env.local',env+'\n'+line+'\n');
  process.env.LEDGERFLOW_REMOTE_ENCRYPTION_KEY=line.slice(line.indexOf('=')+1);
 }
 if(Buffer.from(process.env.LEDGERFLOW_REMOTE_ENCRYPTION_KEY!,'base64').length!==32)throw new Error('REMOTE_KEY_INVALID');
 const caFile=process.env.LEDGERFLOW_DATABASE_CA_FILE;if(!caFile)throw new Error('DATABASE_CA_FILE_REQUIRED');
 const ca=await readFile(caFile,'utf8');if(!ca.includes('-----BEGIN CERTIFICATE-----'))throw new Error('DATABASE_CA_INVALID');
 const require=createRequire(resolve('apps/public-api-gateway/package.json'));
 const wrangler=resolve(dirname(require.resolve('wrangler/package.json')),'bin/wrangler.js');
 const payload={SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY:process.env.SUPABASE_PUBLISHABLE_KEY,
  LEDGERFLOW_DATABASE_URL:process.env.LEDGERFLOW_DATABASE_URL,LEDGERFLOW_REMOTE_ENCRYPTION_KEY:process.env.LEDGERFLOW_REMOTE_ENCRYPTION_KEY,LEDGERFLOW_DATABASE_CA_PEM:ca};
 const upload=spawn(process.execPath,[wrangler,'secret','bulk'],{cwd:resolve('apps/public-api-gateway'),stdio:['pipe','pipe','pipe'],windowsHide:true});
 upload.stdout.resume();upload.stderr.resume();upload.stdin.on('error',()=>{});upload.stdin.end(JSON.stringify(payload));
 if(await new Promise<number>((done,reject)=>{upload.once('error',reject);upload.once('close',code=>done(code??1));})!==0)throw new Error('REMOTE_SECRET_UPLOAD_FAILED');
 const base=JSON.parse(await readFile('apps/public-api-gateway/wrangler.jsonc','utf8'));
 base.main=resolve('apps/public-api-gateway/src/worker.ts');base.assets.directory=resolve('apps/web/dist');base.vars.REMOTE_ENABLED='true';
 await mkdir('.ledgerflow/remote-deploy',{recursive:true});
 const config=resolve('.ledgerflow/remote-deploy/wrangler.json');await writeFile(config,JSON.stringify(base,null,2));
 const deploy=spawn(process.execPath,[wrangler,'deploy','--config',config],{cwd:resolve('apps/public-api-gateway'),stdio:['ignore','pipe','pipe'],windowsHide:true});
 // A failed deployment must not echo private connection/driver/provider errors.
 deploy.stdout.resume();deploy.stderr.resume();
 if(await new Promise<number>((done,reject)=>{deploy.once('error',reject);deploy.once('close',code=>done(code??1));})!==0)throw new Error('REMOTE_WORKER_DEPLOY_FAILED');
 console.log(JSON.stringify({remoteDeployed:true,url:base.vars.REMOTE_ORIGIN,mcpUrl:base.vars.REMOTE_ORIGIN+'/mcp',secretsPrinted:false,
  remainingChecks:['Supabase email confirmation redirect allowlist','Two real user logins','Native Codex/Claude OAuth and tools']}));
}
try{await main();}catch(error){
 const safe=['DATABASE_AUTHENTICATION_FAILED','DATABASE_CA_FILE_REQUIRED','DATABASE_CA_INVALID','REMOTE_KEY_INVALID','REMOTE_SECRET_UPLOAD_FAILED','REMOTE_WORKER_DEPLOY_FAILED',
  'REMOTE_MIGRATION_HASH_MISMATCH','REMOTE_SCHEMA_REVIEW_REQUIRED','SUPABASE_CHECK_FAILED'];
 console.error(JSON.stringify({remoteDeployed:false,errorCode:error instanceof Error&&safe.includes(error.message)?error.message:'REMOTE_DEPLOYMENT_BLOCKED',secretsPrinted:false}));process.exitCode=1;
}
