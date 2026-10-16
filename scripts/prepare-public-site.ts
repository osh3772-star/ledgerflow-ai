import {writeFile} from 'node:fs/promises';
import {generateFullErpSeed} from '@ledgerflow/test-data';
import {AccountingReferenceService} from '@ledgerflow/application-services';
import {PublicDataService} from '@ledgerflow/public-data';
import type {BusinessTransaction,PublicSiteSnapshot} from '@ledgerflow/contracts';
import {createMcpRuntime} from './mcp-runtime.js';
import {loadServerEnvironment} from './server-env.js';

const live=process.argv.includes('--live-references');
if(live)loadServerEnvironment();
let runtime:Awaited<ReturnType<typeof createMcpRuntime>>|undefined;
try{
  // Explicit environment: no supplied DB URL, Auth credentials or user's ledger.
  // This creates services on an owned fixture DB, not another MCP listener.
  runtime=await createMcpRuntime({LEDGERFLOW_MCP_MODE:'demo',ADAPTER_MODE:'mock'});
  const {dependencies:deps}=runtime,companyContext=await deps.getCompanyContext(),accounting=deps.accounting!;
  const transactions:BusinessTransaction[]=[];let cursor:string|undefined;
  do{const page=await deps.service.getTransactions({companyId:deps.companyId,from:'2026-01-01',to:'2026-12-31',limit:100,...(cursor?{cursor}:{})});
    transactions.push(...page.items);cursor=page.nextCursor??undefined;
  }while(cursor);
  if(transactions.length!==1000)throw new Error('FIXTURE_EXPORT_INCOMPLETE');
  const periods:PublicSiteSnapshot['periods']={};
  for(const period of companyContext.periods){
    const range={companyId:deps.companyId,from:period.from,to:period.to};
    periods[period.from+'/'+period.to]={trialBalance:await accounting.trialBalance(range),financialStatements:await accounting.financialStatements(range),audit:await accounting.audit(range)};
  }
  const seed=generateFullErpSeed(),example=seed.transactions.find(row=>row.externalRef==='LF26-SAL-0101')!;
  const keys=live?{nts:process.env.NTS_SERVICE_KEY,dart:process.env.DART_API_KEY,law:process.env.LAW_OC,ecos:process.env.ECOS_API_KEY}:{};
  if(live&&Object.values(keys).some(key=>!key?.trim()))throw new Error('LIVE_KEYS_REQUIRED');
  const report=await new AccountingReferenceService(new PublicDataService(keys,live?'live':'mock')).collect(await accounting.repository.source(deps.companyId,example.id));
  if(live&&report.items.some(item=>item.status==='unavailable'||item.status==='available'&&item.provenance?.origin!=='public_api_live'))throw new Error('LIVE_REFERENCES_INCOMPLETE');
  const snapshot:PublicSiteSnapshot={schemaVersion:1,generatedAt:new Date().toISOString(),origin:'synthetic_erp',
    company:{companyId:companyContext.companyId,name:companyContext.name,periods:companyContext.periods},transactions,periods,
    referenceExample:{transactionId:example.id,externalRef:example.externalRef,report}};
  await writeFile('apps/web/dist/public-preview.json',JSON.stringify(snapshot));
  console.log(JSON.stringify({prepared:true,transactions:transactions.length,periods:Object.keys(periods).length,referenceMode:live?'recorded_live':'mock',userLedgerAccess:false,accountingMutations:0}));
}catch{console.error('공개 미리보기 자료를 준비하지 못했습니다. 웹 build와 임시 DB·공공자료 연결을 확인하세요. 비밀값은 출력하지 않았습니다.');process.exitCode=1;}
finally{await runtime?.close();}
