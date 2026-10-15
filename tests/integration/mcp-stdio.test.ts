import {describe,expect,it} from 'vitest';
import {createServer} from 'node:net';
import {resolve} from 'node:path';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {StdioClientTransport} from '@modelcontextprotocol/client/stdio';
import {TOOL_NAMES} from '../../apps/mcp-server/src/server.js';
describe('one foreground process exposes stdio and shared HTTP',()=>{
  it('keeps stdout protocol-only and shares a saved Draft across transports',async()=>{
    const socket=createServer(),port=await new Promise<number>((done,reject)=>{
      socket.once('error',reject);socket.listen(0,'127.0.0.1',()=>{
        const address=socket.address();if(!address||typeof address==='string')return reject(new Error('Port unavailable.'));
        socket.close(error=>error?reject(error):done(address.port));
      });
    });
    const transport=new StdioClientTransport({command:process.execPath,args:['--import','tsx',resolve('apps/mcp-server/src/main.ts'),'--stdio'],
      cwd:process.cwd(),stderr:'pipe',env:{LEDGERFLOW_MCP_PORT:String(port),LEDGERFLOW_MCP_MODE:'demo',ADAPTER_MODE:'mock',
        LEDGERFLOW_DATABASE_URL:'',LEDGERFLOW_MCP_TOKEN:'',SUPABASE_URL:'',SUPABASE_PUBLISHABLE_KEY:'',
        NTS_SERVICE_KEY:'',DART_API_KEY:'',LAW_OC:'',ECOS_API_KEY:''}});
    transport.stderr?.on('data',()=>{/* startup metadata is not protocol output */});
    const local=new Client({name:'stdio-test',version:'0.2.0'},{versionNegotiation:{mode:'legacy'}});
    const remote=new Client({name:'http-same-process-test',version:'0.2.0'},{versionNegotiation:{mode:'legacy'}});
    try{
      await local.connect(transport,{timeout:90000});
      expect((await local.listTools()).tools).toHaveLength(TOOL_NAMES.length);
      await local.callTool({name:'get_system_status',arguments:{}});
      const context=(await local.callTool({name:'get_company_context',arguments:{}})).structuredContent as {data:{companyId:string}};
      const companyId=context.data.companyId;
      const page=(await local.callTool({name:'get_transactions',arguments:{companyId,from:'2026-01-01',to:'2026-01-31',kind:'sale',limit:1}})).structuredContent as {data:{items:{id:string}[]}};
      const draft=(await local.callTool({name:'propose_journal_entry',arguments:{companyId,transactionId:page.data.items[0]!.id,idempotencyKey:'stdio-shared-draft'}})).structuredContent as {data:{id:string}};
      await remote.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+port+'/mcp')));
      await remote.callTool({name:'get_system_status',arguments:{}});
      await remote.callTool({name:'get_company_context',arguments:{}});
      const found=(await remote.callTool({name:'get_journal_entry',arguments:{companyId,journalId:draft.data.id}})).structuredContent as {data:{state:string}};
      expect(found.data.state).toBe('Draft');
    }finally{await remote.close();await local.close();}
  },120000);
});
