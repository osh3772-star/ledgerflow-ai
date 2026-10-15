import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { TOOL_NAMES, SERVER_NAME } from '../apps/mcp-server/src/server.js';
import {loadServerEnvironment} from './server-env.js';
loadServerEnvironment();

const endpoint = new URL(process.env.LEDGERFLOW_MCP_URL ?? 'http://127.0.0.1:8787/mcp');
if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.pathname !== '/mcp' || endpoint.search || endpoint.username || endpoint.password)
  throw new Error('Smoke test supports only the local LedgerFlow endpoint.');
const clients = ['codex-protocol-smoke','claude-code-protocol-smoke'].map((name)=>new Client({name,version:'0.2.0'}));
try {
  const token=process.env.LEDGERFLOW_MCP_TOKEN;
  await Promise.all(clients.map((client)=>client.connect(new StreamableHTTPClientTransport(endpoint,token?{requestInit:{headers:{Authorization:'Bearer '+token}}}:{}))));
  const catalogs = await Promise.all(clients.map((client)=>client.listTools()));
  if (catalogs.some((catalog)=>catalog.tools.length!==TOOL_NAMES.length || catalog.tools.some((tool)=>!TOOL_NAMES.includes(tool.name as typeof TOOL_NAMES[number]))))
    throw new Error('Unexpected MCP catalog.');
  const statuses=await Promise.all(clients.map(client=>client.callTool({name:'get_system_status',arguments:{}})));
  const contexts = await Promise.all(clients.map((client)=>client.callTool({name:'get_company_context',arguments:{}})));
  const status=statuses[0]!;
  const data = contexts.map((context)=>context.structuredContent as {ok:boolean;data:{companyId:string;periods:{from:string;to:string}[]}});
  if (!data.every((context)=>context.ok) || data[0]!.data.companyId!==data[1]!.data.companyId) throw new Error('Shared context check failed.');
  const range = data[0]!.data.periods[0]!;
  const transactions = await clients[0]!.callTool({name:'get_transactions',arguments:{
    companyId:data[0]!.data.companyId,from:range.from,to:range.to,limit:5}});
  if (transactions.isError || status.isError) throw new Error('Read tool failed.');
  const rows=transactions.structuredContent as {data:{items:unknown[]}};
  console.log(JSON.stringify({server:SERVER_NAME,endpoint:endpoint.href,protocolClients:2,toolCount:catalogs[0]!.tools.length,
    sharedCompany:true,successfulTransactionsReturned:rows.data.items.length,
    actualClaudeCodeAppVerified:false,actualCodexAppVerified:false,paidModelCalls:0},null,2));
} catch {
  console.error('MCP smoke test failed. Start the local server and check its endpoint.');
  process.exitCode=1;
} finally { await Promise.all(clients.map((client)=>client.close())); }
