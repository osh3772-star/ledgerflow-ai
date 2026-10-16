import {describe,expect,it,vi} from 'vitest';
import {AccountingReferenceService} from '@ledgerflow/application-services';
import {PublicDataService} from '@ledgerflow/public-data';
import {DomainError,publicReferenceReportSchema} from '@ledgerflow/contracts';
import {generateJournal} from '@ledgerflow/accounting-core';
import {accountingSource} from '../fixtures/accounting-source.js';

describe('bounded public references attached to accounting evidence',()=>{
  it('labels mock evidence, skips invented business numbers and preserves deterministic lines',async()=>{
    const network=vi.fn(),base=new PublicDataService({},'mock',undefined,network),call=vi.fn(base.call.bind(base)),source=accountingSource();
    source.document.businessNumber='1234567890';
    const original=generateJournal(source),report=await new AccountingReferenceService({call}).collect(source);
    expect(report.items.map(r=>[r.provider,r.status])).toEqual([['nts','not_applicable'],['dart','available'],['law','available'],['ecos','available']]);
    expect(report.items.filter(r=>r.status==='available').every(r=>r.provenance?.origin==='mock')).toBe(true);
    expect(call.mock.calls.some(([name])=>name==='get_business_status')).toBe(false);
    expect(network).not.toHaveBeenCalled();
    expect({...original,publicReferences:report}.lines).toEqual(generateJournal(source).lines);
    expect(original).not.toHaveProperty('publicReferences');
    expect(report).toMatchObject({humanReviewRequired:true,affectsAmounts:false});
  });
  it('uses transaction-date history when the current law starts later',async()=>{
    const base=new PublicDataService({},'mock'),calls:{name:string;input:unknown}[]=[];
    const call:PublicDataService['call']=async(name,input)=>{
      calls.push({name,input});
      if(name==='search_tax_law')return {data:{versions:[{name:'부가가치세법',mst:'123456',effectiveDate:(input as {status:string}).status==='3'?'2026-07-01':'2026-01-01'}]}};
      return base.call(name,input);
    };
    const report=await new AccountingReferenceService({call}).collect(accountingSource());
    expect(calls.filter(r=>r.name==='search_tax_law').map(r=>r.input)).toMatchObject([{status:'3'},{status:'1'}]);
    expect(calls.find(r=>r.name==='get_law_article')?.input).toMatchObject({effectiveDate:'2026-01-01',transactionDate:'2026-01-10',article:'003000'});
    expect(report.items.find(r=>r.provider==='law')).toMatchObject({status:'available',facts:{legalConclusion:false}});
  });
  it('rejects future or mismatched law bodies instead of claiming validation',async()=>{
    const base=new PublicDataService({},'mock');
    const call:PublicDataService['call']=async(name,input)=>{
      const result=await base.call(name,input) as {data:Record<string,unknown>};
      return name==='get_law_article'?{...result,data:{...result.data,effectiveDate:'2026-07-01'}}:result;
    };
    const law=(await new AccountingReferenceService({call}).collect(accountingSource())).items.find(r=>r.provider==='law');
    expect(law).toMatchObject({status:'unavailable',errorCode:'LAW_DATE_MISMATCH'});
    expect(law).not.toHaveProperty('provenance');
  });
  it('records failures without exposing raw credentials or treating them as success',async()=>{
    const call=vi.fn(async()=>{throw new Error('credential=private-fixture-key');});
    const report=await new AccountingReferenceService({call}).collect(accountingSource());
    expect(report.items.filter(r=>r.status==='unavailable')).toHaveLength(3);
    expect(JSON.stringify(report)).not.toContain('private-fixture-key');
    expect(report.items[0]!.status).toBe('not_applicable');
  });
  it('bounds slow references without waiting for every provider to time out',async()=>{
    const call=vi.fn(()=>new Promise<never>(()=>{}));
    const report=await new AccountingReferenceService({call},{timeoutMs:15}).collect(accountingSource());
    expect(report.items.filter(r=>r.errorCode==='REFERENCE_TIMEOUT')).toHaveLength(3);
  });
  it('only queries NTS for an explicit operator-supplied mapping',async()=>{
    const source=accountingSource(),base=new PublicDataService({},'mock'),call=vi.fn(base.call.bind(base));
    source.transaction={...source.transaction,counterpartyId:'11111111-1111-4111-8111-111111111111'};
    const report=await new AccountingReferenceService({call},{trustedBusinesses:{[source.transaction.counterpartyId!]:'0000000000'}}).collect(source);
    expect(call).toHaveBeenCalledWith('get_business_status',{businessNumbers:['0000000000']});
    expect(report.items[0]).toMatchObject({status:'available',provenance:{origin:'mock'}});
  });
  it('requires official HTTPS provenance and does not accept an arbitrary citation URL',async()=>{
    const report=await new AccountingReferenceService(new PublicDataService({},'mock')).collect(accountingSource());
    const poisoned=structuredClone(report);poisoned.items[1]!.provenance!.sourceUrl='https://untrusted.example/collect';
    expect(publicReferenceReportSchema.safeParse(poisoned).success).toBe(false);
    const call=async()=>{throw new DomainError('PROVIDER_REJECTED','secret text');};
    expect((await new AccountingReferenceService({call}).collect(accountingSource())).items[1]!.errorCode).toBe('PROVIDER_REJECTED');
  });
});
