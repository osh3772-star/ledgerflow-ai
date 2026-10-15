import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdir,writeFile,access} from 'node:fs/promises';
import {delimiter,join,resolve} from 'node:path';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {SERVER_NAME} from '../apps/mcp-server/src/server.js';
import {loadServerEnvironment} from './server-env.js';
import {localMcpEndpoint,inspectProjectClients,inspectCodexEntry,probeReadConnection} from './connection-check.js';
loadServerEnvironment();
const run=promisify(execFile);
async function executable(name:string){
  const names=process.platform==='win32'?[name+'.exe',name+'.cmd']:[name];
  const directories=(process.env.PATH??'').split(delimiter);
  if(name==='claude'&&process.env.USERPROFILE)directories.push(join(process.env.USERPROFILE,'.local/bin'));
  for(const directory of directories)for(const file of names){
    const path=join(directory,file);try{await access(path);return path;}catch{/* Try the next executable candidate. */}
  }
  return null;
}
const report:Record<string,unknown>={server:SERVER_NAME,generatedAt:new Date().toISOString(),
  actualCodexAppVerified:false,actualClaudeCodeAppVerified:false,paidModelApiCalls:0};
let failed=false;
try{
  const endpoint=localMcpEndpoint(process.env.LEDGERFLOW_MCP_URL??'http://127.0.0.1:'+(process.env.LEDGERFLOW_MCP_PORT??'8787')+'/mcp');
  report.endpoint=endpoint.href;
  const project=await inspectProjectClients(process.cwd(),endpoint.href);report.projectClients=project;
  if(Object.values(project).some(row=>!row.configured||!row.endpointMatches||row.catalogMatches===false))failed=true;
  const codex=await executable('codex'),claude=await executable('claude');
  let registration:ReturnType<typeof inspectCodexEntry>|null=null;
  if(codex&&!codex.endsWith('.cmd')){
    try{
      const result=await run(codex,['mcp','get',SERVER_NAME,'--json'],{cwd:process.cwd(),windowsHide:true,timeout:10000,maxBuffer:262144});
      // Native CLI output may contain auth headers. Only sanitized booleans leave this scope.
      registration=inspectCodexEntry(JSON.parse(result.stdout),endpoint.href);
    }catch{/* Missing/untrusted native config is a manual step, not protocol proof. */}
  }
  report.nativeClients={codex:{executableFound:Boolean(codex),registration},claudeCode:{executableFound:Boolean(claude)}};
  report.externalConfiguration={supabaseAuthConfigured:Boolean(process.env.SUPABASE_URL&&process.env.SUPABASE_PUBLISHABLE_KEY),
    postgresConfigured:Boolean(process.env.LEDGERFLOW_DATABASE_URL&&process.env.LEDGERFLOW_USER_ID&&process.env.LEDGERFLOW_COMPANY_ID)};
  const client=new Client({name:'ledgerflow-readiness-probe',version:'0.2.0'},{versionNegotiation:{mode:'legacy'}});
  try{
    const token=process.env.LEDGERFLOW_MCP_TOKEN;
    await client.connect(new StreamableHTTPClientTransport(endpoint,{requestInit:{signal:AbortSignal.timeout(10000),
      ...(token?{headers:{Authorization:'Bearer '+token}}:{})}}));
    report.mcp=await probeReadConnection({call:async(name,args)=>client.callTool({name,arguments:args}),list:()=>client.listTools()});
  }catch{failed=true;report.mcp={reachable:false,error:'MCP_CONNECTION_CHECK_FAILED',nextAction:'pnpm mcp:start'};}
  finally{await client.close();}
  report.manualSteps=[
    ...(!claude?['Install/open Claude Code and reload the project MCP configuration.']:[]),
    'In each native app call get_system_status and get_company_context; native inference was not invoked by this check.',
    'A human must review and decide the web approval; this check never approves or posts.',
  ];
}catch{failed=true;report.error='CONNECTION_CHECK_FAILED';}
report.connectionChecksPassed=!failed;
await mkdir(resolve('.ledgerflow/readiness'),{recursive:true});
await writeFile(resolve('.ledgerflow/readiness/latest.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
if(failed)process.exitCode=1;
