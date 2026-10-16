import pg from 'pg';
import type {PoolConfig} from 'pg';
import {DATABASE_TABLES,DATABASE_PROCEDURES} from './database-readiness.js';
import {databasePoolOptions} from './postgres-connection.js';

export interface SupabaseSchemaMetadata{
  serverVersionNumber:number;authSchemaPresent:boolean;storageTablesPresent:boolean;
  missingTables:string[];missingProcedures:string[];rlsDisabled:string[];discardedColumnPresent:boolean;
}
const configurationNames=['SUPABASE_URL','SUPABASE_PUBLISHABLE_KEY','LEDGERFLOW_DATABASE_URL'] as const;

// Infrastructure metadata only: no accounting rows, Auth users, DDL or seed.
export async function readSupabaseMetadata(options:PoolConfig):Promise<SupabaseSchemaMetadata>{
  const pool=new pg.Pool({...options,max:1,application_name:'ledgerflow-supabase-check',
    statement_timeout:5000,query_timeout:8000});
  pool.on('error',()=>{/* Raw driver errors must never be printed. */});
  try{
    const client=await pool.connect();
    try{
      await client.query('BEGIN READ ONLY');
      try{
        const result=await client.query<SupabaseSchemaMetadata>(`
          SELECT current_setting('server_version_num')::int AS "serverVersionNumber",
            to_regclass('auth.users') IS NOT NULL AS "authSchemaPresent",
            to_regclass('storage.objects') IS NOT NULL AND to_regclass('storage.buckets') IS NOT NULL AS "storageTablesPresent",
            ARRAY(SELECT name FROM unnest($1::text[]) name WHERE to_regclass('public.'||name) IS NULL) AS "missingTables",
            ARRAY(SELECT signature FROM unnest($2::text[]) signature WHERE to_regprocedure(signature) IS NULL) AS "missingProcedures",
            ARRAY(SELECT name FROM unnest($1::text[]) name JOIN pg_class c ON c.oid=to_regclass('public.'||name) WHERE NOT c.relrowsecurity) AS "rlsDisabled",
            EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.journal_entries') AND attname='discarded_at' AND NOT attisdropped) AS "discardedColumnPresent"`,
        [DATABASE_TABLES,DATABASE_PROCEDURES]);
        if(!result.rows[0])throw new Error('METADATA_UNAVAILABLE');
        return result.rows[0];
      }finally{await client.query('ROLLBACK');}
    }finally{client.release();}
  }finally{await pool.end();}
}

function safeFailure(error:unknown){
  const code=(error as {code?:unknown})?.code;
  if(['SELF_SIGNED_CERT_IN_CHAIN','DEPTH_ZERO_SELF_SIGNED_CERT','CERT_HAS_EXPIRED',
    'UNABLE_TO_VERIFY_LEAF_SIGNATURE','ERR_TLS_CERT_ALTNAME_INVALID'].includes(String(code)))return 'TLS_CERTIFICATE_ERROR';
  if(code==='28P01')return 'DATABASE_AUTHENTICATION_FAILED';
  if(code==='ENOTFOUND'||code==='EAI_AGAIN')return 'DATABASE_DNS_FAILED';
  if(code==='ECONNREFUSED'||code==='ETIMEDOUT')return 'DATABASE_NETWORK_FAILED';
  return 'DATABASE_CONNECTION_FAILED';
}

function validateProject(environment:NodeJS.ProcessEnv){
  const target=new URL(environment.SUPABASE_URL!);
  const match=/^([a-z0-9]{20})\.supabase\.co$/u.exec(target.hostname);
  if(!match||target.protocol!=='https:'||target.username||target.password||target.port||target.pathname!=='/'||target.search||target.hash)
    throw new Error('SUPABASE_URL_INVALID');
  const projectRef=match[1]!;
  const key=environment.SUPABASE_PUBLISHABLE_KEY!.trim();
  if(key.startsWith('sb_secret_'))throw new Error('PRIVILEGED_API_KEY_REFUSED');
  if(!/^sb_publishable_[A-Za-z0-9_-]{8,}$/u.test(key)){
    let payload:{role?:string;ref?:string};
    try{
      if(key.length>8192||key.split('.').length!==3)throw new Error();
      payload=JSON.parse(Buffer.from(key.split('.')[1]!,'base64url').toString('utf8')) as typeof payload;
    }catch{throw new Error('PUBLISHABLE_KEY_FORMAT_INVALID');}
    // Decoding is a format/privilege check, not verification of a JWT.
    if(payload?.role!=='anon')throw new Error('PRIVILEGED_API_KEY_REFUSED');
    if(payload.ref&&payload.ref!==projectRef)throw new Error('PROJECT_MISMATCH');
  }
  const database=new URL(environment.LEDGERFLOW_DATABASE_URL!);
  if(!['postgres:','postgresql:'].includes(database.protocol)||database.hash)throw new Error('DATABASE_URL_INVALID');
  let user:string,password:string;
  try{user=decodeURIComponent(database.username);password=decodeURIComponent(database.password);}
  catch{throw new Error('DATABASE_URL_INVALID');}
  if(!password||['[YOUR-PASSWORD]','YOUR_PASSWORD','[YOUR_PASSWORD]'].includes(password))throw new Error('DATABASE_PASSWORD_MISSING');
  if(database.port&&database.port!=='5432')throw new Error('USE_SESSION_POOLER_5432');
  const direct=database.hostname==='db.'+projectRef+'.supabase.co';
  const session=/^[a-z0-9.-]+\.pooler\.supabase\.com$/u.test(database.hostname)&&user.endsWith('.'+projectRef);
  if((!direct&&!session)||!user||database.pathname!=='/postgres')throw new Error('PROJECT_MISMATCH');
  return {target,projectRef,key,connectionType:direct?'direct':'session_pooler'};
}

