import {stat} from 'node:fs/promises';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {createMcpRuntime} from './mcp-runtime.js';
import {startMcpHttp} from '../apps/mcp-server/src/http.js';
import {probeReadConnection} from './connection-check.js';
import {checkContainerHealth} from './health-check.js';

// An explicit foreground development test. No env import, external DB or keys.
let runtime:Awaited<ReturnType<typeof createMcpRuntime>>|undefined;
let http:Awaited<ReturnType<typeof startMcpHttp>>|undefined;
const client=new Client({name:'ledgerflow-container-protocol-test',version:'0.1.0'},{versionNegotiation:{mode:'legacy'}});
try{
  if(process.getuid?.()===0)throw new Error('NON_ROOT_REQUIRED');
  if(!(await stat('apps/web/dist/index.html')).isFile())throw new Error('DASHBOARD_BUILD_REQUIRED');
  runtime=await createMcpRuntime({LEDGERFLOW_MCP_MODE:'demo',ADAPTER_MODE:'mock'});
  http=await startMcpHttp(runtime.dependencies,0);
  if(!await checkContainerHealth(new URL(http.url).port))throw new Error('HEALTH_CHECK_FAILED');
  await client.connect(new StreamableHTTPClientTransport(new URL(http.url),{requestInit:{signal:AbortSignal.timeout(10000)}}));
  const probe=await probeReadConnection({call:(name,args)=>client.callTool({name,arguments:args}),list:()=>client.listTools()});
  console.log(JSON.stringify({passed:true,kind:'foreground-container-protocol-smoke',...probe,
    nativeAppsVerified:false,externalSupabaseVerified:false,nonRoot:process.getuid?process.getuid()!==0:null}));
}catch{
  console.error(JSON.stringify({passed:false,error:'CONTAINER_SMOKE_FAILED',credentialsLogged:false}));
  process.exitCode=1;
}finally{
  try{await client.close();}
  finally{try{await http?.close();}finally{await runtime?.close();}}
}
