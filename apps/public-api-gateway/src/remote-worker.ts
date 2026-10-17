import pg from 'pg';
import {createRemoteRouter} from '../../mcp-server/src/remote-router.js';
import {PublicDataService} from '@ledgerflow/public-data';
import {PostgresApiCache} from '@ledgerflow/data-access';
import type {GatewayEnvironment} from './worker.js';
export interface RemoteEnvironment {
 REMOTE_ENABLED?:string;REMOTE_ORIGIN?:string;SUPABASE_URL?:string;SUPABASE_PUBLISHABLE_KEY?:string;
 LEDGERFLOW_DATABASE_URL?:string;LEDGERFLOW_REMOTE_ENCRYPTION_KEY?:string;LEDGERFLOW_DATABASE_CA_PEM?:string;
}
export function remoteConfigured(env:RemoteEnvironment){
 return env.REMOTE_ENABLED==='true'&&Boolean(env.REMOTE_ORIGIN&&env.SUPABASE_URL&&env.SUPABASE_PUBLISHABLE_KEY&&
  env.LEDGERFLOW_DATABASE_URL&&env.LEDGERFLOW_REMOTE_ENCRYPTION_KEY&&env.LEDGERFLOW_DATABASE_CA_PEM);
}
export async function handleRemote(request:Request,environment:GatewayEnvironment&RemoteEnvironment):Promise<Response|undefined>{
 const path=new URL(request.url).pathname;
 if(!remoteConfigured(environment)){
  if(path==='/api/remote/config')return Response.json({available:false,reason:'REMOTE_DATABASE_SETUP_REQUIRED'},{headers:{'Cache-Control':'no-store'}});
  if(path==='/mcp'||path.startsWith('/oauth/')||path.startsWith('/.well-known/')||path.startsWith('/api/remote/'))
   return Response.json({error:'REMOTE_DATABASE_SETUP_REQUIRED'},{status:503,headers:{'Cache-Control':'no-store'}});
  return undefined;
 }
 const origin=environment.REMOTE_ORIGIN!;
 if(new URL(origin).protocol!=='https:'||new URL(origin).origin!==origin)throw new Error('REMOTE_ORIGIN_INVALID');
 const connection=new URL(environment.LEDGERFLOW_DATABASE_URL!);
 for(const key of ['sslmode','sslcert','sslkey','sslrootcert'])connection.searchParams.delete(key);
 const pool=new pg.Pool({connectionString:connection.href,max:2,connectionTimeoutMillis:8000,statement_timeout:30000,
  ssl:{rejectUnauthorized:true,ca:environment.LEDGERFLOW_DATABASE_CA_PEM!}});
 pool.on('error',()=>{ /* Driver details must not be exposed or logged. */ });
 try{
  const upstream:typeof fetch=(url,init)=>{const headers=new Headers(init?.headers);headers.set('Accept','application/json');
   headers.set('User-Agent','LedgerFlow-Public-References/0.1 (+https://github.com/osh3772-star/ledgerflow-ai)');return fetch(url,{...init,headers,redirect:'manual'});};
  const publicData=new PublicDataService({nts:environment.NTS_SERVICE_KEY,dart:environment.DART_API_KEY,law:environment.LAW_OC,ecos:environment.ECOS_API_KEY},'live',new PostgresApiCache(pool),upstream);
  const router=createRemoteRouter({pool,publicData,auth:{origin,supabaseUrl:environment.SUPABASE_URL!,publishableKey:environment.SUPABASE_PUBLISHABLE_KEY!,encryptionKey:environment.LEDGERFLOW_REMOTE_ENCRYPTION_KEY!},assets:environment.WEB_ASSETS!});
  return await router(request);
 }catch{return Response.json({error:'REMOTE_SERVICE_UNAVAILABLE'},{status:503,headers:{'Cache-Control':'no-store'}});}
 finally{await pool.end();}
}
