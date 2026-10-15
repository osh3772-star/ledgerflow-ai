import {describe,expect,it,vi} from 'vitest';
import {PublicDataService,MemoryApiCache} from '@ledgerflow/public-data';
describe('public reference adapters separated from synthetic ERP',()=>{
  it('supports all four mock domains with explicit provenance and no network',async()=>{
    const network=vi.fn(),service=new PublicDataService({},'mock',new MemoryApiCache(),network);
    const queries:[Parameters<typeof service.call>[0],unknown][]=[
      ['get_business_status',{businessNumbers:['0000000000']}],
      ['verify_business',{businesses:[{businessNumber:'0000000000',startDate:'2026-01-01',representative:'테스트'}]}],
      ['search_disclosures',{corpCode:'00126380',from:'2025-01-01',to:'2025-12-31'}],
      ['get_financial_statements',{corpCode:'00126380',year:2025}],
      ['compare_company_financials',{companies:['00126380','00164779'],year:2025}],
      ['search_tax_law',{query:'법인세법'}],['get_law_article',{mst:'123456',effectiveDate:'2026-01-01',article:'000100',transactionDate:'2026-01-02'}],
      ['check_law_amendment',{query:'부가가치세법',knownMst:'000000'}],
      ['get_exchange_rate',{currency:'JPY',date:'2026-10-14'}],
      ['get_interest_rate',{from:'2026-01-01',to:'2026-09-30'}],
      ['get_economic_indicator',{series:'gdp',from:'2020',to:'2023'}],
    ];
    for(const [name,q] of queries){const r=await service.call(name,q);expect(JSON.stringify(r)).toContain('"mock"');}
    expect(network).not.toHaveBeenCalled();
    const fx=await service.call('get_exchange_rate',{currency:'JPY',date:'2026-10-14'}) as {data:{quotedUnits:number}};
    expect(fx.data.quotedUnits).toBe(100);
  });
  it('encodes NTS body/date fields, deduplicates in-flight calls and caches live results',async()=>{
    const network=vi.fn(async(_url:unknown,options:RequestInit|undefined)=>{
      expect(JSON.parse(String(options?.body))).toEqual({b_no:['0000000000']});
      return Response.json({status_code:'OK',data:[{b_no:'0000000000',b_stt_cd:'01',tax_type:'일반과세'}]});
    }) as unknown as typeof fetch;
    const service=new PublicDataService({nts:'fixture-key'},'live',new MemoryApiCache(),network);
    const results=await Promise.all([service.call('get_business_status',{businessNumbers:['0000000000']}),service.call('get_business_status',{businessNumbers:['0000000000']})]);
    expect(vi.mocked(network).mock.calls.length).toBe(1);expect(JSON.stringify(results)).not.toContain('fixture-key');
    const cached=await service.call('get_business_status',{businessNumbers:['0000000000']}) as {provenance:{cacheHit:boolean;effectiveDate:null}};
    expect(cached.provenance.cacheHit).toBe(true);expect(cached.provenance.effectiveDate).toBeNull();
  });
  it('never turns live authentication errors into a successful mock or exposes raw errors',async()=>{
    const service=new PublicDataService({dart:'fixture-secret'},'live',new MemoryApiCache(),async()=>{throw new Error('credential=fixture-secret');});
    await expect(service.call('get_financial_statements',{corpCode:'00126380',year:2025})).rejects.toMatchObject({code:'PROVIDER_UNAVAILABLE'});
    await expect(service.call('get_law_article',{mst:'1',effectiveDate:'2026-01-01',article:'00100200',transactionDate:'2026-01-02'})).rejects.toMatchObject({code:'INVALID_INPUT'});
  });
  it('does not cache successful HTTP responses carrying a provider error code',async()=>{
    let calls=0;
    const service=new PublicDataService({dart:'fixture-key'},'live',new MemoryApiCache(),async()=>Response.json(++calls===1?{status:'020'}:{status:'000',list:[]}));
    await expect(service.call('get_financial_statements',{corpCode:'00126380',year:2025})).rejects.toMatchObject({code:'PROVIDER_REJECTED'});
    await service.call('get_financial_statements',{corpCode:'00126380',year:2025});
    expect(calls).toBe(2);
  });
  it('preserves provenance digest when JSONB reorders cached object keys',async()=>{
    const cache=new MemoryApiCache(),service=new PublicDataService({},'mock',cache);
    const query={corpCode:'00126380',year:2025};
    const initial=await service.call('get_financial_statements',query) as {provenance:{rawSha256:string}};
    for(const value of cache.rows.values()){
      const data=value.response as Record<string,unknown>;
      value.response=Object.fromEntries(Object.entries(data).reverse());
    }
    const replay=await service.call('get_financial_statements',query) as {provenance:{rawSha256:string}};
    expect(replay.provenance.rawSha256).toBe(initial.provenance.rawSha256);
  });
});
