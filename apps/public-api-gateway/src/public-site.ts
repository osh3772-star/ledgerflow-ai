import {z} from 'zod';
import {dateSchema,type PublicSiteSnapshot} from '@ledgerflow/contracts';

export interface WebAssets{fetch(request:Request):Promise<Response>}
const rangeSchema=z.strictObject({from:dateSchema,to:dateSchema,cursor:z.string().max(100).optional()}).refine(q=>q.from<=q.to);
export function createPublicSiteRouter(){
  let snapshot:PublicSiteSnapshot|undefined;
  const reply=(value:unknown,status=200)=>Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
  return async(request:Request,assets:WebAssets):Promise<Response>=>{
    const url=new URL(request.url),path=url.pathname;
    // Public hosting never delegates human sessions, approvals or mutations to localhost.
    if(request.method!=='GET'||path.startsWith('/api/human/'))return reply({error:'PUBLIC_PREVIEW_READ_ONLY'},403);
    const known=['/api/context','/api/transactions','/api/journals','/api/trial-balance','/api/financial-statements','/api/audit','/api/public-references'];
    if(!known.includes(path))return reply({error:'NOT_FOUND'},404);
    try{
      if(!snapshot){
        const response=await assets.fetch(new Request(new URL('/public-preview.json',url)));
        if(!response.ok)return reply({error:'PUBLIC_PREVIEW_NOT_READY'},503);
        const value=await response.json() as PublicSiteSnapshot;
        if(value.schemaVersion!==1||value.origin!=='synthetic_erp'||!value.company||!Array.isArray(value.transactions))return reply({error:'PUBLIC_PREVIEW_NOT_READY'},503);
        snapshot=value;
      }
      if(path==='/api/context')return reply({company:snapshot.company,humanApprovalMode:'unavailable',humanSessionStore:'none',evidenceStorageConfigured:false,
        publicPreview:true,snapshotAt:snapshot.generatedAt,publicReferenceExample:snapshot.referenceExample,
        publicApi:{mode:'preview',providers:[]}});
      if(path==='/api/journals')return reply([]);
      if(path==='/api/public-references'){
        if(url.searchParams.get('transactionId')!==snapshot.referenceExample.transactionId)return reply({error:'PUBLIC_PREVIEW_REFERENCE_EXAMPLE_ONLY'},404);
        return reply({transactionId:snapshot.referenceExample.transactionId,publicReferences:snapshot.referenceExample.report});
      }
      const raw=Object.fromEntries(url.searchParams),q=rangeSchema.safeParse({from:raw.from??'2026-01-01',to:raw.to??'2026-01-31',...(raw.cursor?{cursor:raw.cursor}:{})});
      if(!q.success||Object.keys(raw).some(key=>!['from','to','cursor'].includes(key)))return reply({error:'INVALID_INPUT'},400);
      const range=q.data,key=range.from+'/'+range.to,period=snapshot.periods[key];
      if(!period)return reply({error:'PUBLIC_PREVIEW_MONTH_RANGE_REQUIRED'},400);
      if(path==='/api/transactions'){
        const prefix='preview-'+range.from+'-'+range.to+'-';let offset=0;
        if(range.cursor){if(!range.cursor.startsWith(prefix)||!/^\d{1,6}$/u.test(range.cursor.slice(prefix.length)))return reply({error:'INVALID_CURSOR'},400);offset=Number(range.cursor.slice(prefix.length));}
        const rows=snapshot.transactions.filter(row=>row.companyId===snapshot!.company.companyId&&row.recognitionOn>=range.from&&row.recognitionOn<=range.to);
        if(offset>rows.length)return reply({error:'INVALID_CURSOR'},400);
        return reply({items:rows.slice(offset,offset+50),nextCursor:offset+50<rows.length?prefix+(offset+50):null});
      }
      return reply(path==='/api/trial-balance'?period.trialBalance:path==='/api/financial-statements'?period.financialStatements:period.audit);
    }catch{return reply({error:'PUBLIC_PREVIEW_NOT_READY'},503);}
  };
}
