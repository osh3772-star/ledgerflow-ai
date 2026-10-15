import {mkdir,writeFile} from 'node:fs/promises';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {loadServerEnvironment} from './server-env.js';
loadServerEnvironment();
const client=new Client({name:'ledgerflow-catalog-export',version:'0.2.0'});
try{
  const token=process.env.LEDGERFLOW_MCP_TOKEN;
  await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+(process.env.LEDGERFLOW_MCP_PORT??'8787')+'/mcp'),
    token?{requestInit:{headers:{Authorization:'Bearer '+token}}}:{}));
  await client.callTool({name:'get_system_status',arguments:{}});
  await client.callTool({name:'get_company_context',arguments:{}});
  const catalog=await client.listTools();await mkdir('docs',{recursive:true});
  await writeFile('docs/MCP_CATALOG.json',JSON.stringify({server:'ledgerflow-accounting-mcp',sdkVersion:'2.3.1',tools:catalog.tools},null,2));
  console.log(JSON.stringify({exported:true,tools:catalog.tools.length}));
}catch{console.error('Catalog export failed. Start the shared local server.');process.exitCode=1;}finally{await client.close();}
