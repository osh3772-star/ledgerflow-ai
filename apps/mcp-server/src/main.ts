import { loadServerEnvironment } from '../../../scripts/server-env.js';
import { createInterface, type Interface } from 'node:readline';
import {fileURLToPath} from 'node:url';
import { createMcpRuntime } from '../../../scripts/mcp-runtime.js';
import { startMcpHttp } from './http.js';
import {createLedgerFlowServer} from './server.js';
import {serveStdio,type StdioServerHandle} from '@modelcontextprotocol/server/stdio';

process.chdir(fileURLToPath(new URL('../../../',import.meta.url)));
loadServerEnvironment();
const portText = process.env.LEDGERFLOW_MCP_PORT ?? '8787';
if (!/^[1-9]\d{0,4}$/u.test(portText) || Number(portText)>65535)
  throw new Error('LEDGERFLOW_MCP_PORT must be 1..65535.');
let runtime: Awaited<ReturnType<typeof createMcpRuntime>> | undefined;
let http: Awaited<ReturnType<typeof startMcpHttp>> | undefined;
let stopping = false;
let consoleInput: Interface | undefined;
let stdio:StdioServerHandle|undefined;
async function stop() {
  if (stopping) return;
  stopping = true;
  consoleInput?.close();
  process.stdin.pause();
  try { await stdio?.close();await http?.close(); } finally { await runtime?.close(); }
}
try {
  runtime = await createMcpRuntime();
  http = await startMcpHttp(runtime.dependencies,Number(portText));
  console.error(JSON.stringify({ready:true,server:'ledgerflow-accounting-mcp',url:http.url,
    profile:runtime.dependencies.profile,readOnly:false,paidModelApi:false,stopCommand:process.argv.includes('--stdio')?'close client stdin':'type stop and press Enter'}));
  // Windows batch wrappers may terminate the entire process tree on Ctrl+C
  // before async DB cleanup finishes. A console command lets Node close first.
  if(process.argv.includes('--stdio')){
    stdio=serveStdio(()=>createLedgerFlowServer(runtime!.dependencies));
    process.stdin.once('end',()=>void stop().catch(()=>{console.error('MCP shutdown failed.');process.exitCode=1;}));
  }else{
    consoleInput = createInterface({input:process.stdin,terminal:false});
    consoleInput.on('line',(line)=>{
      if (line.trim()==='stop') void stop().catch(()=>{
        console.error('MCP shutdown failed.');process.exitCode=1;
      });
    });
  }
  for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal,()=>void stop().catch(()=>{
    console.error('MCP shutdown failed.'); process.exitCode=1;
  }));
} catch {
  await stop();
  console.error('MCP startup failed. Check port, database profile, migrations and reader permissions; credentials are never logged.');
  process.exitCode = 1;
}
