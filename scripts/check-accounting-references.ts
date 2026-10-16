import {writeFile,mkdir} from 'node:fs/promises';
import {AccountingReferenceService} from '@ledgerflow/application-services';
import {PublicDataService,GatewayPublicDataClient} from '@ledgerflow/public-data';
import {accountingSource} from '../tests/fixtures/accounting-source.js';
import {loadServerEnvironment} from './server-env.js';

loadServerEnvironment();
const gateway=process.argv.includes('--gateway');
try{
  const client=gateway?new GatewayPublicDataClient(process.env.LEDGERFLOW_PUBLIC_GATEWAY_URL??'',process.env.LEDGERFLOW_PUBLIC_GATEWAY_TOKEN??''):
    new PublicDataService({nts:process.env.NTS_SERVICE_KEY,dart:process.env.DART_API_KEY,law:process.env.LAW_OC,ecos:process.env.ECOS_API_KEY},'live');
  // Isolated, in-memory synthetic evidence. This diagnostic never uses the user's ledger.
  const report=await new AccountingReferenceService(client).collect(accountingSource());
  const result={checkedAt:new Date().toISOString(),mode:gateway?'gateway':'live',transactionDate:report.transactionDate,
    references:report.items.map(item=>({provider:item.provider,status:item.status,provenance:item.provenance,errorCode:item.errorCode})),
    metrics:client.metrics,ledgerMutations:0,paidModelCalls:0};
  await mkdir('.ledgerflow/release',{recursive:true});
  await writeFile('.ledgerflow/release/accounting-references-'+result.mode+'.json',JSON.stringify(result,null,2));
  console.log(JSON.stringify(result));
  if(report.items.some(item=>item.status==='unavailable'||item.status==='available'&&item.provenance?.origin!=='public_api_live'))process.exitCode=1;
}catch{console.error('공공자료 회계 연동 진단에 실패했습니다. 비밀값은 출력하지 않았습니다.');process.exitCode=1;}