// Auth's official API-key health endpoint, not the restricted Data API OpenAPI
// root. Read at most 8 KiB, follow no redirects, and discard provider content.
async function authHealth(target:URL,key:string,fetcher:typeof fetch){
  const result={healthy:false,status:null as number|null,errorCode:null as string|null};
  try{
    const response=await fetcher(new URL('/auth/v1/health',target),{method:'GET',
      headers:{apikey:key,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(8000)});
    result.status=response.status;
    if(!response.ok){
      result.errorCode=[401,403].includes(response.status)?'API_KEY_REJECTED':'AUTH_SERVICE_UNAVAILABLE';
      await response.body?.cancel();return result;
    }
    const reader=response.body?.getReader();
    if(!reader)throw new Error();
    const chunks:Uint8Array[]=[];let size=0;
    try{
      for(;;){const part=await reader.read();if(part.done)break;
        size+=part.value.length;if(size>8192)throw new Error();chunks.push(part.value);}
    }finally{await reader.cancel();}
    const body=JSON.parse(Buffer.concat(chunks).toString('utf8')) as {name?:unknown};
    result.healthy=body?.name==='GoTrue';
    if(!result.healthy)result.errorCode='AUTH_HEALTH_RESPONSE_INVALID';
  }catch{result.errorCode='AUTH_HEALTH_REQUEST_FAILED';}
  return result;
}

export async function checkSupabaseConnection(environment:NodeJS.ProcessEnv,
  dependencies:{database?:(options:PoolConfig)=>Promise<SupabaseSchemaMetadata>;fetcher?:typeof fetch}={}){
  const report={configuration:configurationNames.map(name=>({name,configured:Boolean(environment[name]?.trim())})),
    configurationValid:false,projectRef:null as string|null,connectionType:null as string|null,errorCode:null as string|null,
    database:{connected:false,tlsPeerVerified:false,errorCode:null as string|null,metadata:null as SupabaseSchemaMetadata|null},
    authHealth:{healthy:false,status:null as number|null,errorCode:null as string|null},
    connectionChecksPassed:false,ledgerflowSchemaReady:false,nextAction:'configure_environment',
    hostedAuthUserVerified:false,hostedStorageVerified:false,migrationsApplied:0,seedRowsWritten:0,
    accountingRowsRead:0,accountingMutations:0,paidModelApiCalls:0};
  if(report.configuration.some(row=>!row.configured)){report.errorCode='CONFIGURATION_MISSING';return report;}
  let project:ReturnType<typeof validateProject>,options:PoolConfig;
  try{
    project=validateProject(environment);options=await databasePoolOptions(environment);
    report.configurationValid=true;report.projectRef=project.projectRef;report.connectionType=project.connectionType;
  }catch(error){
    const allowed=['SUPABASE_URL_INVALID','PUBLISHABLE_KEY_FORMAT_INVALID','PRIVILEGED_API_KEY_REFUSED','PROJECT_MISMATCH',
      'DATABASE_URL_INVALID','DATABASE_PASSWORD_MISSING','USE_SESSION_POOLER_5432','HOSTED_DATABASE_TLS_OPTIONS_INVALID','DATABASE_CA_INVALID'];
    report.errorCode=error instanceof Error&&allowed.includes(error.message)?error.message:'CONFIGURATION_INVALID';return report;
  }
  const [database,health]=await Promise.allSettled([
    (dependencies.database??readSupabaseMetadata)(options),
    authHealth(project.target,project.key,dependencies.fetcher??fetch),
  ]);
  if(database.status==='fulfilled'){
    report.database.connected=true;report.database.tlsPeerVerified=true;report.database.metadata=database.value;
    report.ledgerflowSchemaReady=database.value.authSchemaPresent&&!database.value.missingTables.length
      &&!database.value.missingProcedures.length&&!database.value.rlsDisabled.length&&database.value.discardedColumnPresent;
  }else report.database.errorCode=safeFailure(database.reason);
  if(health.status==='fulfilled')report.authHealth=health.value;
  else report.authHealth.errorCode='AUTH_HEALTH_REQUEST_FAILED';
  report.connectionChecksPassed=report.database.connected&&report.authHealth.healthy;
  report.nextAction=report.connectionChecksPassed?(report.ledgerflowSchemaReady?'provision_real_identities':'prepare_migrations')
    :report.database.errorCode==='TLS_CERTIFICATE_ERROR'?'configure_database_ca'
    :report.database.errorCode==='DATABASE_AUTHENTICATION_FAILED'?'check_database_credentials':'resolve_connection_failure';
  return report;
}
