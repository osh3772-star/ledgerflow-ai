import {DomainError,publicReferenceItemSchema,publicReferenceReportSchema,type PublicReferenceItem,type PublicReferenceReport} from '@ledgerflow/contracts';
import type {SourceSnapshot} from '@ledgerflow/accounting-core';

type Tool='get_business_status'|'get_financial_statements'|'search_tax_law'|'get_law_article'|'get_interest_rate';
export interface ReferenceClient{call(name:Tool,input:unknown):Promise<unknown>}
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const rows=(value:unknown)=>Array.isArray(value)?value.map(object):[];
const text=(value:unknown)=>String(value??'').replace(/<[^>]*>/gu,'').slice(0,1000);
const isoDate=(value:unknown)=>String(value??'').replace(/^(\d{4})(\d{2})(\d{2})$/u,'$1-$2-$3');

export class AccountingReferenceService{
  constructor(private client:ReferenceClient,private options:{dartCorpCode?:string;trustedBusinesses?:Readonly<Record<string,string>>;timeoutMs?:number}={}){}
  async collect(source:SourceSnapshot,transactionDate=source.transaction.recognitionOn):Promise<PublicReferenceReport>{
    const deadline=Date.now()+(this.options.timeoutMs??18000);
    const call=async(name:Tool,input:unknown)=>{
      const remaining=deadline-Date.now();if(remaining<=0)throw new DomainError('REFERENCE_TIMEOUT','참고자료 조회 기한입니다.');
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{return object(await Promise.race([this.client.call(name,input),new Promise<never>((_,reject)=>{
        timer=setTimeout(()=>reject(new DomainError('REFERENCE_TIMEOUT','참고자료 조회 기한입니다.')),remaining);
      })]));}finally{if(timer)clearTimeout(timer);}
    };
    const available=(provider:PublicReferenceItem['provider'],tool:Tool,result:Record<string,unknown>,purpose:string,note:string,facts:Record<string,unknown>):PublicReferenceItem=>{
      const p=object(result.provenance);
      return publicReferenceItemSchema.parse({provider,tool,status:'available',purpose,note,provenance:{origin:p.origin as 'mock'|'public_api_live',sourceUrl:String(p.sourceUrl),fetchedAt:String(p.fetchedAt),
        effectiveDate:p.effectiveDate==null?null:String(p.effectiveDate),referencePeriod:p.referencePeriod==null?null:String(p.referencePeriod),
        rawSha256:String(p.rawSha256),cacheHit:p.cacheHit===true},facts:JSON.parse(JSON.stringify(facts))});
    };
    const review=async(provider:PublicReferenceItem['provider'],purpose:string,work:()=>Promise<PublicReferenceItem>):Promise<PublicReferenceItem>=>{
      try{return await work();}catch(error){const code=error instanceof DomainError&&/^[A-Z0-9_]{1,100}$/u.test(error.code)?error.code:'REFERENCE_UNAVAILABLE';
        return {provider,status:'unavailable',purpose,note:'공공자료를 확인하지 못했습니다. 이 항목을 검증 완료로 취급하지 말고 사용자 검토가 필요합니다.',errorCode:code};}
    };
    const nts=review('nts','거래처 사업자 상태 참고',async()=>{
      // Only server-operator mappings may supply real numbers. Source documents cannot opt into verification.
      const number=source.transaction.counterpartyId?this.options.trustedBusinesses?.[source.transaction.counterpartyId]:undefined;
      if(!number)return {provider:'nts',status:'not_applicable',purpose:'거래처 사업자 상태 참고',note:'가상 거래처에는 실제 사업자번호가 없어 자동 조회를 생략했습니다. 실제 거래처 검증 성공을 뜻하지 않습니다.'};
      const result=await call('get_business_status',{businessNumbers:[number]});
      return available('nts','get_business_status',result,'거래처 사업자 상태 참고','운영자가 지정한 실사업자 참고 조회입니다. 현재 상태이며 과거 거래일의 상태를 보증하지 않습니다.',{businesses:rows(object(result.data).businesses).slice(0,1)});
    });
    const dart=review('dart','공시기업 재무정보 참고',async()=>{
      const corpCode=this.options.dartCorpCode??'00126380';
      const year=Number(transactionDate.slice(0,4))-(Number(transactionDate.slice(5,7))<4?2:1);
      if(year<2015)return {provider:'dart',status:'not_applicable',purpose:'공시기업 재무정보 참고',note:'지원 재무연도 범위 이전입니다.'};
      const result=await call('get_financial_statements',{corpCode,year,fsDiv:'CFS',reportCode:'11011'});
      const accounts=rows(object(result.data).accounts).filter(r=>['ifrs-full_Revenue','ifrs-full_Assets','ifrs-full_Liabilities','ifrs-full_Equity','dart_OperatingIncome'].includes(String(r.accountId))).slice(0,10)
        .map(r=>({accountId:text(r.accountId).slice(0,150),name:text(r.name).slice(0,150),amount:r.amount==null?null:text(r.amount).slice(0,80),currency:r.currency==null?null:text(r.currency).slice(0,20)}));
      if(!accounts.length)throw new DomainError('REFERENCE_NO_DATA','참고 재무 계정이 없습니다.');
      return available('dart','get_financial_statements',result,'공시기업 재무정보 참고','지정 공시기업의 참고자료이며 동종업계 비교기업으로 보장하지 않습니다. 정정·공시 시점은 별도 검토하고 가상회사의 매출·자산으로 합산하지 않습니다.',{corpCode,year,accounts});
    });
    const law=review('law','거래일에 적용 가능한 세법 조문 확인',async()=>{
      const query=source.transaction.tax!=='0'?'부가가치세법':'법인세법';
      const current=await call('search_tax_law',{query,status:'3',limit:20});
      let versions=rows(object(current.data).versions);
      const eligible=()=>versions.filter(v=>text(v.name)===query&&/^\d{4}-\d{2}-\d{2}$/u.test(isoDate(v.effectiveDate))&&isoDate(v.effectiveDate)<=transactionDate)
        .sort((a,b)=>isoDate(b.effectiveDate).localeCompare(isoDate(a.effectiveDate)));
      if(!eligible().length){const historical=await call('search_tax_law',{query,status:'1',limit:20});versions=[...versions,...rows(object(historical.data).versions)];}
      const version=eligible()[0];if(!version)throw new DomainError('HISTORICAL_LAW_NOT_FOUND','거래일 이전 법령 버전을 확인해야 합니다.');
      const effectiveDate=isoDate(version.effectiveDate),article=query==='부가가치세법'?'003000':'000100';
      const result=await call('get_law_article',{mst:String(version.mst),effectiveDate,article,transactionDate}),data=object(result.data);
      if(isoDate(data.effectiveDate)!==effectiveDate||effectiveDate>transactionDate)throw new DomainError('LAW_DATE_MISMATCH','법령 시행일을 재확인해야 합니다.');
      return available('law','get_law_article',result,'거래일에 적용 가능한 세법 조문 확인','거래일 이전 시행 버전을 선택한 참고자료입니다. 부칙·개별 적용요건·정정 이력과 K-IFRS 판단은 별도 검토하며 세액·수익인식을 자동 확정하지 않습니다.',
        {name:text(data.name),article,effectiveDate,transactionDate,articles:rows(data.articles).slice(0,3).map(r=>({number:text(r['조문번호']),content:text(r['조문내용'])})),legalConclusion:false});
    });
    const ecos=review('ecos','거래 월의 금리 환경 참고',async()=>{
      const from=transactionDate.slice(0,7)+'-01',result=await call('get_interest_rate',{from,to:transactionDate});
      if(!rows(object(result.data).observations).length)throw new DomainError('REFERENCE_NO_DATA','해당 월의 관측이 없습니다.');
      return available('ecos','get_interest_rate',result,'거래 월의 금리 환경 참고','한국은행 기준금리 참고자료입니다. 계약 이자율이나 K-IFRS 할인율이 아니며 원화 거래 금액·상각액을 변경하지 않습니다.',
        {observations:rows(object(result.data).observations).slice(-3),currency:source.transaction.currency});
    });
    return publicReferenceReportSchema.parse({transactionDate,preparedAt:new Date().toISOString(),items:await Promise.all([nts,dart,law,ecos]),humanReviewRequired:true,affectsAmounts:false});
  }
}
