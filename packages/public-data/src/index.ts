import {createHash} from 'node:crypto';
import {z} from 'zod';
import {dateSchema,DomainError,ExactDecimal} from '@ledgerflow/contracts';
type Provider='nts'|'dart'|'law'|'ecos';
export const API_TOOLS=['verify_business','get_business_status','search_disclosures','get_financial_statements','compare_company_financials',
  'search_tax_law','get_law_article','check_law_amendment','get_exchange_rate','get_interest_rate','get_economic_indicator'] as const;
const number=z.string().regex(/^\d{10}$/u),compactDate=dateSchema;
const financeFields={corpCode:z.string().regex(/^\d{8}$/u),year:z.number().int().min(2015).max(2100),
  reportCode:z.enum(['11011','11012','11013','11014']).default('11011'),fsDiv:z.enum(['CFS','OFS']).default('CFS')};
export const publicInputs={
  get_business_status:z.strictObject({businessNumbers:z.array(number).min(1).max(100)}),
  verify_business:z.strictObject({businesses:z.array(z.strictObject({businessNumber:number,startDate:compactDate,representative:z.string().min(1).max(100),name:z.string().max(200).optional()})).min(1).max(100)}),
  search_disclosures:z.strictObject({corpCode:z.string().regex(/^\d{8}$/u),from:compactDate,to:compactDate,
    detailType:z.enum(['F001','F002']).optional(),page:z.number().int().min(1).max(1000).default(1),limit:z.number().int().min(1).max(100).default(20)}).refine(v=>v.from<=v.to),
  get_financial_statements:z.strictObject(financeFields),
  compare_company_financials:z.strictObject({companies:z.array(z.string().regex(/^\d{8}$/u)).min(2).max(5),year:financeFields.year,reportCode:financeFields.reportCode,fsDiv:financeFields.fsDiv}),
  search_tax_law:z.strictObject({query:z.enum(['법인세법','부가가치세법','법인세법 시행령','부가가치세법 시행령']),status:z.enum(['1','2','3']).default('3'),page:z.number().int().min(1).max(1000).default(1),limit:z.number().int().min(1).max(100).default(20)}),
  check_law_amendment:z.strictObject({query:z.enum(['법인세법','부가가치세법','법인세법 시행령','부가가치세법 시행령']),knownMst:z.string().regex(/^\d{1,12}$/u)}),
  get_law_article:z.strictObject({mst:z.string().regex(/^\d{1,12}$/u),effectiveDate:compactDate,article:z.string().regex(/^\d{6}$/u),transactionDate:dateSchema}),
  get_exchange_rate:z.strictObject({currency:z.enum(['USD','JPY']),date:dateSchema,policy:z.enum(['strict','previous_available']).default('strict')}),
  get_interest_rate:z.strictObject({from:dateSchema,to:dateSchema}).refine(v=>v.from<=v.to),
  get_economic_indicator:z.strictObject({series:z.enum(['gdp','usd_krw','jpy_krw','base_rate']),from:z.string().regex(/^\d{4}(?:\d{2}(?:\d{2})?)?$/u),to:z.string().regex(/^\d{4}(?:\d{2}(?:\d{2})?)?$/u)}).refine(v=>v.from<=v.to),
};
export interface Series {code:string;item:string;cycle:'A'|'M'|'D';unit:string;verifiedAt:string|null;label:string}
export const SERIES:Record<string,Series>={
  gdp:{code:'200Y101',item:'10101',cycle:'A',unit:'십억원',verifiedAt:'2026-10-14',label:'명목 국내총생산'},
  usd_krw:{code:'731Y001',item:'0000001',cycle:'D',unit:'원',verifiedAt:'2026-10-14',label:'원/미국달러 매매기준율 (1 USD)'},
  jpy_krw:{code:'731Y001',item:'0000002',cycle:'D',unit:'원',verifiedAt:'2026-10-14',label:'원/일본엔 매매기준율 (100 JPY)'},
  base_rate:{code:'722Y001',item:'0101000',cycle:'M',unit:'연%',verifiedAt:'2026-10-14',label:'한국은행 기준금리'},
};
export interface CacheRecord {response:unknown;origin:'mock'|'public_api_live';fetchedAt:string;expiresAt:string;sourceUrl:string}
export interface ApiCache {get(key:string):Promise<CacheRecord|null>;put(key:string,provider:Provider,row:CacheRecord):Promise<void>}
export class MemoryApiCache implements ApiCache{
  rows=new Map<string,CacheRecord>();async get(key:string){return this.rows.get(key)??null;}async put(key:string,_:Provider,row:CacheRecord){this.rows.set(key,row);}
}
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
// JSONB may reorder object keys; hash the canonical response value.
const canonical=(value:unknown):string=>{
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  const row=value as Record<string,unknown>;
  return '{'+Object.keys(row).sort().map(k=>JSON.stringify(k)+':'+canonical(row[k])).join(',')+'}';
};
const obj=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const list=(v:unknown)=>Array.isArray(v)?v.map(obj):v&&typeof v==='object'?[obj(v)]:[];
const clean=(v:unknown)=>String(v??'').replace(/<[^>]*>/gu,'').replace(/[\u0000-\u0008]/gu,'').slice(0,5000);
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
export class PublicDataService{
  private inFlight=new Map<string,Promise<unknown>>();
  private nextRequest=new Map<Provider,number>();
  private counts=new Map<string,number>();
  metrics={requests:0,cacheHits:0,retries:0,failures:0};
  constructor(private keys:Partial<Record<Provider,string|undefined>>,private mode:'mock'|'live'='mock',
    private cache:ApiCache=new MemoryApiCache(),private fetcher:typeof fetch=fetch){}
  async call(name:typeof API_TOOLS[number],raw:unknown):Promise<unknown>{
    const schema=publicInputs[name],parsed=schema.safeParse(raw);
    if(!parsed.success)throw new DomainError('INVALID_INPUT','공공 API 입력을 확인하세요.');
    const q=parsed.data as Record<string,unknown>;
    if(name==='compare_company_financials'){
      const reports=await Promise.all((q.companies as string[]).map(corpCode=>this.call('get_financial_statements',{corpCode,year:q.year,reportCode:q.reportCode,fsDiv:q.fsDiv})));
      const comparisons=reports.map((report,index)=>{
        const data=obj(obj(report).data),rows=list(data.accounts);
        const amount=(ids:string[])=>{
          const found=rows.filter(r=>ids.includes(String(r.accountId)));
          if(found.length!==1||found[0]!.amount===null)return null;
          const value=String(found[0]!.amount).replaceAll(',','');
          return /^-?\d+$/u.test(value)?new ExactDecimal(value):null;
        };
        const revenue=amount(['ifrs-full_Revenue']),operating=amount(['dart_OperatingIncome']),
          debt=amount(['ifrs-full_Liabilities']),equity=amount(['ifrs-full_Equity']);
        return {corpCode:(q.companies as string[])[index],operatingMargin:revenue?.gt(0)&&operating?operating.div(revenue).mul(100).toFixed(4):null,
          debtToEquity:equity?.gt(0)&&debt?debt.div(equity).mul(100).toFixed(4):null};
      });
      const currencies=new Set(reports.flatMap(r=>list(obj(obj(r).data).accounts).map(a=>a.currency)));
      if(currencies.size!==1)for(const row of comparisons){row.operatingMargin=null;row.debtToEquity=null;}
      return {data:{comparisons,reports,derived:true},provenance:reports.map(r=>obj(r).provenance),warnings:['사전 선택 비교기업; 업종 자동 분류 아님','단일 계정/동일 통화 확인 불가 시 비율 null']};
    }
    if(name==='check_law_amendment'){
      const result=obj(await this.call('search_tax_law',{query:q.query,status:'3',limit:20}));
      const versions=list(obj(result.data).versions);
      return {...result,data:{versions,changed:versions.some(v=>String(v.mst)!==q.knownMst),legalConclusion:false}};
    }
    if(name==='get_exchange_rate'){
      const requested=q.date as string,series=SERIES[q.currency==='USD'?'usd_krw':'jpy_krw']!;
      const from=q.policy==='previous_available'?new Date(Date.parse(requested+'T00:00:00Z')-7*86400000).toISOString().slice(0,10):requested;
      const result=obj(await this.statistic(series,from.replaceAll('-',''),requested.replaceAll('-','')));
      const rows=list(obj(result.data).observations),last=rows.at(-1);
      if(!last)throw new DomainError('NO_DATA','요청한 환율 관측이 없습니다.');
      const observed=String(last.time).replace(/^(\d{4})(\d{2})(\d{2})$/u,'$1-$2-$3');
      return {...result,provenance:{...obj(result.provenance),effectiveDate:observed,referencePeriod:requested},data:{requestedDate:requested,observedDate:observed,lagDays:Math.round((Date.parse(requested)-Date.parse(observed))/86400000),
        value:last.value,unit:series.unit,currency:q.currency,quotedUnits:q.currency==='JPY'?100:1,valuationApproved:false}};
    }
    if(name==='get_interest_rate')return this.statistic(SERIES.base_rate!,String(q.from).slice(0,7).replace('-',''),String(q.to).slice(0,7).replace('-',''));
    if(name==='get_economic_indicator')return this.statistic(SERIES[String(q.series)]!,String(q.from),String(q.to));
    let provider:Provider,endpoint:string,params:Record<string,string>={},body:unknown,ttl=86400000;
    if(name==='get_business_status'||name==='verify_business'){
      provider='nts';endpoint='https://api.odcloud.kr/api/nts-businessman/v1/'+(name==='get_business_status'?'status':'validate');
      body=name==='get_business_status'?{b_no:q.businessNumbers}:{businesses:(q.businesses as Record<string,string>[]).map(b=>({b_no:b.businessNumber,start_dt:b.startDate!.replaceAll('-',''),p_nm:b.representative,...(b.name?{b_nm:b.name}:{})}))};
      ttl=name==='get_business_status'?1800000:86400000;
    }else if(name==='search_disclosures'||name==='get_financial_statements'){
      provider='dart';endpoint='https://opendart.fss.or.kr/api/'+(name==='search_disclosures'?'list.json':'fnlttSinglAcntAll.json');
      params=name==='search_disclosures'?{corp_code:String(q.corpCode),bgn_de:String(q.from).replaceAll('-',''),end_de:String(q.to).replaceAll('-',''),page_no:String(q.page),page_count:String(q.limit),...(q.detailType?{pblntf_detail_ty:String(q.detailType)}:{})}
        :{corp_code:String(q.corpCode),bsns_year:String(q.year),reprt_code:String(q.reportCode),fs_div:String(q.fsDiv)};
    }else{
      provider='law';endpoint='https://www.law.go.kr/DRF/'+(name==='search_tax_law'?'lawSearch.do':'lawService.do');
      params={target:'eflaw',type:'JSON',...(name==='search_tax_law'?{query:String(q.query),nw:String(q.status),page:String(q.page),display:String(q.limit)}
        :{MST:String(q.mst),efYd:String(q.effectiveDate).replaceAll('-',''),JO:String(q.article)})};
    }
    const result=await this.request(provider,name,endpoint,params,body,ttl);
    const response=obj(result.row.response);
    let data:unknown,effectiveDate:string|null=null,warnings:string[]=[];
    if(provider==='nts'){
      if(response.status_code!=='OK')throw new DomainError('PROVIDER_REJECTED','국세청 응답 상태를 확인하세요.');
      data={businesses:list(response.data).map(r=>({businessNumberMasked:String(r.b_no).slice(0,3)+'****'+String(r.b_no).slice(-3),
        statusCode:r.b_stt_cd??obj(r.status).b_stt_cd??null,taxType:clean(r.tax_type??obj(r.status).tax_type),closedDate:r.end_dt??null,
        verification:r.valid==='01'?'matched':'unconfirmed'}))};warnings.push('현재 상태이며 과거 거래일 상태를 보증하지 않음');
    }else if(provider==='dart'){
      if(response.status!=='000'&&response.status!=='013')throw new DomainError('DART_'+(/^\d{3}$/u.test(String(response.status))?response.status:'ERROR'),'DART 조회가 거절되었습니다.');
      const rows=list(response.list);
      data=name==='search_disclosures'?{total:Number(response.total_count??0),disclosures:rows.map(r=>({corpCode:r.corp_code,name:clean(r.corp_name),report:clean(r.report_nm),
        receipt:r.rcept_no,date:r.rcept_dt,sourceUrl:/^\d{14}$/u.test(String(r.rcept_no))?'https://dart.fss.or.kr/dsaf001/main.do?rcpNo='+r.rcept_no:null}))}
        :{corpCode:q.corpCode,year:q.year,reportCode:q.reportCode,fsDiv:q.fsDiv,accounts:rows.map(r=>({accountId:r.account_id,name:clean(r.account_nm),
          statement:r.sj_div,amount:typeof r.thstrm_amount==='string'&&r.thstrm_amount.trim()?r.thstrm_amount:null,cumulativeAmount:r.thstrm_add_amount??null,currency:r.currency??null}))};
      warnings.push('공시기업의 참고자료; 가상회사 장부 아님');
    }else if(name==='search_tax_law'){
      const root=obj(response.LawSearch),rows=list(root.law);
      if(root.resultCode!==undefined&&String(root.resultCode)!=='00')throw new DomainError('LAW_REJECTED','법령 검색 응답을 확인하세요.');
      if(!('LawSearch' in response))throw new DomainError('SCHEMA_MISMATCH','법령 검색 형식이 다릅니다.');
      data={versions:rows.map(r=>({mst:r['법령일련번호'],lawId:r['법령ID'],name:clean(r['법령명한글']),effectiveDate:r['시행일자'],promulgatedDate:r['공포일자'],status:q.status}))};
    }else{
      const law=obj(response['법령']),basic=obj(law['기본정보']),articles=obj(law['조문']);
      if(!Object.keys(basic).length)throw new DomainError('SCHEMA_MISMATCH','법령 본문 형식이 다릅니다.');
      effectiveDate=String(basic['시행일자']??'').replace(/^(\d{4})(\d{2})(\d{2})$/u,'$1-$2-$3');
      const selected=list(articles['조문단위']);
      data={name:clean(basic['법령명_한글']),mst:q.mst,effectiveDate,articles:selected,
        transactionDate:q.transactionDate,applicationStatus:effectiveDate&&effectiveDate<=String(q.transactionDate)?'needs_review':'not_yet_effective',
        legalConclusion:false};warnings.push('후속 개정·조문별 시행일·부칙 검토 필요; 세무·회계 처리 확정 아님');
    }
    return {data,provenance:{...this.provenance(provider,result,effectiveDate),
      referencePeriod:provider==='dart'?String(q.year??q.from)+'/'+String(q.reportCode??q.to):null},warnings};
  }
  private async statistic(series:Series,from:string,to:string){
    if(!series.verifiedAt&&this.mode==='live')throw new DomainError('SERIES_NOT_VERIFIED','공식 시리즈 코드·단위 검증 후 활성화해야 합니다.');
    const length=series.cycle==='A'?4:series.cycle==='M'?6:8;
    if(from.length!==length||to.length!==length||from>to)throw new DomainError('INVALID_INPUT','관측 주기에 맞는 기간이 필요합니다.');
    const result=await this.request('ecos','statistic','https://ecos.bok.or.kr/api/StatisticSearch',
      {code:series.code,item:series.item,cycle:series.cycle,from,to},undefined,86400000);
    const response=obj(result.row.response),root=obj(response.StatisticSearch),error=obj(response.RESULT);
    if(error.CODE)throw new DomainError('ECOS_REJECTED','ECOS 조회가 거절되었습니다.');
    if(!('StatisticSearch' in response))throw new DomainError('SCHEMA_MISMATCH','ECOS 형식이 다릅니다.');
    const observations=list(root.row).map(r=>({time:r.TIME,value:r.DATA_VALUE,unit:r.UNIT_NAME}));
    if(observations.some(r=>r.unit!==series.unit))throw new DomainError('SERIES_UNIT_MISMATCH','ECOS 단위가 registry와 다릅니다.');
    return {data:{label:series.label,observations,total:Number(root.list_total_count??0),truncated:Number(root.list_total_count??0)>observations.length},
      provenance:{...this.provenance('ecos',result,null),referencePeriod:from+'/'+to,observationCycle:series.cycle},warnings:['경제 통계 참고자료; 개정 가능','관측 최대 100건; truncated=true면 기간을 나누어 조회']};
  }
  private provenance(provider:Provider,result:{row:CacheRecord;cacheHit:boolean},effectiveDate:string|null){
    return {provider,origin:result.row.origin,sourceUrl:result.row.sourceUrl,fetchedAt:result.row.fetchedAt,effectiveDate,
      rawSha256:sha(canonical(result.row.response)),cacheHit:result.cacheHit,stale:false,schemaVersion:'1'};
  }
  private async request(provider:Provider,operation:string,endpoint:string,params:Record<string,string>,body:unknown,ttl:number){
    const live=this.mode==='live'&&Boolean(this.keys[provider]),origin=live?'public_api_live' as const:'mock' as const;
    const cacheKey=sha(JSON.stringify({provider,operation,params,body,origin,keyFingerprint:sha(this.keys[provider]??'')}));
    const cached=await this.cache.get(cacheKey);
    if(cached&&Date.parse(cached.expiresAt)>Date.now()){this.metrics.cacheHits++;return {row:cached,cacheHit:true};}
    const existing=this.inFlight.get(cacheKey);if(existing)return existing as Promise<{row:CacheRecord;cacheHit:boolean}>;
    const operationPromise=(async()=>{
      let response:unknown;
      if(!live)response=this.mock(provider,operation,params,body);
      else{
        const key=this.keys[provider]!,url=new URL(endpoint);
        if(provider==='ecos')url.pathname+='/'+encodeURIComponent(key)+'/json/kr/1/100/'+[params.code,params.cycle,params.from,params.to,params.item].join('/');
        else url.search=new URLSearchParams({...params,[provider==='nts'?'serviceKey':provider==='dart'?'crtfc_key':'OC']:provider==='nts'?decodeURIComponent(key):key,
          ...(provider==='nts'?{returnType:'JSON'}:{})}).toString();
        const budgetKey=provider+'/'+new Date().toISOString().slice(0,10);
        const started=Date.now();
        for(let attempt=0;attempt<3;attempt++){
          const count=this.counts.get(budgetKey)??0;if(count>=500)throw new DomainError('API_BUDGET_EXHAUSTED','일일 로컬 호출 상한입니다.');
          this.counts.set(budgetKey,count+1);this.metrics.requests++;
          const slot=Math.max(Date.now(),this.nextRequest.get(provider)??0);this.nextRequest.set(provider,slot+1000);
          if(slot-Date.now()+Date.now()-started>24000)throw new DomainError('RATE_LIMITED','조회 대기열이 도구 기한을 초과했습니다.');
          await pause(Math.max(0,slot-Date.now()));
          try{
            const r=await this.fetcher(url,{method:body===undefined?'GET':'POST',...(body!==undefined?{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),
              redirect:'error',signal:AbortSignal.timeout(Math.max(1,Math.min(provider==='dart'?15000:8000,25000-(Date.now()-started))))});
            if(r.status===429||r.status>=500){if(attempt<2){this.metrics.retries++;const retry=Math.min(Number(r.headers.get('retry-after')??'1')*1000,25000);
              if(Date.now()-started+retry>24000)throw new DomainError('RATE_LIMITED','기관 호출 제한; 나중에 재시도하세요.');await pause(retry);continue;}throw new DomainError('PROVIDER_UNAVAILABLE','기관 조회 제한 또는 장애입니다.');}
            if(!r.ok)throw new DomainError('PROVIDER_REJECTED','기관 인증·입력 조건을 확인하세요.');
            const reader=r.body?.getReader();if(!reader)throw new DomainError('SCHEMA_MISMATCH','응답 본문이 없습니다.');
            let size=0;const chunks:Uint8Array[]=[];
            while(true){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;
              if(size>1048576){await reader.cancel();throw new DomainError('RESPONSE_TOO_LARGE','응답 제한을 초과했습니다.');}chunks.push(chunk.value);}
            response=JSON.parse(Buffer.concat(chunks).toString('utf8'));break;
          }catch(error){
            if(error instanceof DomainError||attempt===2){this.metrics.failures++;throw error instanceof DomainError?error:new DomainError('PROVIDER_UNAVAILABLE','외부 조회 실패; 키와 원문 오류는 기록하지 않습니다.');}
            this.metrics.retries++;await pause(200*(attempt+1));
          }
        }
      }
      const data=obj(response);
      const accepted=provider==='nts'?data.status_code==='OK':
        provider==='dart'?['000','013'].includes(String(data.status)):
        provider==='ecos'?Boolean(data.StatisticSearch)&&!obj(data.RESULT).CODE:
        operation==='search_tax_law'?Boolean(data.LawSearch)&&[undefined,'00'].includes(obj(data.LawSearch).resultCode as string|undefined):Boolean(data['법령']);
      if(!accepted){this.metrics.failures++;throw new DomainError('PROVIDER_REJECTED','기관 오류 응답은 캐시하지 않습니다.');}
      const now=new Date(),row:CacheRecord={response,origin,fetchedAt:now.toISOString(),expiresAt:new Date(now.getTime()+ttl).toISOString(),sourceUrl:endpoint};
      await this.cache.put(cacheKey,provider,row);return {row,cacheHit:false};
    })();
    this.inFlight.set(cacheKey,operationPromise);
    try{return await operationPromise;}finally{this.inFlight.delete(cacheKey);}
  }
  private mock(provider:Provider,operation:string,p:Record<string,string>,body:unknown){
    if(provider==='nts')return {status_code:'OK',data:(list(obj(body).businesses).length?list(obj(body).businesses):((obj(body).b_no as string[])??[]).map(b_no=>({b_no}))).map(r=>({...r,b_stt_cd:'01',tax_type:'mock 일반과세',valid:'02'}))};
    if(provider==='dart')return operation==='search_disclosures'?{status:'000',total_count:1,list:[{corp_code:p.corp_code,corp_name:'Mock benchmark',report_nm:'Mock annual report',rcept_no:'20260101000001',rcept_dt:'20260101'}]}
      :{status:'000',list:[['ifrs-full_Revenue','100000'],['dart_OperatingIncome','10000'],['ifrs-full_Liabilities','40000'],['ifrs-full_Equity','60000']].map(([account_id,thstrm_amount])=>({account_id,account_nm:account_id,thstrm_amount,sj_div:'IS',currency:'KRW'}))};
    if(provider==='law')return operation==='search_tax_law'?{LawSearch:{resultCode:'00',law:[{'법령일련번호':'123456','법령ID':'000001','법령명한글':p.query,'시행일자':'20260101','공포일자':'20251231'}]}}
      :{'법령':{'기본정보':{'시행일자':p.efYd,'법령명_한글':'Mock 법령'},'조문':{'조문단위':[{'조문번호':'1','조문내용':'테스트용 가상 조문. 실제 법령이 아닙니다.'}]}}};
    const series=Object.values(SERIES).find(s=>s.code===p.code&&s.item===p.item)!;
    return {StatisticSearch:{list_total_count:1,row:[{TIME:p.to,DATA_VALUE:series.cycle==='A'?'1000000':series.code==='722Y001'?'3.00':'1400.00',UNIT_NAME:series.unit}]}};
  }
}
