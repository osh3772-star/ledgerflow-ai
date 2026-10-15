import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import { request } from 'node:http';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { generateFullErpSeed } from '@ledgerflow/test-data';
import { createMcpRuntime } from '../../scripts/mcp-runtime.js';
import { startMcpHttp } from '../../apps/mcp-server/src/http.js';
import { TOOL_NAMES, type ToolAudit } from '../../apps/mcp-server/src/server.js';

describe('one shared Streamable HTTP accounting MCP endpoint',()=>{
  const seed=generateFullErpSeed(), companyId=seed.companies[0]!.id;
  const range={companyId,from:'2026-01-01',to:'2026-12-31'};
  const clients=['codex-protocol-test','claude-code-protocol-test'].map((name,index)=>new Client({name,version:'0.2.0'},
    {versionNegotiation:{mode:index===0?'legacy':'auto'}}));
  let runtime:Awaited<ReturnType<typeof createMcpRuntime>>,http:Awaited<ReturnType<typeof startMcpHttp>>;
  const audit:ToolAudit[]=[];
  beforeAll(async()=>{
    runtime=await createMcpRuntime({LEDGERFLOW_MCP_MODE:'demo'});
    const record=runtime.dependencies.audit;
    runtime.dependencies.audit=async(event)=>{await record(event);audit.push(event);};
    http=await startMcpHttp(runtime.dependencies,0);
    await Promise.all(clients.map((client)=>client.connect(new StreamableHTTPClientTransport(new URL(http.url)))));
  });
  afterAll(async()=>{
    await Promise.all(clients.map((client)=>client.close()));
    if(http)await http.close();
    if(runtime)await runtime.close();
  });
  const call=async(name:string,args:Record<string,unknown>={},index=0)=>{
    const result=await clients[index]!.callTool({name,arguments:args});
    return {result,body:result.structuredContent as {ok:boolean;data:Record<string,unknown>;error:{code:string};meta:{traceId:string}}};
  };
  it('initializes two independent clients and advertises schema-validated ERP, accounting and public tools',async()=>{
    const lists=await Promise.all(clients.map((client)=>client.listTools()));
    for(const list of lists){
      expect(list.tools.map((tool)=>tool.name).sort()).toEqual([...TOOL_NAMES].sort());
      expect(list.tools.every((tool)=>tool.outputSchema)).toBe(true);
      expect(list.tools.find(tool=>tool.name==='post_journal_entry')?.annotations?.readOnlyHint).toBe(false);
      expect(list.tools.some(tool=>tool.name.includes('approve')||tool.name==='execute_sql')).toBe(false);
    }
    const status=await call('get_system_status');
    expect(status.body.data).toMatchObject({paidModelApi:false,ownOrchestrator:false,unattendedScheduler:false,
      capabilities:{erpRead:true,posting:true,trialBalance:true,publicApiTools:true}});
  });
  it('shares the same DB company and periods across both client connections',async()=>{
    const contexts=await Promise.all([call('get_company_context'),call('get_company_context',{},1)]);
    expect(contexts.every((context)=>context.body.ok)).toBe(true);
    expect(contexts[0]!.body.data).toEqual(contexts[1]!.body.data);
    expect(contexts[0]!.body.data).toMatchObject({companyId,origin:'synthetic_erp',functionalCurrency:'KRW'});
  });
  it('reads the entire 1,000-row ERP once without changing processing status',async()=>{
    const ids:string[]=[];let cursor:string|undefined;
    do{
      const {body}=await call('get_unprocessed_transactions',{...range,limit:100,...(cursor?{cursor}:{})});
      expect(body.ok).toBe(true);
      const page=body.data as {items:{id:string;status:string}[];nextCursor:string|null};
      expect(page.items.every((row)=>row.status==='unprocessed')).toBe(true);
      ids.push(...page.items.map((row)=>row.id));cursor=page.nextCursor??undefined;
    }while(cursor);
    expect(ids).toHaveLength(1000);expect(new Set(ids).size).toBe(1000);
    const other=await call('get_transactions',{...range,limit:1},1);
    expect(other.body.ok).toBe(true);
    expect((other.body.data.items as {id:string}[])[0]!.id).toBe(ids[0]);
  });
  it('reuses invoice, bank, inventory and counterparty services with source metadata',async()=>{
    const sale=seed.transactions.find((row)=>row.externalRef==='LF26-SAL-0101')!;
    const invoice=await call('get_invoices',{...range,transactionId:sale.id});
    expect(invoice.body.data.items).toMatchObject([{net:'2800',tax:'280',gross:'3080',governmentIssued:false}]);
    const bank=await call('get_bank_transactions',{...range,unmatchedOnly:true,limit:100});
    expect(bank.body.data.items).toHaveLength(74);
    const stock=await call('get_inventory',{companyId,asOf:'2026-01-31',productId:seed.products[0]!.id});
    expect(stock.body.data.items).toMatchObject([{quantity:'58',carryingAmount:'58000',costStatus:'source_estimate'}]);
    const party=await call('get_counterparties',{companyId,query:'거래처 01'});
    expect(party.body.data.items).toHaveLength(1);
    expect(audit.some((event)=>event.traceId===invoice.body.meta.traceId&&event.tool==='get_invoices'&&event.outcome==='success')).toBe(true);
  });
  it('refuses company spoofing and invalid input; exposes no generic SQL or human approval tool',async()=>{
    const forbidden=await call('get_transactions',{...range,companyId:seed.companies[1]!.id});
    expect(forbidden.result.isError).toBe(true);expect(forbidden.body.error.code).toBe('FORBIDDEN');
    const invalid=await clients[0]!.callTool({name:'get_transactions',arguments:{...range,limit:1000}});
    expect(invalid.isError).toBe(true);
    await expect(clients[0]!.callTool({name:'execute_sql',arguments:{}})).rejects.toThrow('not found');
    expect(audit.some((event)=>event.outcome==='error'&&event.errorCode==='FORBIDDEN')).toBe(true);
  });
  it('rejects hostile Origin/Host and accepts only the fixed local endpoint',async()=>{
    const origin=await fetch(http.url,{method:'POST',headers:{Origin:'https://evil.example','Content-Type':'application/json'},body:'{}'});
    expect(origin.status).toBe(403);
    const hostStatus=await new Promise<number|undefined>((resolve,reject)=>{
      const probe=request(http.url,{headers:{Host:'evil.example'}},(response)=>{
        response.resume();response.once('end',()=>resolve(response.statusCode));
      });
      probe.once('error',reject);probe.end();
    });
    expect(hostStatus).toBe(403);
    expect((await fetch(http.url+'/elsewhere')).status).toBe(404);
    expect((await fetch(http.url.replace('/mcp','/health'))).status).toBe(200);
    expect((await fetch(http.url,{method:'POST',headers:{'Content-Type':'application/json'},body:' '.repeat(65537)})).status).toBe(413);
  });
  it('fails closed when tool auditing fails and does not disclose internal messages',async()=>{
    const original=runtime.dependencies.audit;
    runtime.dependencies.audit=async()=>{throw new Error('secret test DB connection');};
    try{
      const result=await call('get_system_status');
      expect(result.result.isError).toBe(true);
      expect(result.body.error.code).toBe('AUDIT_UNAVAILABLE');
      expect(JSON.stringify(result.result)).not.toContain('secret test');
    }finally{runtime.dependencies.audit=original;}
  });
  it('completes the MCP workflow only after an explicit login-free local browser decision with CSRF',async()=>{
    const transaction=seed.transactions.find(t=>t.externalRef==='LF26-SAL-0101')!;
    const draft=await call('propose_journal_entry',{companyId,transactionId:transaction.id,idempotencyKey:'mcp-e2e-sale'});
    expect(draft.body.data.state).toBe('Draft');
    const journalId=String(draft.body.data.id),expectedHash=String(draft.body.data.hash);
    await call('validate_journal_entry',{companyId,journalId});
    await call('request_journal_approval',{companyId,journalId});
    expect((await call('post_journal_entry',{companyId,journalId,expectedHash})).body.error.code).toBe('APPROVAL_REQUIRED');
    const origin=new URL(http.url).origin,endpoint=origin+'/api/human/';
    const decision={companyId,journalId,expectedHash,decision:'approved'};
    const denied=await fetch(endpoint+'decision',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:JSON.stringify(decision)});
    expect(denied.status).toBe(401);
    expect((await fetch(endpoint+'login',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'})).status).toBe(404);
    expect((await fetch(endpoint+'session')).status).toBe(403);
    const session=await fetch(endpoint+'session',{headers:{Origin:origin,'Sec-Fetch-Site':'same-origin'}});
    expect(session.status).toBe(200);
    const cookie=session.headers.get('set-cookie')!.split(';')[0]!,auth=await session.json() as {csrf:string};
    expect(session.headers.get('set-cookie')).toContain('HttpOnly');
    const noCsrf=await fetch(endpoint+'decision',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(decision)});
    expect(noCsrf.status).toBe(401);
    const allowed=await fetch(endpoint+'decision',{method:'POST',headers:{Origin:origin,Cookie:cookie,'Content-Type':'application/json','X-CSRF-Token':auth.csrf},body:JSON.stringify(decision)});
    expect(allowed.status).toBe(200);
    const posted=await call('post_journal_entry',{companyId,journalId,expectedHash},1);
    expect(posted.body.data.state).toBe('Posted');
    const trial=await call('get_trial_balance',range);
    expect(trial.body.data.totalDebit).toBe('5080');expect(trial.body.data.totalCredit).toBe('5080');
    const financial=await call('get_company_financial_statements',range);
    expect(financial.body.data.incomeStatement).toMatchObject({profit:'800'});
    const web=await fetch(origin+'/api/trial-balance?from=2026-01-01&to=2026-12-31');
    expect((await web.json()).totalDebit).toBe('5080');
    expect((await call('get_financial_statements',{corpCode:'00126380',year:2025})).body.ok).toBe(true);
  });
  it('checks optional MCP bearer authentication independently of the browser decision session',async()=>{
    runtime.dependencies.mcpToken='test-mcp-bearer';
    try{
      expect((await fetch(http.url)).status).toBe(401);
      expect((await fetch(http.url,{headers:{Authorization:'Bearer test-mcp-bearer'}})).status).toBe(405);
    }finally{delete runtime.dependencies.mcpToken;}
  });
});
