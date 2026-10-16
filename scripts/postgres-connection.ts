import {readFile,stat} from 'node:fs/promises';
import {X509Certificate} from 'node:crypto';
import type {PoolConfig} from 'pg';

export function isHostedSupabaseDatabase(host:string){
  return /^db\.[a-z0-9]{20}\.supabase\.co$/u.test(host)
    || /^[a-z0-9.-]+\.pooler\.supabase\.com$/u.test(host);
}

// Shared by the persistent runtime and its explicit read-only connection check.
// URL ssl options can overwrite pg's ssl object, so hosted connections use
// explicit fields and always verify both the CA and hostname.
export async function databasePoolOptions(environment:NodeJS.ProcessEnv):Promise<PoolConfig>{
  let url:URL;
  try{
    url=new URL(environment.LEDGERFLOW_DATABASE_URL??'');
    if(!['postgres:','postgresql:'].includes(url.protocol)||url.hash)throw new Error();
  }catch{throw new Error('DATABASE_URL_INVALID');}
  const common={max:4,application_name:'ledgerflow-mcp',connectionTimeoutMillis:10_000,
    statement_timeout:10_000,query_timeout:15_000};
  if(!isHostedSupabaseDatabase(url.hostname))return {...common,connectionString:url.href};
  for(const [name,value] of url.searchParams){
    if(name==='sslmode'&&['require','verify-ca','verify-full'].includes(value))continue;
    if(name==='sslrootcert'&&value)continue;
    throw new Error('HOSTED_DATABASE_TLS_OPTIONS_INVALID');
  }
  let ca:string|undefined;
  const file=environment.LEDGERFLOW_DATABASE_CA_FILE?.trim()||url.searchParams.get('sslrootcert');
  if(file){
    try{
      if(!/\.(?:crt|cer|pem)$/iu.test(file)||(await stat(file)).size>131072)throw new Error();
      ca=await readFile(file,'utf8');
      if(!ca.includes('-----BEGIN CERTIFICATE-----'))throw new Error();
      new X509Certificate(ca);
    }catch{throw new Error('DATABASE_CA_INVALID');}
  }
  try{
    return {...common,host:url.hostname,port:Number(url.port||5432),
      user:decodeURIComponent(url.username),password:decodeURIComponent(url.password),
      database:decodeURIComponent(url.pathname.slice(1)),ssl:{rejectUnauthorized:true,...(ca?{ca}:{})}};
  }catch{throw new Error('DATABASE_URL_INVALID');}
}
