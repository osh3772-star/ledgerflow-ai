import type {Pool} from 'pg';
import {z} from 'zod';
import {createMcpHandler} from '@modelcontextprotocol/server';
import {DomainError} from '@ledgerflow/contracts';
import type {PublicDataClient} from '@ledgerflow/public-data';
import {createLedgerFlowServer} from './server.js';
import {RemoteAuth,digest,type RemoteAuthConfiguration} from './remote-auth.js';
import {provisionWorkspace} from './remote-workspace.js';
import {remoteServices} from './remote-services.js';
import {createHumanRouter} from './human-routes.js';
import {HUMAN_SESSION_TTL_MS} from './human-session-store.js';
import {RemoteGoogleAuth,googleCookie} from './remote-google-auth.js';

export const REMOTE_PATHS=['/mcp','/oauth/','/.well-known/','/api/remote/'];
export async function boundedBody(request:Request,max=16384){
  const reader=request.body?.getReader();if(!reader)throw new Error('BODY_REQUIRED');
  const chunks:Uint8Array[]=[];let size=0;while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;
    if(size>max){await reader.cancel();throw new Error('BODY_TOO_LARGE');}chunks.push(chunk.value);}
  return Buffer.concat(chunks).toString('utf8');
}
const cookie=(value:string,clear=false)=>'lf_remote='+value+'; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age='+(clear?'0':'604800');
const json=(data:unknown,status=200,headers:Record<string,string>={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
export function createRemoteRouter(options:{pool:Pool;auth:RemoteAuthConfiguration;publicData:PublicDataClient;assets:{fetch:(request:Request)=>Promise<Response>};authFetch?:typeof fetch}){
  const auth=new RemoteAuth(options.pool,options.auth,options.authFetch);
  const google=new RemoteGoogleAuth(auth);
  const origin=options.auth.origin,resource=origin+'/mcp';
  const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Authorization,Content-Type,MCP-Protocol-Version,MCP-Session-Id','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Expose-Headers':'WWW-Authenticate,MCP-Session-Id'};
  const unauthorized=()=>json({error:'MCP_LOGIN_REQUIRED'},401,{'WWW-Authenticate':'Bearer resource_metadata="'+origin+'/.well-known/oauth-protected-resource/mcp"',...cors});
  return async(request:Request):Promise<Response|undefined>=>{
    const url=new URL(request.url),path=url.pathname;
    if(url.origin!==origin)return json({error:'HOST_NOT_ALLOWED'},403);
    try{
      if(path.startsWith('/.well-known/')){
        if(request.method!=='GET'&&request.method!=='OPTIONS')return json({error:'METHOD_NOT_ALLOWED'},405,cors);
        if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
        if(['/.well-known/oauth-protected-resource','/.well-known/oauth-protected-resource/mcp'].includes(path))
          return json({resource,authorization_servers:[origin],scopes_supported:['ledgerflow'],bearer_methods_supported:['header']},200,cors);
        if(path==='/.well-known/oauth-authorization-server')return json({issuer:origin,authorization_endpoint:origin+'/oauth/authorize',token_endpoint:origin+'/oauth/token',
          registration_endpoint:origin+'/oauth/register',revocation_endpoint:origin+'/oauth/revoke',response_types_supported:['code'],grant_types_supported:['authorization_code','refresh_token'],
          token_endpoint_auth_methods_supported:['none'],code_challenge_methods_supported:['S256'],scopes_supported:['ledgerflow'],authorization_response_iss_parameter_supported:true},200,cors);
        return json({error:'NOT_FOUND'},404,cors);
      }
      if(path==='/oauth/register'&&request.method==='POST')return json(await auth.register(JSON.parse(await boundedBody(request))),201,cors);
      if(path==='/oauth/token'&&request.method==='POST'){
        if(!request.headers.get('content-type')?.startsWith('application/x-www-form-urlencoded'))return json({error:'invalid_request'},400,cors);
        try{return json(await auth.exchange(new URLSearchParams(await boundedBody(request))),200,cors);}
        catch{return json({error:'invalid_grant'},400,cors);}
      }
      if(path==='/oauth/revoke'&&request.method==='POST'){
        const data=new URLSearchParams(await boundedBody(request));
        await options.pool.query('UPDATE private.remote_oauth_grants SET revoked=true WHERE client_id=$1 AND (access_hash=$2 OR refresh_hash=$2)',[data.get('client_id'),digest(data.get('token')??'')]);
        return new Response(null,{status:200,headers:{...cors,'Cache-Control':'no-store'}});
      }
      if(path==='/oauth/authorize'&&request.method==='GET'){
        await auth.authorization(url);
        return options.assets.fetch(new Request(origin+'/',{headers:{Accept:'text/html'}}));
      }
      if(path==='/api/remote/config'&&request.method==='GET')return json({available:true,mcpUrl:resource,authentication:'google_supabase_pkce',tenantMode:'per_user_company',googleLogin:await google.configuration()});
      if(path==='/api/remote/login'||path==='/api/remote/signup')return json({error:'GOOGLE_LOGIN_REQUIRED'},410);
      if(path==='/api/remote/google/start'){
        if(request.method!=='POST'||request.headers.get('origin')!==origin||!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'SAME_ORIGIN_REQUIRED'},403);
        const flow=await google.begin(JSON.parse(await boundedBody(request)));
        return json({redirect:flow.redirect},200,{'Set-Cookie':googleCookie(flow.token)});
      }
      if(path==='/api/remote/google/callback'){
        if(request.method!=='GET')return json({error:'METHOD_NOT_ALLOWED'},405);
        const headers=new Headers({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
        headers.append('Set-Cookie',googleCookie('',true));
        try{
          const login=await google.finish(request);
          try{await provisionWorkspace(options.pool,login.session.userId);}
          catch(error){await options.pool.query('DELETE FROM private.remote_browser_sessions WHERE token_hash=$1',[digest(login.token)]);throw error;}
          headers.set('Location',origin+login.returnTo);headers.append('Set-Cookie',cookie(login.token));
        }catch{headers.set('Location',origin+'/?auth_error=google_failed');}
        return new Response(null,{status:303,headers});
      }
      if(path==='/mcp'){
        if(url.search)return json({error:'INVALID_ENDPOINT'},400,cors);
        if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
        const userId=await auth.bearer(request);if(!userId)return unauthorized();
        const row=(await options.pool.query('SELECT company_id,writer_id FROM private.remote_workspaces WHERE user_id=$1',[userId])).rows[0];
        if(!row)return unauthorized();
        const dependencies=remoteServices(options.pool,{userId,companyId:row.company_id,writerId:row.writer_id},'mcp',options.publicData);
        dependencies.humanRouter=async()=>json({error:'HUMAN_WEB_ONLY'},403);
        const handler=createMcpHandler(()=>createLedgerFlowServer(dependencies),{legacy:'stateless',maxRequestBodySize:65536,maxSubscriptions:0,keepAliveMs:0,onerror:()=>{}});
        try{const response=await handler.fetch(request),body=await response.arrayBuffer();
          return new Response(body,{status:response.status,headers:{...Object.fromEntries(response.headers),...cors,'Cache-Control':'no-store'}});
        }finally{await handler.close();}
      }
      // Browser sessions never fall back to another tenant or the shared preview.
      const identity=await auth.browser(request);
      if(path==='/api/remote/session'&&request.method==='GET')return json(identity?{signedIn:true,email:identity.email,csrf:identity.csrf}:{signedIn:false});
      if(!identity){if(path.startsWith('/api/remote/'))return json({error:'LOGIN_REQUIRED'},401);return undefined;}
      if(request.method!=='GET')auth.csrf(request,identity);
      if(path==='/api/remote/logout'&&request.method==='POST'){
        await options.pool.query('DELETE FROM private.remote_browser_sessions WHERE token_hash=$1',[digest(auth.cookie(request)!)]);
        return json({signedIn:false},200,{'Set-Cookie':cookie('',true)});
      }
      if(path==='/api/remote/authorization'){
        const target=z.string().max(10000).parse(url.searchParams.get('request'));
        const authorization=new URL(target,origin);if(authorization.origin!==origin||authorization.pathname!=='/oauth/authorize')throw new Error('INVALID_AUTHORIZATION_URL');
        const info=await auth.authorization(authorization);
        if(request.method==='GET')return json({clientName:info.clientName,redirectUri:info.request.redirect_uri});
        if(request.method==='POST')return json({redirect:await auth.consent(authorization,identity.userId)});
      }
      if(path==='/api/remote/connections'&&request.method==='GET')return json((await options.pool.query('SELECT g.id,c.name,g.created_at AS "createdAt",g.revoked FROM private.remote_oauth_grants g JOIN private.remote_oauth_clients c ON c.id=g.client_id WHERE g.user_id=$1 ORDER BY g.created_at DESC LIMIT 50',[identity.userId])).rows);
      if(path==='/api/remote/connections'&&request.method==='POST'){
        const {id}=z.strictObject({id:z.uuid()}).parse(JSON.parse(await boundedBody(request)));
        await options.pool.query('UPDATE private.remote_oauth_grants SET revoked=true WHERE id=$1 AND user_id=$2',[id,identity.userId]);return json({revoked:true});
      }
      if(path.startsWith('/api/remote/'))return json({error:'NOT_FOUND'},404);
      if(!path.startsWith('/api/'))return undefined;
      const workspace=await provisionWorkspace(options.pool,identity.userId),dependencies=remoteServices(options.pool,workspace,'human',options.publicData);
      const reader=dependencies.accounting!;
      const human=createHumanRouter({authentication:{verify:async token=>(await auth.verify(token)).userId},reader,accounting:()=>reader,companyId:workspace.companyId,
        companyContext:dependencies.getCompanyContext,erp:dependencies.service as import('@ledgerflow/application-services').ErpService,
        publicApiConfiguration:()=>options.publicData.configuration(),sessionStore:{kind:'memory',
          get:async token=>token===auth.cookie(request)?{userId:identity.userId,accessToken:identity.accessToken,csrf:identity.csrf,expires:Date.now()+HUMAN_SESSION_TTL_MS}:undefined,
          put:async()=>{throw new Error('REMOTE_SESSION_ALREADY_CREATED');},delete:async()=>{}}});
      const internal=new Request(request);internal.headers.set('cookie','lf_human='+auth.cookie(request));
      const response=await human(internal);
      if(path==='/api/context'&&response.ok)return json({...await response.json() as Record<string,unknown>,remoteWorkspace:true,humanSessionStore:'postgres'});
      return response;
    }catch(error){
      const code=error instanceof DomainError?error.code:'REMOTE_REQUEST_FAILED';
      return json({error:code},code==='FORBIDDEN'?403:['AUTH_FAILED','UNAUTHENTICATED','EMAIL_VERIFICATION_REQUIRED'].includes(code)?401:400);
    }
  };
}
