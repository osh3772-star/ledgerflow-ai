import {describe,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {generateFullErpSeed} from '@ledgerflow/test-data';
import {generateJournal,validateJournal,monthlyDepreciation,trialBalance,type SourceSnapshot} from '@ledgerflow/accounting-core';
const seed=generateFullErpSeed(),t=seed.transactions.find(t=>t.externalRef==='LF26-SAL-0101')!;
const source:SourceSnapshot={transaction:t,documentIds:[t.sourceDocumentId],documentHashes:[{documentId:t.sourceDocumentId,sha256:seed.documents.find(d=>d.id===t.sourceDocumentId)!.sha256}],document:{},period:{id:t.periodId,from:'2026-01-01',to:'2026-01-31',status:'open'},
  accounts:seed.accounts.filter(a=>a.companyId===t.companyId).map(a=>({...a,active:true,validFrom:'2026-01-01',validTo:null})),
  invoice:{net:'2800',tax:'280',gross:'3080'},contract:{deliveredOn:'2026-01-10',performanceObligations:1},inventory:{quantity:'2',unitCost:'1000'}};
describe('LLM independent exact accounting core',()=>{
  it('matches independently authored sale gold including cost of sales',()=>{
    const gold=JSON.parse(readFileSync('tests/fixtures/full-sale-gold.json','utf8'));
    expect(generateJournal(source).lines).toEqual(gold.expectedLines);
  });
  it('detects independent balance, account, period and evidence faults',()=>{
    const j=generateJournal(source);
    expect(validateJournal({...j,lines:j.lines.map((l,i)=>i===0?{...l,debit:'3081'}:l)},source)).toContain('UNBALANCED');
    expect(validateJournal({...j,lines:j.lines.map((l,i)=>i===0?{...l,accountCode:'9999'}:l)},source)).toContain('ACCOUNT_INVALID');
    expect(validateJournal(j,{...source,period:{...source.period,status:'closed'}})).toContain('PERIOD_CLOSED');
    expect(validateJournal({...j,sourceDocumentIds:[seed.documents.at(-1)!.id]},source)).toContain('EVIDENCE_MISMATCH');
  });
  it('requires contract/delivery evidence instead of inferring recognition from an invoice alone',()=>{
    expect(()=>generateJournal({...source,contract:{deliveredOn:'2026-02-01',performanceObligations:1}})).toThrow();
    expect(()=>generateJournal({...source,inventory:undefined} as unknown as SourceSnapshot)).toThrow();
  });
  it('keeps huge sums exact and calculates monthly depreciation without floating point',()=>{
    expect(monthlyDepreciation('600000','0',60)).toBe('10000');
    expect(trialBalance([{accountCode:'1010',debit:'999999999999999999',credit:'0'},{accountCode:'1010',debit:'1',credit:'0'}]).totalDebit).toBe('1000000000000000000');
    expect(()=>monthlyDepreciation('100','101',2)).toThrow();
  });
});
