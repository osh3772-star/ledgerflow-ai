import {generateFullErpSeed} from '@ledgerflow/test-data';
import type {SourceSnapshot} from '@ledgerflow/accounting-core';

export function accountingSource():SourceSnapshot{
  const seed=generateFullErpSeed(),transaction=seed.transactions.find(t=>t.externalRef==='LF26-SAL-0101')!;
  return {transaction,documentIds:[transaction.sourceDocumentId],documentHashes:[{documentId:transaction.sourceDocumentId,sha256:seed.documents.find(d=>d.id===transaction.sourceDocumentId)!.sha256}],document:{},
    period:{id:transaction.periodId,from:'2026-01-01',to:'2026-01-31',status:'open'},
    accounts:seed.accounts.filter(a=>a.companyId===transaction.companyId).map(a=>({...a,active:true,validFrom:'2026-01-01',validTo:null})),
    invoice:{net:'2800',tax:'280',gross:'3080'},contract:{deliveredOn:'2026-01-10',performanceObligations:1},inventory:{quantity:'2',unitCost:'1000'}};
}
