import {createHash,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import {DomainError} from '@ledgerflow/contracts';
import {API_TOOLS,PublicDataService,PublicProviderRejection,publicInputs,type ApiCache,type CacheRecord} from '@ledgerflow/public-data';
import {createPublicSiteRouter,type WebAssets} from './public-site.js';
import {handleRemote,remoteConfigured,type RemoteEnvironment} from './remote-worker.js';

export interface GatewayEnvironment extends RemoteEnvironment{
  WEB_ASSETS?:WebAssets;
  REMOTE_RATE_LIMITER?:{limit(input:{key:string}):Promise<{success:boolean}>};
  AUTH_RATE_LIMITER?:{limit(input:{key:string}):Promise<{success:boolean}>};
  NTS_SERVICE_KEY:string;DART_API_KEY:string;LAW_OC:string;ECOS_API_KEY:string;GATEWAY_ACCESS_TOKEN:string;
  REFERENCE_RATE_LIMITER:{limit(input:{key:string}):Promise<{success:boolean}>};
}
type EdgeCache={match:(key:string)=>Promise<Response|undefined>;put:(key:string,response:Response)=>Promise<void>};
export class EdgeApiCache implements ApiCache{
  constructor(private cache:EdgeCache){}
  private url(key:string){if(!/^[a-f0-9]{64}$/u.test(key))throw new Error('CACHE_KEY_INVALID');return 'https://public-reference-cache.invalid/'+key;}
  async get(key:string):Promise<CacheRecord|null>{const response=await this.cache.match(this.url(key));return response?await response.json() as CacheRecord:null;}
  async put(key:string,_provider:Parameters<ApiCache['put']>[1],row:CacheRecord){await this.cache.put(this.url(key),Response.json(row,{headers:{'Cache-Control':'max-age='+Math.max(1,Math.floor((Date.parse(row.expiresAt)-Date.now())/1000))}}));}
}
export function createReferenceGateway(options:{cache:ApiCache;fetcher?:typeof fetch;log?:(event:Record<string,unknown>)=>void}){
  let instance:{fingerprint:string;service:PublicDataService}|undefined;
  const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  const hash=(value:string)=>createHash('sha256').update(value).digest();
  return {async fetch(request:Request,environment:GatewayEnvironment):Promise<Response>{
    const path=new URL(request.url).pathname;
    if(request.method==='GET'&&path==='/health')return reply({service:'public-reference-gateway',mcpServer:false,ledgerAccess:false});
    if(path!=='/v1/query'||request.method!=='POST')return reply({ok:false,error:{code:'NOT_FOUND'}},404);
    const secret=environment.GATEWAY_ACCESS_TOKEN??'';
    if(secret.length<32||['NTS_SERVICE_KEY','DART_API_KEY','LAW_OC','ECOS_API_KEY'].some(name=>!environment[name as keyof GatewayEnvironment]))
      return reply({ok:false,error:{code:'GATEWAY_NOT_CONFIGURED'}},503);
    const token=request.headers.get('authorization')?.match(/^Bearer (.+)$/u)?.[1]??'';
    if(!timingSafeEqual(hash(secret),hash(token)))return reply({ok:false,error:{code:'UNAUTHORIZED'}},401);
    if(!environment.REFERENCE_RATE_LIMITER)return reply({ok:false,error:{code:'RATE_LIMITER_NOT_CONFIGURED'}},503);
    const quota=await environment.REFERENCE_RATE_LIMITER.limit({key:hash(token+'\0'+(request.headers.get('cf-connecting-ip')??'unknown')).toString('hex')});
    if(!quota.success)return reply({ok:false,error:{code:'RATE_LIMITED'}},429);
    let tool:typeof API_TOOLS[number]|undefined;const started=Date.now();
    try{
      if(!request.headers.get('content-type')?.startsWith('application/json'))throw new DomainError('INVALID_INPUT','JSON 요청이 필요합니다.');
      const reader=request.body?.getReader();if(!reader)throw new DomainError('INVALID_INPUT','본문이 필요합니다.');
      let size=0;const chunks:Uint8Array[]=[];
      while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>16384){await reader.cancel();throw new DomainError('INVALID_INPUT','본문 제한입니다.');}chunks.push(part.value);}
      const parsed=z.strictObject({tool:z.enum(API_TOOLS),input:z.unknown()}).parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      tool=parsed.tool;const input=publicInputs[tool].parse(parsed.input);
      const keys={nts:environment.NTS_SERVICE_KEY,dart:environment.DART_API_KEY,law:environment.LAW_OC,ecos:environment.ECOS_API_KEY};
      const fingerprint=hash(JSON.stringify(keys)).toString('hex');
      // workerd rejects redirect:'error'. Manual mode plus the adapter's !ok
      // check preserves the no-redirect boundary without forwarding credentials.
      // Also keep global fetch from becoming a method of PublicDataService.
      const upstream:typeof fetch=(input,init)=>{
        const headers=new Headers(init?.headers);
        headers.set('Accept','application/json');
        headers.set('User-Agent','LedgerFlow-Public-References/0.1 (+https://github.com/osh3772-star/ledgerflow-ai)');
        return (options.fetcher??fetch)(input,{...init,headers,redirect:'manual'});
      };
      if(instance?.fingerprint!==fingerprint)instance={fingerprint,service:new PublicDataService(keys,'live',options.cache,upstream)};
      const data=await instance.service.call(tool,input);
      options.log?.({tool,outcome:'success',durationMs:Date.now()-started});return reply({ok:true,data});
    }catch(error){const code=error instanceof PublicProviderRejection&&error.provider==='dart'&&error.serviceCode?'DART_'+error.serviceCode:
        error instanceof PublicProviderRejection&&error.httpStatus?'PROVIDER_HTTP_'+error.httpStatus:
        error instanceof DomainError&&/^[A-Z0-9_]+$/u.test(error.code)?error.code:'INVALID_INPUT';
      options.log?.({tool:tool??'invalid',outcome:'error',code,durationMs:Date.now()-started});
      return reply({ok:false,error:{code,...(error instanceof PublicProviderRejection&&error.redirectTarget?{redirectTarget:error.redirectTarget}:{})}},code==='INVALID_INPUT'?400:502);
    }
  }};
}
let gateway:ReturnType<typeof createReferenceGateway>|undefined;
const publicSite=createPublicSiteRouter();
export default {async fetch(request:Request,environment:GatewayEnvironment){
  const path=new URL(request.url).pathname;
  if(path==='/health'&&request.method==='GET'&&remoteConfigured(environment))
    return Response.json({service:'ledgerflow-accounting-mcp',remoteConfigured:true,ledgerAccess:'authenticated_per_user',databaseProbePerformed:false},{headers:{'Cache-Control':'no-store'}});
  if(path.startsWith('/api/')||path.startsWith('/oauth/')||path.startsWith('/.well-known/')||path==='/mcp'||path.startsWith('/mcp/')){
    if(environment.REMOTE_ENABLED==='true'&&path!=='/api/remote/config'){
      const authRoute=path.startsWith('/oauth/')||path.startsWith('/api/remote/google/')||['/api/remote/bootstrap','/api/remote/claim','/api/remote/setup-ticket','/api/remote/client-setup/issue','/api/remote/client-setup/open','/api/remote/login','/api/remote/signup','/api/remote/guest','/api/remote/guest-review/open'].includes(path)||path==='/mcp'&&!request.headers.has('authorization')&&!request.headers.has('mcp-session-id');
      const limiter=authRoute?environment.AUTH_RATE_LIMITER:environment.REMOTE_RATE_LIMITER;
      if(!limiter)return Response.json({error:'REMOTE_RATE_LIMITER_REQUIRED'},{status:503});
      if(!(await limiter.limit({key:createHash('sha256').update(request.headers.get('cf-connecting-ip')??'unknown').digest('hex')})).success)
        return Response.json({error:'RATE_LIMITED'},{status:429,headers:{'Retry-After':'60','Cache-Control':'no-store'}});
    }
    const response=await handleRemote(request,environment);if(response)return response;
    if(path.startsWith('/api/')&&environment.WEB_ASSETS)return publicSite(request,environment.WEB_ASSETS);
  }
  if(!gateway){const cache=(globalThis as unknown as {caches:{default:EdgeCache}}).caches.default;
    gateway=createReferenceGateway({cache:new EdgeApiCache(cache),log:event=>console.log(JSON.stringify(event))});}
  return gateway.fetch(request,environment);
}};
