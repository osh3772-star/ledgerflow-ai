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
import {GuestLearning,guestCookie} from './guest-learning.js';
import {randomBytes} from 'node:crypto';
import {learningBundleSchema,createBootstrapFiles} from './learning-bootstrap.js';
import {PersonalLearning} from './personal-learning.js';

export const REMOTE_PATHS=['/mcp','/oauth/','/.well-known/','/api/remote/'];
export async function boundedBody(request:Request,max=16384){
  const reader=request.body?.getReader();if(!reader)throw new Error('BODY_REQUIRED');
  const chunks:Uint8Array[]=[];let size=0;while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.length;
    if(size>max){await reader.cancel();throw new Error('BODY_TOO_LARGE');}chunks.push(chunk.value);}
  return Buffer.concat(chunks).toString('utf8');
}
const cookie=(value:string,clear=false)=>'lf_remote='+value+'; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age='+(clear?'0':'604800');
const json=(data:unknown,status=200,headers:Record<string,string>={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive',...headers}});
export function createRemoteRouter(options:{pool:Pool;auth:RemoteAuthConfiguration;publicData:PublicDataClient;assets:{fetch:(request:Request)=>Promise<Response>};authFetch?:typeof fetch}){
  const auth=new RemoteAuth(options.pool,options.auth,options.authFetch);
  const google=new RemoteGoogleAuth(auth);
  const guest=new GuestLearning(options.pool,options.auth.origin,options.auth.encryptionKey,options.publicData);
  const personal=new PersonalLearning(options.pool,options.auth.origin,options.auth.encryptionKey,guest);
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
      if(path==='/api/remote/config'&&request.method==='GET')return json({available:true,mcpUrl:resource,authentication:'guest_capability_or_google_supabase_pkce',tenantMode:'isolated_guest_or_per_user_company',guest:{enabled:true,ttlSeconds:86400,provisionUrl:origin+'/api/remote/guest'},googleLogin:await google.configuration()});
      if(path==='/api/remote/bootstrap'){
        if(request.method!=='GET')return json({error:'METHOD_NOT_ALLOWED'},405);
        if(request.headers.get('origin')&&request.headers.get('origin')!==origin)return json({error:'SAME_ORIGIN_REQUIRED'},403);
        if(request.headers.get('purpose')==='prefetch'||request.headers.get('sec-purpose')?.includes('prefetch'))return json({error:'PREFETCH_NOT_ALLOWED'},400);
        const params=z.strictObject({client:z.enum(['codex','claude','antigravity']),requestId:z.uuid(),claimCode:z.string().regex(/^[A-Za-z0-9_-]{43}$/u).optional(),bootstrapKey:z.string().regex(/^[A-Za-z0-9_-]{43}$/u).optional(),guestToken:z.string().regex(/^lf_guest_[A-Za-z0-9_-]{43}$/u).optional()}).parse(Object.fromEntries(url.searchParams));
        const asset=await options.assets.fetch(new Request(origin+'/learning-bundle.json'));
        if(!asset.ok)return json({error:'LEARNING_BUNDLE_UNAVAILABLE'},503);
        const bundle=learningBundleSchema.parse(await asset.json());
        if(!params.claimCode&&(params.bootstrapKey||params.guestToken))return json({error:'CLAIM_CODE_REQUIRED'},400);
        if(params.claimCode&&!params.bootstrapKey)return json({error:'BOOTSTRAP_KEY_REQUIRED'},400);
        // A signed-in browser may never silently allocate a different company.
        if(!params.claimCode&&await auth.browser(request))return json({error:'PERSONAL_SETUP_REQUIRED'},409);
        const bootstrapKey=params.bootstrapKey??randomBytes(32).toString('base64url');
        const created=params.claimCode?await personal.redeem({claimCode:params.claimCode,bootstrapKey,client:params.client,guestToken:params.guestToken}):await guest.provision({bootstrapKey});
        const prepared=createBootstrapFiles(bundle,params.client,origin+'/mcp/'+(params.claimCode?'p/':'g/')+created.token);
        prepared.files['.ledgerflow/guest-session.json']=JSON.stringify({bootstrapKey,token:created.token,companyId:created.companyId,expiresAt:created.expiresAt,mode:params.claimCode?'personal':'guest'});
        prepared.sensitivePaths.push('.ledgerflow/guest-session.json');
        prepared.mergePolicies['.ledgerflow/guest-session.json']='replace_owned_private_session';
        return json({version:1,server:'ledgerflow-accounting-mcp',companyId:created.companyId,expiresAt:created.expiresAt,
          identityMode:params.claimCode?'personal':'guest',...prepared,
          verification:{nativeClientVerified:false,nextTools:['get_system_status','get_company_context']},
          security:'세션 URL은 비밀이다. 응답을 공개하거나 URL을 채팅에 출력하지 말고 현재 폴더의 비공개 MCP 설정에만 기록한다.'});
      }
      if(path==='/api/remote/guest'&&request.method==='POST'){
        if(!request.headers.get('content-type')?.startsWith('application/json')||request.headers.get('origin')&&request.headers.get('origin')!==origin)return json({error:'INVALID_REQUEST'},403);
        if(await auth.browser(request))return json({error:'PERSONAL_SETUP_REQUIRED'},409);
        const created=await guest.provision(JSON.parse(await boundedBody(request)));
        return json({token:created.token,mcpUrl:created.mcpUrl,companyId:created.companyId,expiresAt:created.expiresAt,reused:created.reused},created.reused?200:201);
      }
      if(path==='/api/remote/claim'&&request.method==='POST'){
        if(!request.headers.get('content-type')?.startsWith('application/json')||request.headers.get('origin')&&request.headers.get('origin')!==origin)return json({error:'INVALID_REQUEST'},403);
        return json(await personal.redeem(JSON.parse(await boundedBody(request))));
      }
      if(path==='/api/remote/guest-review/open'&&request.method==='POST'){
        if(request.headers.get('origin')!==origin||request.headers.get('sec-fetch-site')!=='same-origin'||!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'SAME_ORIGIN_REQUIRED'},403);
        const opened=await guest.openReview(JSON.parse(await boundedBody(request)));
        return json({ready:true,csrf:opened.csrf},200,{'Set-Cookie':guestCookie(opened.token),'Referrer-Policy':'no-referrer'});
      }
      if(path==='/api/remote/login'||path==='/api/remote/signup')return json({error:'GOOGLE_LOGIN_REQUIRED'},410);
      if(path==='/api/remote/google/start'){
        if(request.method!=='POST'||request.headers.get('origin')!==origin||!request.headers.get('content-type')?.startsWith('application/json'))return json({error:'SAME_ORIGIN_REQUIRED'},403);
        const body=z.strictObject({returnTo:z.string().default('/'),claimGuest:z.boolean().optional()}).parse(JSON.parse(await boundedBody(request)));
        const browser=body.claimGuest?await guest.browser(request):undefined;
        if(body.claimGuest&&!browser)throw new DomainError('GUEST_EXPIRED','보관할 임시 장부를 확인하세요.');
        const flow=await google.begin({returnTo:body.returnTo},browser?.workspace.id);
        return json({redirect:flow.redirect},200,{'Set-Cookie':googleCookie(flow.token)});
      }
      if(path==='/api/remote/google/callback'){
        if(request.method!=='GET')return json({error:'METHOD_NOT_ALLOWED'},405);
        const headers=new Headers({'Cache-Control':'no-store','Referrer-Policy':'no-referrer'});
        headers.append('Set-Cookie',googleCookie('',true));
        try{
          const login=await google.finish(request);
          try{if(login.claimGuestId)await guest.claim(login.claimGuestId,login.session.userId);else await provisionWorkspace(options.pool,login.session.userId);}
          catch(error){await options.pool.query('DELETE FROM private.remote_browser_sessions WHERE token_hash=$1',[digest(login.token)]);throw error;}
          headers.set('Location',origin+login.returnTo);headers.append('Set-Cookie',cookie(login.token));headers.append('Set-Cookie',guestCookie('',true));
        }catch{headers.set('Location',origin+'/?auth_error=google_failed');}
        return new Response(null,{status:303,headers});
      }
      if(path==='/mcp'||path.startsWith('/mcp/')){
        const pathToken=path.match(/^\/mcp\/(?:g\/(lf_guest_[A-Za-z0-9_-]{43})|p\/(lf_personal_[A-Za-z0-9_-]{43}))$/u)?.slice(1).find(Boolean);
        if(path!=='/mcp'&&!pathToken)return json({error:'INVALID_ENDPOINT'},400,cors);
        if(url.search)return json({error:'INVALID_ENDPOINT'},400,cors);
        if(request.method==='OPTIONS')return new Response(null,{status:204,headers:cors});
        const authorization=request.headers.get('authorization');
        const headerToken=authorization?authorization.match(/^Bearer (lf_(?:guest|personal)_[A-Za-z0-9_-]{43})$/u)?.[1]:request.headers.get('mcp-session-id')??undefined;
        if(pathToken&&(authorization&&authorization!=='Bearer '+pathToken||request.headers.has('mcp-session-id')&&request.headers.get('mcp-session-id')!==pathToken))return json({error:'GUEST_CREDENTIAL_MISMATCH'},403,cors);
        let inbound=request,guestToken=pathToken??headerToken;
        const linked=guestToken?await personal.resolve(guestToken):undefined;
        let workspace=guestToken?await guest.byToken(guestToken):undefined;
        if(guestToken&&!workspace&&!linked)return json({error:guestToken.startsWith('lf_guest_')?'GUEST_SESSION_EXPIRED':'PERSONAL_LINK_EXPIRED'},403,cors);
        if(!workspace&&!linked&&!request.headers.has('authorization')){
          if(await auth.browser(request))return json({error:'PERSONAL_SETUP_REQUIRED'},409,cors);
          if(request.method!=='POST')return json({error:'MCP_INITIALIZE_REQUIRED'},405,{...cors,Allow:'POST,OPTIONS'});
          const text=await boundedBody(request,65536),message=JSON.parse(text);
          if(message?.jsonrpc!=='2.0'||message?.method!=='initialize'||message.id===undefined)return json({error:'MCP_INITIALIZE_REQUIRED'},428,cors);
          const created=await guest.provision({bootstrapKey:randomBytes(32).toString('base64url')});workspace=created;guestToken=created.token;
          inbound=new Request(request,{body:text});
        }
        let dependencies:ReturnType<typeof remoteServices>;
        if(workspace)dependencies=guest.services(workspace,'mcp');
        else if(linked)dependencies=remoteServices(options.pool,linked,'mcp',options.publicData);
        else{
          const userId=await auth.bearer(request);if(!userId)return unauthorized();
          const row=(await options.pool.query('SELECT company_id,writer_id FROM private.remote_workspaces WHERE user_id=$1',[userId])).rows[0];
          if(!row)return unauthorized();
          dependencies=remoteServices(options.pool,{userId,companyId:row.company_id,writerId:row.writer_id},'mcp',options.publicData);
        }
        if(!workspace)dependencies.approvalLink=async journal=>origin+'/?journal='+encodeURIComponent(journal.id);
        dependencies.humanRouter=async()=>json({error:'HUMAN_WEB_ONLY'},403);
        const handler=createMcpHandler(()=>createLedgerFlowServer(dependencies),{legacy:'stateless',maxRequestBodySize:65536,maxSubscriptions:0,keepAliveMs:0,onerror:()=>{}});
        if(workspace||linked){const headers=new Headers(inbound.headers);headers.delete('mcp-session-id');inbound=new Request(new Request(resource,inbound),{headers});}
        try{const response=await handler.fetch(inbound),body=await response.arrayBuffer();
          return new Response(body,{status:response.status,headers:{...Object.fromEntries(response.headers),...cors,...(guestToken?{'Mcp-Session-Id':guestToken}:{}),'Cache-Control':'no-store','Referrer-Policy':'no-referrer','X-Robots-Tag':'noindex, nofollow, noarchive'}});
        }finally{await handler.close();}
      }
      // A verified Google session takes precedence over a stale guest cookie.
      const identity=await auth.browser(request);
      const guestBrowser=!identity||path.startsWith('/api/remote/guest-review')||path==='/api/remote/link-guest'?await guest.browser(request):undefined;
      if(path==='/api/remote/link-guest'){
        if(!identity)return json({error:'LOGIN_REQUIRED'},401);
        if(request.method!=='POST')return json({error:'METHOD_NOT_ALLOWED'},405);
        auth.csrf(request,identity);if(!guestBrowser)return json({error:'GUEST_EXPIRED'},400);
        await guest.claim(guestBrowser.workspace.id,identity.userId);
        return json({linked:true,companyId:(await provisionWorkspace(options.pool,identity.userId)).companyId},200,{'Set-Cookie':guestCookie('',true)});
      }
      if(guestBrowser){
        const dependencies=guest.services(guestBrowser.workspace,'human'),reader=dependencies.accounting!;
        if(path==='/api/remote/session'&&request.method==='GET')return json({signedIn:true,mode:'guest',companyId:guestBrowser.workspace.companyId,expiresAt:guestBrowser.workspace.expiresAt,csrf:guestBrowser.csrf});
        if(path==='/api/remote/workspace-status'&&request.method==='GET')return json(await personal.status(guestBrowser.workspace.companyId,guestBrowser.workspace.writerId));
        if(path==='/api/remote/guest-review'&&request.method==='GET')return json(await guest.review(guestBrowser));
        if(path==='/api/remote/connections'&&request.method==='GET')return json([]);
        if(request.method==='POST'){
          guest.csrf(request,guestBrowser);
          if(path==='/api/remote/guest-review/decision')return json(await guest.decide(guestBrowser,JSON.parse(await boundedBody(request))));
          if(path==='/api/remote/logout'){
            await options.pool.query('DELETE FROM private.guest_browser_sessions WHERE token_hash=$1',[digest(guestBrowser.token)]);
            return json({signedIn:false},200,{'Set-Cookie':guestCookie('',true)});
          }
          return json({error:'GUEST_REVIEW_PAGE_REQUIRED'},403);
        }
        if(path==='/api/human/session'&&request.method==='GET')return json({ready:true,csrf:guestBrowser.csrf});
        if(path.startsWith('/api/')&&!path.startsWith('/api/remote/')){
          const human=createHumanRouter({reader,accounting:()=>reader,companyId:guestBrowser.workspace.companyId,companyContext:dependencies.getCompanyContext,
           erp:dependencies.service as import('@ledgerflow/application-services').ErpService,publicApiConfiguration:()=>options.publicData.configuration()});
          const response=await human(request);
          return path==='/api/context'&&response.ok?json({...await response.json() as object,remoteWorkspace:true,guestWorkspace:true}):response;
        }
      }
      // Browser sessions never fall back to another tenant or the shared preview.
      if(path==='/api/remote/session'&&request.method==='GET')return json(identity?{signedIn:true,mode:'personal',companyId:(await provisionWorkspace(options.pool,identity.userId)).companyId,email:identity.email,csrf:identity.csrf}:{signedIn:false});
      if(!identity){if(path.startsWith('/api/remote/'))return json({error:'LOGIN_REQUIRED'},401);return undefined;}
      if(request.method!=='GET')auth.csrf(request,identity);
      if(path==='/api/remote/setup-ticket'&&request.method==='POST')return json(await personal.issue(identity.userId));
      if(path==='/api/remote/workspace-status'&&request.method==='GET'){
        const w=await provisionWorkspace(options.pool,identity.userId);return json(await personal.status(w.companyId,w.writerId));
      }
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
      if(path==='/api/remote/connections'&&request.method==='GET')return json((await options.pool.query(`SELECT g.id,c.name,g.created_at AS "createdAt",g.revoked FROM private.remote_oauth_grants g JOIN private.remote_oauth_clients c ON c.id=g.client_id WHERE g.user_id=$1
       UNION ALL SELECT id,name,created_at AS "createdAt",revoked FROM private.remote_learning_links WHERE user_id=$1 ORDER BY "createdAt" DESC LIMIT 50`,[identity.userId])).rows);
      if(path==='/api/remote/connections'&&request.method==='POST'){
        const {id}=z.strictObject({id:z.uuid()}).parse(JSON.parse(await boundedBody(request)));
        await options.pool.query('UPDATE private.remote_oauth_grants SET revoked=true WHERE id=$1 AND user_id=$2',[id,identity.userId]);
        await options.pool.query('UPDATE private.remote_learning_links SET revoked=true WHERE id=$1 AND user_id=$2',[id,identity.userId]);return json({revoked:true});
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
