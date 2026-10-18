import {beforeAll,afterAll,describe,it,expect} from 'vitest';
import {mkdir,mkdtemp,readFile,writeFile,rm,symlink} from 'node:fs/promises';
import {resolve,join,sep,parse} from 'node:path';
import {pathToFileURL} from 'node:url';

const server='ledgerflow-accounting-mcp',companyId='11111111-1111-4111-8111-111111111111',token='lf_personal_'+'a'.repeat(43);
const url='https://ledgerflow-public-reference-gateway.eric5833.workers.dev/mcp/p/'+token;
let connector:any,root:string;const base=resolve('.ledgerflow/tmp');
beforeAll(async()=>{connector=await import(pathToFileURL(resolve('scripts/connect-codex.mjs')).href);await mkdir(base,{recursive:true});root=await mkdtemp(join(base,'codex-native-'));});
afterAll(async()=>{if(!root.startsWith(base+sep))throw new Error('UNOWNED_TEST_PATH');await rm(root,{recursive:true,force:true});});
function runtime(options:{company?:string;missingTools?:boolean;failure?:string;approval?:boolean;policy?:Record<string,unknown>}={}){
 const commands:string[][]=[],requests:any[]=[],writes:any[]=[];let closed=false;
 const run=async(args:string[])=>{commands.push(args);return {code:0,stdout:JSON.stringify({name:server,enabled:true,transport:{type:'streamable_http',url}})};};
 const open=async()=>{
  if(options.failure)throw Object.assign(new Error(),{code:options.failure});
  return {close:()=>{closed=true;},rpc:async(method:string,params:any)=>{
   requests.push({method,params});if(options.approval)throw Object.assign(new Error(),{code:'HOST_APPROVAL_REQUIRED'});
   if(method==='config/mcpServer/reload')return {};
   if(method==='mcpServerStatus/list')return {data:[{name:server,tools:options.missingTools?{}:{get_system_status:{},get_company_context:{}}}],nextCursor:null};
   if(method==='mcpServer/tool/call')return {structuredContent:{ok:true,data:params.tool==='get_system_status'?{server,tools:['get_system_status','get_company_context']}:{companyId:options.company??companyId}},content:[]};
   throw new Error('UNEXPECTED_METHOD');
  }};
 };
 const write=async()=>({close:()=>{},rpc:async(method:string,params:any)=>{writes.push({method,params});return method==='config/read'?{config:{mcp_servers:{[server]:options.policy??{}}}}:{};}});
 return {run,open,write,commands,requests,writes,isClosed:()=>closed};
}
describe('one-shot automatic Codex registration uses the existing app and current thread',()=>{
 it('registers only the owned server and verifies both tools through the active thread',async()=>{
  const r=runtime(),result=await connector.registerAndVerifyCodex({cwd:root,url,companyId,threadId:'current-thread',run:r.run,open:r.open,write:r.write});
  expect(r.commands.map(args=>args.slice(0,3))).toEqual([['mcp','get',server],['mcp','get',server]]);
  expect(r.writes).toEqual([{method:'config/read',params:{includeLayers:false}},{method:'config/batchWrite',params:{edits:[
   {keyPath:'projects',mergeStrategy:'upsert',value:{[root]:{trust_level:'trusted'}}},
   {keyPath:'mcp_servers.'+server,mergeStrategy:'replace',value:{url,enabled:true,required:false,startup_timeout_sec:90,tool_timeout_sec:90}}
  ],reloadUserConfig:false}}]);
  expect(r.requests[0]).toEqual({method:'config/mcpServer/reload',params:null});
  expect(r.requests.filter(v=>v.method==='mcpServer/tool/call').map(v=>v.params)).toEqual([
   {threadId:'current-thread',server,tool:'get_system_status',arguments:{}},{threadId:'current-thread',server,tool:'get_company_context',arguments:{}}]);
  expect(result).toMatchObject({status:'connected',configurationRegistered:true,workspaceTrusted:true,trustScope:'current_learning_folder',nativeClientVerified:true,sameCompanyVerified:true,companyId,accountingMutations:0,paidModelCalls:0});
  expect(JSON.stringify(result)).not.toContain(token);expect(r.isClosed()).toBe(true);
 });
 it('never substitutes a new daemon/SDK probe when the app control connection is unavailable',async()=>{
  const r=runtime({failure:'CODEX_CONTROL_UNAVAILABLE'}),result=await connector.registerAndVerifyCodex({cwd:root,url,companyId,threadId:'current-thread',run:r.run,open:r.open,write:r.write});
  expect(result).toMatchObject({status:'registered_refresh_pending',configurationRegistered:true,nativeClientVerified:false,nativeRefreshQueued:false,reason:'CODEX_CONTROL_UNAVAILABLE'});
  expect(r.commands.every(args=>args[0]==='mcp')).toBe(true);expect(r.requests).toEqual([]);
 });
 it('preserves existing tool restrictions and human app approval policy while replacing transport credentials',async()=>{
  const policy={enabled_tools:['get_system_status','get_company_context'],disabled_tools:['create_transaction'],default_tools_approval_mode:'prompt',tools:{post_journal_entry:{approval_mode:'approve'}},http_headers:{Authorization:'old-key'}};
  const r=runtime({policy,failure:'CODEX_CONTROL_UNAVAILABLE'});
  await connector.registerAndVerifyCodex({cwd:root,url,companyId,run:r.run,open:r.open,write:r.write});
  const written=r.writes.find(v=>v.method==='config/batchWrite').params.edits.find((v:{keyPath:string})=>v.keyPath==='mcp_servers.'+server).value;
  expect(written).toMatchObject({enabled_tools:policy.enabled_tools,disabled_tools:policy.disabled_tools,default_tools_approval_mode:'prompt',tools:policy.tools,url});
  expect(written.http_headers).toBeUndefined();expect(r.writes.every(v=>['config/read','config/batchWrite'].includes(v.method))).toBe(true);
 });
 it('does not report success for a queued refresh, missing current thread or required host approval',async()=>{
  for(const options of [{missingTools:true},{approval:true},{}]){
   const r=runtime(options),result=await connector.registerAndVerifyCodex({cwd:root,url,companyId,...(Object.keys(options).length?{threadId:'current-thread'}:{}),run:r.run,open:r.open,write:r.write});
   expect(result.nativeClientVerified).toBe(false);expect(result.status).toBe('registered_refresh_pending');expect(r.isClosed()).toBe(true);
  }
 });
 it('rejects a different company instead of replacing the session or touching journals',async()=>{
  const r=runtime({company:'22222222-2222-4222-8222-222222222222'});
  await expect(connector.registerAndVerifyCodex({cwd:root,url,companyId,threadId:'current-thread',run:r.run,open:r.open,write:r.write})).rejects.toHaveProperty('code','NATIVE_COMPANY_MISMATCH');
  expect(r.requests.filter(v=>v.method==='mcpServer/tool/call').every(v=>['get_system_status','get_company_context'].includes(v.params.tool))).toBe(true);
 });
 it('fails on a project override and never loosens permission policy',async()=>{
  const r=runtime();const run=async(args:string[])=>{const v=await r.run(args);return args[1]==='get'?{code:0,stdout:JSON.stringify({enabled:true,transport:{type:'streamable_http',url:'http://127.0.0.1:8787/mcp'}})}:v;};
  await expect(connector.registerAndVerifyCodex({cwd:root,url,companyId,threadId:'current-thread',run,open:r.open,write:r.write})).rejects.toHaveProperty('code','CODEX_CONFIG_PRECEDENCE_CONFLICT');
  expect(r.requests).toEqual([]);
 });
 it('rejects broad drive/home trust and upserts only the current learning folder',async()=>{
  const r=runtime();
  await expect(connector.registerAndVerifyCodex({cwd:parse(resolve(root)).root,url,companyId,run:r.run,open:r.open,write:r.write})).rejects.toHaveProperty('code','BROAD_TRUST_SCOPE_REJECTED');
  expect(r.writes).toEqual([]);
  const {homedir}=await import('node:os');
  await expect(connector.registerAndVerifyCodex({cwd:homedir(),url,companyId,run:r.run,open:r.open,write:r.write})).rejects.toHaveProperty('code','BROAD_TRUST_SCOPE_REJECTED');
  await connector.registerAndVerifyCodex({cwd:root,url,companyId,run:r.run,open:r.open,write:r.write});
  const trust=r.writes.find(v=>v.method==='config/batchWrite').params.edits.find((v:{keyPath:string})=>v.keyPath==='projects');
  expect(trust).toEqual({keyPath:'projects',mergeStrategy:'upsert',value:{[root]:{trust_level:'trusted'}}});
  expect(JSON.parse(await readFile(join(root,'.ledgerflow/codex-project-trust-before.json'),'utf8'))).toEqual({path:root,previous:null});
 });
 it('reads only the existing private learning session and never allocates a guest',async()=>{
  const cwd=join(root,'learner');await mkdir(join(cwd,'.ledgerflow'),{recursive:true});await mkdir(join(cwd,'.codex'),{recursive:true});
  await writeFile(join(cwd,'.ledgerflow/guest-session.json'),JSON.stringify({token,companyId,mode:'personal',expiresAt:'2099-01-01T00:00:00Z'}));
  await writeFile(join(cwd,'.codex/config.toml'),`[mcp_servers.${server}]\nurl = ${JSON.stringify(url)}\n`);
  const r=runtime();expect((await connector.connectCodex({directory:cwd,threadId:'current-thread',expectedCompanyId:companyId,run:r.run,open:r.open,write:r.write})).nativeClientVerified).toBe(true);
  expect(JSON.parse(await readFile(join(cwd,'.ledgerflow/codex-connection-result.json'),'utf8')).companyId).toBe(companyId);
  await expect(connector.connectCodex({directory:cwd,expectedCompanyId:'wrong-company',run:r.run,open:r.open})).rejects.toHaveProperty('code','EXPECTED_COMPANY_MISMATCH');
  expect(r.commands).toHaveLength(2);
  await expect(connector.connectCodex({directory:join(root,'missing'),run:r.run,open:r.open})).rejects.toHaveProperty('code','EXISTING_LEARNING_SESSION_REQUIRED');
 });
});
