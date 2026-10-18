import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {readFile,writeFile,mkdir,lstat,rename,appendFile} from 'node:fs/promises';
import {resolve,join,parse} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomBytes} from 'node:crypto';
import {homedir} from 'node:os';

const SERVER='ledgerflow-accounting-mcp';
const ORIGIN='https://ledgerflow-public-reference-gateway.eric5833.workers.dev';
const fail=code=>Object.assign(new Error(code),{code});
async function safePath(path){
 let part=parse(resolve(path)).root;
 for(const name of resolve(path).slice(part.length).split(/[\\/]/u)){
  part=join(part,name);try{if((await lstat(part)).isSymbolicLink())throw fail('LINKED_INSTALL_PATH');}
  catch(error){if(error.code!=='ENOENT')throw error;}
 }
}
async function privateWrite(path,value){
 await safePath(path);await mkdir(resolve(path,'..'),{recursive:true,mode:0o700});
 const temporary=path+'.'+randomBytes(6).toString('hex');
 await writeFile(temporary,JSON.stringify(value,null,2)+'\n',{mode:0o600,flag:'wx'});await rename(temporary,path);
}
export async function runCodex(args,{cwd,timeoutMs=15000}={}){
 return new Promise((resolveCommand,reject)=>{
  const processHandle=spawn(process.env.LEDGERFLOW_CODEX_COMMAND||'codex',args,{cwd,windowsHide:true,shell:false,stdio:['ignore','pipe','pipe']});
  let output='',finished=false;
  const finish=(error,result)=>{if(finished)return;finished=true;clearTimeout(timer);if(error)reject(error);else resolveCommand(result);};
  const timer=setTimeout(()=>{processHandle.kill();finish(fail('CODEX_COMMAND_TIMEOUT'));},timeoutMs);
  processHandle.stdout.on('data',chunk=>{output+=chunk.toString('utf8');if(output.length>1048576){processHandle.kill();finish(fail('CODEX_OUTPUT_LIMIT'));}});
  processHandle.stderr.resume(); // Never echo URLs, headers, native config or driver errors.
  processHandle.on('error',()=>finish(fail('CODEX_COMMAND_UNAVAILABLE')));
  processHandle.on('close',code=>finish(null,{code,stdout:output}));
 });
}
async function openCodexRpc({cwd,timeoutMs=8000,args}){
 const processHandle=spawn(process.env.LEDGERFLOW_CODEX_COMMAND||'codex',args,{cwd,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
 const pending=new Map();let id=0,closed=false;
 const abort=code=>{closed=true;for(const entry of pending.values()){clearTimeout(entry.timer);entry.reject(fail(code));}pending.clear();};
 processHandle.stderr.resume();processHandle.stdin.on('error',()=>abort('CODEX_CONTROL_UNAVAILABLE'));
 processHandle.on('error',()=>abort('CODEX_CONTROL_UNAVAILABLE'));processHandle.on('exit',()=>abort('CODEX_CONTROL_UNAVAILABLE'));
 const lines=createInterface({input:processHandle.stdout});
 lines.on('line',line=>{
  if(line.length>1048576){abort('CODEX_OUTPUT_LIMIT');processHandle.kill();return;}
  let message;try{message=JSON.parse(line);}catch{return;}
  if(message.method&&message.id!==undefined){
   // This client never grants app permissions or responds to ledger approvals.
   processHandle.stdin.write(JSON.stringify({id:message.id,error:{code:-32601,message:'Interactive approval must remain in the host app.'}})+'\n');
   abort('HOST_APPROVAL_REQUIRED');return;
  }
  const entry=pending.get(message.id);if(!entry)return;clearTimeout(entry.timer);pending.delete(message.id);
  if(message.error)entry.reject(fail(message.error.code===-32601?'CODEX_METHOD_UNSUPPORTED':'CODEX_RPC_REJECTED'));else entry.resolve(message.result);
 });
 const rpc=(method,params,limit=timeoutMs)=>new Promise((resolveRpc,reject)=>{
  if(closed){reject(fail('CODEX_CONTROL_UNAVAILABLE'));return;}
  const requestId=++id,timer=setTimeout(()=>{pending.delete(requestId);reject(fail('CODEX_RPC_TIMEOUT'));},limit);
  pending.set(requestId,{resolve:resolveRpc,reject,timer});
  processHandle.stdin.write(JSON.stringify({id:requestId,method,params})+'\n');
 });
 const close=()=>{abort('CODEX_CONTROL_CLOSED');lines.close();processHandle.stdin.end();processHandle.kill();};
 try{await rpc('initialize',{clientInfo:{name:'ledgerflow-native-setup',title:'LedgerFlow automatic MCP registration',version:'1'}});
  processHandle.stdin.write(JSON.stringify({method:'initialized',params:{}})+'\n');return {rpc,close};
 }catch(error){close();throw error;}
}
export const openRunningCodex=options=>openCodexRpc({...options,args:['app-server','proxy']});
// Configuration-only official API process. No threads, MCP connections or model
// turns are created here; it can never serve as native verification evidence.
export const openConfigurationWriter=options=>openCodexRpc({...options,args:['app-server','--stdio']});
function resultData(response){
 let value=response?.structuredContent;
 if(!value)try{value=JSON.parse(response.content?.find(part=>part.type==='text')?.text);}catch{}
 if(response?.isError||value?.ok!==true)throw fail('NATIVE_TOOL_CALL_FAILED');return value.data;
}
export async function registerAndVerifyCodex({cwd,url,companyId,threadId,run=runCodex,open=openRunningCodex,write=openConfigurationWriter}){
 cwd=resolve(cwd);
 // A setup prompt authorizes this learning folder, never a drive/home wildcard.
 if(cwd===parse(cwd).root||cwd===resolve(homedir()))throw fail('BROAD_TRUST_SCOPE_REJECTED');
 const existing=await run(['mcp','get',SERVER,'--json'],{cwd});
 let oldEntry;if(existing.code===0){try{oldEntry=JSON.parse(existing.stdout);}catch{throw fail('CODEX_CONFIG_RESPONSE_INVALID');}}
 // The official API atomically owns this one configuration entry. mcp add is
 // deliberately not used: it may automatically start an unwanted OAuth login
 // after writing, even though this scoped path credential needs no OAuth.
 if(oldEntry)await privateWrite(join(cwd,'.ledgerflow/codex-server-before.json'),oldEntry);
 let writer;
 try{
  writer=await write({cwd});
  const config=(await writer.rpc('config/read',{includeLayers:false}))?.config??{};
  const current=config.mcp_servers?.[SERVER]??{};
  await privateWrite(join(cwd,'.ledgerflow/codex-project-trust-before.json'),{path:cwd,previous:config.projects?.[cwd]??null});
  // Credential/transport changes must not widen a user's tool or approval policy.
  const policy=Object.fromEntries(['enabled_tools','disabled_tools','default_tools_approval_mode','tools'].filter(key=>Object.hasOwn(current,key)).map(key=>[key,current[key]]));
  // Required startup stays in the learning project's config. The shared entry
  // is optional so an expired learning key cannot block unrelated Codex work.
  await writer.rpc('config/batchWrite',{edits:[
   {keyPath:'projects',mergeStrategy:'upsert',value:{[cwd]:{trust_level:'trusted'}}},
   {keyPath:'mcp_servers.'+SERVER,mergeStrategy:'replace',value:{...policy,url,enabled:true,required:false,startup_timeout_sec:90,tool_timeout_sec:90}}
  ],reloadUserConfig:false});
 }
 finally{writer?.close();}
 const after=await run(['mcp','get',SERVER,'--json'],{cwd});let entry;
 try{entry=JSON.parse(after.stdout);}catch{throw fail('CODEX_CONFIG_RESPONSE_INVALID');}
 if(after.code!==0||entry.enabled!==true||entry.transport?.type!=='streamable_http'||entry.transport.url!==url)
  throw fail('CODEX_CONFIG_PRECEDENCE_CONFLICT');
 const report={status:'registered_refresh_pending',companyId,configurationRegistered:true,workspaceTrusted:true,trustScope:'current_learning_folder',nativeRefreshQueued:false,nativeClientVerified:false,
  sameCompanyVerified:false,accountingMutations:0,paidModelCalls:0};
 let connection;
 try{
  connection=await open({cwd});await connection.rpc('config/mcpServer/reload',null);report.nativeRefreshQueued=true;
  if(!threadId){report.reason='CURRENT_THREAD_ID_UNAVAILABLE';return report;}
  let cursor=null,server;
  for(let page=0;page<8;page++){
   const catalog=await connection.rpc('mcpServerStatus/list',{threadId,detail:'toolsAndAuthOnly',limit:25,cursor},90000);
   server=catalog.data?.find(item=>item.name===SERVER);if(server||!catalog.nextCursor)break;cursor=catalog.nextCursor;
  }
  if(!server?.tools?.get_system_status||!server.tools.get_company_context){report.reason='CURRENT_THREAD_REFRESH_PENDING';return report;}
  const call=tool=>connection.rpc('mcpServer/tool/call',{threadId,server:SERVER,tool,arguments:{}},90000);
  const status=resultData(await call('get_system_status'));
  if(status.server!==SERVER||!Array.isArray(status.tools))throw fail('WRONG_NATIVE_SERVER');
  const context=resultData(await call('get_company_context'));
  if(context.companyId!==companyId)throw fail('NATIVE_COMPANY_MISMATCH');
  return {...report,status:'connected',nativeClientVerified:true,sameCompanyVerified:true,toolCount:Object.keys(server.tools).length,
   checks:{get_system_status:true,get_company_context:true},evidence:'Two read-only tools succeeded through the running Codex app-server and the current thread.'};
 }catch(error){
  if(['NATIVE_COMPANY_MISMATCH','WRONG_NATIVE_SERVER','NATIVE_TOOL_CALL_FAILED'].includes(error.code))throw error;
  report.reason=['CODEX_CONTROL_UNAVAILABLE','CODEX_METHOD_UNSUPPORTED','HOST_APPROVAL_REQUIRED','CODEX_RPC_TIMEOUT','CODEX_RPC_REJECTED','CODEX_OUTPUT_LIMIT'].includes(error.code)?error.code:'CODEX_CONTROL_UNAVAILABLE';return report;
 }finally{connection?.close();}
}
export async function connectCodex({directory=process.cwd(),threadId=process.env.CODEX_THREAD_ID,expectedCompanyId,run,open,write}={}){
 const cwd=resolve(directory),sessionPath=join(cwd,'.ledgerflow/guest-session.json');await safePath(sessionPath);
 let session;try{session=JSON.parse(await readFile(sessionPath,'utf8'));}catch{throw fail('EXISTING_LEARNING_SESSION_REQUIRED');}
 if(!/^lf_(?:guest|personal)_[A-Za-z0-9_-]{43}$/u.test(session.token)||!/^[0-9a-f-]{36}$/iu.test(session.companyId)||!Number.isFinite(Date.parse(session.expiresAt)))throw fail('EXISTING_LEARNING_SESSION_INVALID');
 if(Date.parse(session.expiresAt)<=Date.now())throw fail('CONNECTION_EXPIRED');
 if(expectedCompanyId&&session.companyId!==expectedCompanyId)throw fail('EXPECTED_COMPANY_MISMATCH');
 // A pre-existing learner installation is required. Never allocate a guest,
 // redeem a personal ticket, inspect .env or use an approval URL here.
 const configPath=join(cwd,'.codex/config.toml');await safePath(configPath);
 const config=await readFile(configPath,'utf8'),url=ORIGIN+'/mcp/'+(session.token.startsWith('lf_personal_')?'p/':'g/')+session.token;
 if(!config.includes(JSON.stringify(url)))throw fail('WORKSPACE_CONNECTION_MISMATCH');
 const ignorePath=join(cwd,'.gitignore');await safePath(ignorePath);let ignored='';try{ignored=await readFile(ignorePath,'utf8');}catch(error){if(error.code!=='ENOENT')throw error;}
 if(!ignored.split(/\r?\n/u).includes('/.ledgerflow/'))await appendFile(ignorePath,(ignored&&!ignored.endsWith('\n')?'\n':'')+'/.ledgerflow/\n');
 const report=await registerAndVerifyCodex({cwd,url,companyId:session.companyId,threadId,run,open,write});
 await privateWrite(join(cwd,'.ledgerflow/codex-connection-result.json'),report);return report;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 try{
  const args=process.argv.slice(2);if(args.length&&!(args.length===2&&args[0]==='--expected-company'))throw fail('INVALID_ARGUMENTS');
  console.log(JSON.stringify(await connectCodex({expectedCompanyId:args[1]})));
 }catch(error){const code=/^[A-Z][A-Z0-9_]+$/u.test(error.code??'')?error.code:'CODEX_SETUP_FAILED';console.error(JSON.stringify({connected:false,error:code,nativeClientVerified:false,secretsPrinted:false}));process.exitCode=1;}
}
