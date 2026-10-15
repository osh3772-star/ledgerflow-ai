import {writeFile} from 'node:fs/promises';
import {Client,StreamableHTTPClientTransport} from '@modelcontextprotocol/client';
import {generateFullErpSeed} from '@ledgerflow/test-data';
import {TOOL_NAMES} from '../apps/mcp-server/src/server.js';
import {loadServerEnvironment} from './server-env.js';
loadServerEnvironment();
// This documentation exercise creates drafts in a disposable synthetic demo
// only. It cannot approve or post and refuses persistent/live profiles.
if(process.env.ADAPTER_MODE!=='mock'||(process.env.LEDGERFLOW_MCP_MODE??'demo')!=='demo')throw new Error('Examples require disposable demo + mock.');
const seed=generateFullErpSeed(),companyId=seed.companies[0]!.id,sale=seed.transactions.find(t=>t.externalRef==='LF26-SAL-0101')!;
const range={companyId,from:'2026-01-01',to:'2026-01-31'},periodId=sale.periodId;
const client=new Client({name:'ledgerflow-documentation-examples',version:'0.2.0'});
const examples:Record<string,{request:{name:string;arguments:Record<string,unknown>};response:unknown}>={};
async function call(name:string,args:Record<string,unknown>={}){
  const response=await client.callTool({name,arguments:args});
  const body=response.structuredContent as {ok:boolean;data:Record<string,unknown>};
  examples[name]={request:{name,arguments:args},response:body};return body;
}
try{
 const token=process.env.LEDGERFLOW_MCP_TOKEN;
 await client.connect(new StreamableHTTPClientTransport(new URL('http://127.0.0.1:'+(process.env.LEDGERFLOW_MCP_PORT??'8787')+'/mcp'),token?{requestInit:{headers:{Authorization:'Bearer '+token}}}:{}));
 const status=await call('get_system_status'),context=await call('get_company_context');
 if(status.data.profile!=='demo'||context.data.companyId!==companyId)throw new Error('Not the disposable fixture server.');
 for(const name of ['get_transactions','get_unprocessed_transactions','get_invoices','get_bank_transactions'])await call(name,{...range,limit:1});
 await call('get_inventory',{companyId,asOf:range.to,limit:1});await call('get_counterparties',{companyId,limit:1});
 await call('create_transaction',{companyId,idempotencyKey:'docs/erp-example',externalRef:'DOCS-ACCRUAL',kind:'accrual',occurredOn:'2026-01-31',recognitionOn:'2026-01-31',
  currency:'KRW',net:'100',tax:'0',gross:'100',documents:[{documentType:'accrual',issueDate:'2026-01-31',content:{origin:'synthetic_erp',purpose:'documentation fixture'}}]});
 const source={companyId,transactionId:sale.id};await call('get_source_documents',source);await call('get_accounting_source',source);
 const draft=await call('propose_journal_entry',{...source,idempotencyKey:'docs/sale-001'});
 if(!draft.ok)throw new Error('Draft failed.');
 const journal={companyId,journalId:String(draft.data.id)},post={...journal,expectedHash:String(draft.data.hash)};
 await call('get_journal_entry',journal);await call('list_journal_entries',{companyId,limit:1});
 await call('validate_journal_entry',journal);await call('request_journal_approval',journal);
 await call('get_approval_status',journal);await call('post_journal_entry',post);
 for(const name of ['get_general_ledger','get_trial_balance','get_company_financial_statements','run_audit_checks','get_reconciliation_report'])await call(name,range);
 await call('create_adjusting_entries',{companyId,periodId});await call('close_fiscal_period',{companyId,periodId});
 await call('reverse_journal_entry',{...journal,recognitionOn:'2026-01-31',idempotencyKey:'docs/reversal'});
 await call('calculate_depreciation',{cost:'600000',residual:'0',months:60});
 await call('record_agent_result',{companyId,client:'codex',result:{taskId:'docs-result',role:'sales',status:'blocked',transactionIds:[sale.id],toolTraceIds:[],findings:['Synthetic documentation exercise only'],
  missingEvidence:[],riskFlags:[],blockedReasons:['Human approval required'],humanApprovalRequired:true,journalPosted:false}});
 await call('match_bank_transaction',{companyId,bankTransactionId:seed.bankTransactions[0]!.id,journalId:journal.journalId});
 const second=await client.callTool({name:'propose_journal_entry',arguments:{companyId,transactionId:seed.transactions.find(t=>t.externalRef==='LF26-SAL-0102')!.id,idempotencyKey:'docs/discard'}});
 const replacement=(second.structuredContent as {data:{id:string;hash:string}}).data;
 await call('discard_journal_entry',{companyId,journalId:replacement.id,expectedHash:replacement.hash,reason:'Disposable documentation example'});
 const publicQueries:Record<string,Record<string,unknown>>={
  get_business_status:{businessNumbers:['0000000000']},verify_business:{businesses:[{businessNumber:'0000000000',startDate:'2026-01-01',representative:'가상 테스트'}]},
  search_disclosures:{corpCode:'00126380',from:'2025-01-01',to:'2025-12-31',limit:1},
  get_financial_statements:{corpCode:'00126380',year:2025},compare_company_financials:{companies:['00126380','00164779'],year:2025},
  search_tax_law:{query:'법인세법',limit:1},get_law_article:{mst:'123456',effectiveDate:'2026-01-01',article:'000100',transactionDate:'2026-01-10'},
  check_law_amendment:{query:'법인세법',knownMst:'123456'},get_exchange_rate:{currency:'JPY',date:'2026-10-14'},
  get_interest_rate:{from:'2026-01-01',to:'2026-09-30'},get_economic_indicator:{series:'gdp',from:'2020',to:'2023'},
 };
 for(const [name,args] of Object.entries(publicQueries))await call(name,args);
 if(TOOL_NAMES.some(name=>!examples[name]))throw new Error('Example missing.');
 await writeFile('docs/MCP_EXAMPLES.json',JSON.stringify({server:'ledgerflow-accounting-mcp',origin:'disposable_synthetic_demo_and_mock',humanApprovalPerformed:false,
  note:'Some valid requests deliberately fail because the demo reader cannot create ERP, self-approve, post or close an incomplete period.',
  examples:TOOL_NAMES.map(name=>examples[name])},null,2));
 console.log(JSON.stringify({examples:TOOL_NAMES.length,paidModelCalls:0,humanApprovalPerformed:false}));
}finally{await client.close();}
