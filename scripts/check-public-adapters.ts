import {PublicDataService} from '@ledgerflow/public-data';
import {loadServerEnvironment} from './server-env.js';
loadServerEnvironment();
const service=new PublicDataService({nts:process.env.NTS_SERVICE_KEY,dart:process.env.DART_API_KEY,law:process.env.LAW_OC,ecos:process.env.ECOS_API_KEY},'live');
const queries:[Parameters<typeof service.call>[0],unknown][]=[
  ['get_business_status',{businessNumbers:['0000000000']}],
  ['get_financial_statements',{corpCode:'00126380',year:2025}],
  ['search_tax_law',{query:'법인세법',limit:1}],
  ['get_exchange_rate',{currency:'USD',date:'2026-10-14',policy:'previous_available'}],
  ['get_interest_rate',{from:'2026-01-01',to:'2026-09-30'}],
];
let law:Record<string,unknown>|undefined;
for(const [tool,args] of queries){
  try{
    const result=await service.call(tool,args) as {data:Record<string,unknown>;provenance:{origin:string;sourceUrl:string;fetchedAt:string};warnings:string[]};
    if(tool==='search_tax_law')law=(result.data.versions as Record<string,unknown>[])[0];
    console.log(JSON.stringify({tool,success:true,provenance:result.provenance,
      rows:Array.isArray(result.data.accounts)?result.data.accounts.length:Array.isArray(result.data.observations)?result.data.observations.length:undefined,
      requestedDate:result.data.requestedDate,observedDate:result.data.observedDate,unit:result.data.unit}));
  }catch(error){console.log(JSON.stringify({tool,success:false,code:(error as {code?:string}).code??'SAFE_UNKNOWN_ERROR'}));process.exitCode=1;}
}
if(law){
  try{
    const date=String(law.effectiveDate).replace(/^(\d{4})(\d{2})(\d{2})$/u,'$1-$2-$3');
    const result=await service.call('get_law_article',{mst:String(law.mst),effectiveDate:date,article:'000100',transactionDate:'2026-10-14'}) as {data:Record<string,unknown>;provenance:unknown};
    console.log(JSON.stringify({tool:'get_law_article',success:true,applicationStatus:result.data.applicationStatus,provenance:result.provenance}));
  }catch(error){console.log(JSON.stringify({tool:'get_law_article',success:false,code:(error as {code?:string}).code??'SAFE_UNKNOWN_ERROR'}));process.exitCode=1;}
}
console.log(JSON.stringify({metrics:service.metrics,paidModelCalls:0}));
