import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {parse as parseToml} from 'smol-toml';
import {companyContextSchema,SERVER_NAME,TOOL_NAMES} from '../apps/mcp-server/src/server.js';
import {transactionSchema} from '@ledgerflow/contracts';

export function localMcpEndpoint(value:string){
  let url:URL;try{url=new URL(value);}catch{throw new Error('INVALID_ENDPOINT');}
  if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/mcp'||url.search||url.hash||url.username||url.password)
    throw new Error('INVALID_ENDPOINT');
  return url;
}
const object=(v:unknown):Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const sameTools=(value:unknown)=>Array.isArray(value)&&value.length===TOOL_NAMES.length&&new Set(value).size===TOOL_NAMES.length&&TOOL_NAMES.every(name=>value.includes(name));
export async function inspectProjectClients(root:string,endpoint:string){
  const checks:Record<string,{configured:boolean;endpointMatches:boolean;catalogMatches:boolean|null}>={};
  for(const kind of ['codex','claude_code']){
    try{
      const parsed=kind==='codex'?parseToml(await readFile(join(root,'.codex/config.toml'),'utf8')):JSON.parse(await readFile(join(root,'.mcp.json'),'utf8'));
      const entries=object(object(parsed)[kind==='codex'?'mcp_servers':'mcpServers']),entry=object(entries[SERVER_NAME]);
      checks[kind]={configured:Object.keys(entries).length===1&&Object.keys(entry).length>0,
        endpointMatches:entry.url===endpoint&&(kind==='codex'||entry.type==='http'),
        catalogMatches:kind==='codex'?sameTools(entry.enabled_tools):null};
    }catch{checks[kind]={configured:false,endpointMatches:false,catalogMatches:null};}
  }
  return checks;
}
export function inspectCodexEntry(value:unknown,endpoint:string){
  const entry=object(value),transport=object(entry.transport);
  return {registered:Object.keys(entry).length>0,enabled:entry.enabled===true,
    endpointMatches:transport.type==='streamable_http'&&transport.url===endpoint};
}
export interface ReadConnection{
  call:(name:string,args:Record<string,unknown>)=>Promise<{isError?:unknown;structuredContent?:unknown}>;
  list:()=>Promise<{tools:{name:string}[]}>;
}
function data(response:Awaited<ReturnType<ReadConnection['call']>>){
  const body=object(response.structuredContent);
  if(response.isError||body.ok!==true)throw new Error('MCP_READ_FAILED');
  return object(body.data);
}
export async function probeReadConnection(connection:ReadConnection){
  const status=data(await connection.call('get_system_status',{}));
  const context=companyContextSchema.parse(data(await connection.call('get_company_context',{})));
  if(status.server!==SERVER_NAME||!['demo','postgres'].includes(String(status.profile))||status.paidModelApi!==false||status.ownOrchestrator!==false||status.unattendedScheduler!==false)
    throw new Error('WRONG_SERVER');
  const catalog=await connection.list(),names=catalog.tools.map(tool=>tool.name);
  if(!sameTools(names)||!sameTools(status.tools))throw new Error('CATALOG_MISMATCH');
  const period=context.periods[0];
  if(!period)throw new Error('NO_FISCAL_PERIOD');
  const page=data(await connection.call('get_transactions',{companyId:context.companyId,from:period.from,to:period.to,limit:1}));
  if(!Array.isArray(page.items)||page.items.length>1)throw new Error('INVALID_TRANSACTION_PAGE');
  for(const item of page.items){
    const row=transactionSchema.parse(item);
    if(row.companyId!==context.companyId)throw new Error('COMPANY_MISMATCH');
  }
  return {reachable:true,toolCount:names.length,companyScopeVerified:true,transactionRowsRead:page.items.length,
    profile:status.profile,syntheticData:true,accountingMutations:0,publicApiCalls:0,paidModelApiCalls:0};
}
