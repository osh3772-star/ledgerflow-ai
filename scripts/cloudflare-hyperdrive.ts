import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createHash} from 'node:crypto';

const run=promisify(execFile);
export function hyperdriveConfiguration(environment:NodeJS.ProcessEnv,certificateId:string){
  const project=new URL(environment.SUPABASE_URL??'').hostname.match(/^([a-z0-9]{20})\.supabase\.co$/u)?.[1];
  const database=new URL(environment.LEDGERFLOW_DATABASE_URL??'');
  if(!project||!['postgres:','postgresql:'].includes(database.protocol)||database.hash)throw new Error('HYPERDRIVE_ORIGIN_INVALID');
  let user=decodeURIComponent(database.username);
  if(database.hostname.endsWith('.pooler.supabase.com')&&user.endsWith('.'+project))user=user.slice(0,-project.length-1);
  else if(database.hostname!=='db.'+project+'.supabase.co')throw new Error('HYPERDRIVE_ORIGIN_INVALID');
  if(!user||!database.password||database.pathname!=='/postgres'||database.port&&database.port!=='5432')throw new Error('HYPERDRIVE_ORIGIN_INVALID');
  return {name:'ledgerflow-'+project,origin:{scheme:'postgres',host:'db.'+project+'.supabase.co',port:5432,
    user,password:decodeURIComponent(database.password),database:'postgres'},
    caching:{disabled:true},mtls:{ca_certificate_id:certificateId,sslmode:'verify-full'},origin_connection_limit:5};
}

// Operator-only provisioning through the official authenticated Cloudflare API.
// Capture Wrangler credentials in memory: never print/persist them or pass DB
// passwords in OS arguments. Do not call this module from MCP or browser routes.
export async function ensureHyperdrive(wrangler:string,cwd:string,environment:NodeJS.ProcessEnv,ca:string){
  let account:string,token:string;
  try{
    const cli={cwd,windowsHide:true,timeout:15000,maxBuffer:65536,env:{...process.env,WRANGLER_WRITE_LOGS:'false'}};
    const details=JSON.parse((await run(process.execPath,[wrangler,'whoami','--json'],cli)).stdout);
    const accounts=details.accounts as {id:string}[];
    account=environment.CLOUDFLARE_ACCOUNT_ID??(accounts.length===1?accounts[0]!.id:'');
    if(!/^[a-f0-9]{32}$/u.test(account)||!accounts.some(item=>item.id===account))throw new Error();
    const credentials=JSON.parse((await run(process.execPath,[wrangler,'auth','token','--json'],cli)).stdout);
    if(!['oauth','api_token'].includes(credentials.type)||typeof credentials.token!=='string'||!credentials.token)throw new Error();
    token=credentials.token;
  }catch{throw new Error('HYPERDRIVE_CLOUDFLARE_AUTH_REQUIRED');}
  const api=async(path:string,body?:unknown,method=body?'POST':'GET')=>{
    let response:Response,value:{success?:boolean;result?:unknown;errors?:{code?:unknown}[]};
    try{
      response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+account+path,{method,
        headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),
        redirect:'error',signal:AbortSignal.timeout(45000)});
      value=await response.json() as typeof value;
    }catch{throw new Error('HYPERDRIVE_API_UNAVAILABLE');}
    if(!response.ok||value.success!==true){
      // Numeric provider codes contain no connection URL/password/provider text.
      const code=value.errors?.[0]?.code;
      throw new Error('HYPERDRIVE_API_'+(typeof code==='number'&&Number.isSafeInteger(code)?String(code):'REJECTED'));
    }
    return value.result;
  };
  const certificateName='ledgerflow-supabase-ca-'+createHash('sha256').update(ca).digest('hex').slice(0,12);
  const certificates=await api('/mtls_certificates?name='+certificateName) as {id:string;ca?:boolean}[];
  if(certificates.length>1)throw new Error('HYPERDRIVE_CERTIFICATE_AMBIGUOUS');
  const certificate=certificates[0]??await api('/mtls_certificates',{name:certificateName,certificates:ca,ca:true}) as {id:string};
  if(!certificate?.id)throw new Error('HYPERDRIVE_CERTIFICATE_INVALID');
  const configuration=hyperdriveConfiguration(environment,certificate.id);
  const configurations=await api('/hyperdrive/configs') as {id:string;name:string;origin?:{host?:string;user?:string;database?:string}}[];
  const matching=configurations.filter(item=>item.name===configuration.name);
  if(matching.length>1)throw new Error('HYPERDRIVE_CONFIGURATION_AMBIGUOUS');
  const existing=matching[0];
  if(existing&&(existing.origin?.host!==configuration.origin.host||existing.origin?.user!==configuration.origin.user||existing.origin?.database!==configuration.origin.database))
    throw new Error('HYPERDRIVE_ORIGIN_MISMATCH');
  const result=await api('/hyperdrive/configs'+(existing?'/'+existing.id:''),configuration,existing?'PUT':'POST') as {id:string;caching?:{disabled?:boolean};mtls?:{sslmode?:string;ca_certificate_id?:string}};
  if(!/^[a-f0-9]{32}$/u.test(result?.id)||result.caching?.disabled!==true||result.mtls?.sslmode!=='verify-full'||result.mtls?.ca_certificate_id!==certificate.id)
    throw new Error('HYPERDRIVE_CONFIGURATION_UNVERIFIED');
  return {id:result.id,cachingDisabled:true,tlsMode:'verify-full',credentialsPrinted:false};
}
