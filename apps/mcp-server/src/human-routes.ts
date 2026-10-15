import {createHash,randomBytes,timingSafeEqual} from 'node:crypto';
import {decisionInput,periodInput,documentInput,uuidSchema,DomainError} from '@ledgerflow/contracts';
import type {AccountingService,ErpService} from '@ledgerflow/application-services';
import type {EvidenceStorage} from './evidence-storage.js';
import {memoryHumanSessionStore,HUMAN_SESSION_TTL_MS,type HumanSessionStore} from './human-session-store.js';
export interface HumanAuthentication{
  verify:(accessToken:string)=>Promise<string>;
}
export function createHumanRouter(options:{
  authentication?:HumanAuthentication;accounting:(userId:string)=>AccountingService;
  localDemoUserId?:string;
  reader:AccountingService;companyId:string;companyContext:()=>Promise<unknown>;
  erp?:ErpService;
  evidenceStorage?:EvidenceStorage;
  sessionStore?:HumanSessionStore;
}){
  const sessions=options.sessionStore??memoryHumanSessionStore();
  const sameCsrf=(supplied:string|null,expected:string)=>timingSafeEqual(
    createHash('sha256').update(supplied??'').digest(),createHash('sha256').update(expected).digest());
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
  const reply=(data:unknown,status=200,extra:Record<string,string>={})=>Response.json(data,{status,headers:{...headers,...extra}});
  async function body(request:Request){
    if(!request.headers.get('content-type')?.startsWith('application/json'))throw new DomainError('INVALID_INPUT','JSON 요청이 필요합니다.');
    const text=await request.text();if(Buffer.byteLength(text)>65536)throw new DomainError('INVALID_INPUT','요청이 너무 큽니다.');
    return JSON.parse(text) as unknown;
  }
  return async (request:Request):Promise<Response>=>{
    const path=new URL(request.url).pathname;
    try{
      if(path==='/api/context'&&request.method==='GET')return reply({company:await options.companyContext(),
        humanApprovalMode:options.localDemoUserId?'local_demo':options.authentication?'external_auth':'unavailable',
        humanSessionStore:sessions.kind,
        evidenceStorageConfigured:Boolean(options.evidenceStorage)});
      const token=request.headers.get('cookie')?.match(/(?:^|;\s*)lf_human=([a-f0-9]{64})(?:;|$)/u)?.[1];
      const session=token?await sessions.get(token):undefined;
      let service=options.reader;
      if(session&&session.expires>Date.now()){
        let userId=session.userId;
        if(options.authentication){
          try{
            if(!session.accessToken)throw new DomainError('UNAUTHENTICATED','외부 인증 세션이 필요합니다.');
            userId=await options.authentication.verify(session.accessToken);
            if(userId!==session.userId)throw new DomainError('UNAUTHENTICATED','외부 인증 신원을 확인하세요.');
          }catch(error){await sessions.delete(token!);throw error;}
        }
        service=options.accounting(userId);
      }
      if(path==='/api/human/session'&&request.method==='GET'){
        // Login-free sessions are only enabled for the disposable local demo.
        // Fetch Metadata is a CSRF boundary, not proof of a person's identity.
        const origin=request.headers.get('origin');
        if(request.headers.get('sec-fetch-site')!=='same-origin'||origin&&origin!==new URL(request.url).origin)return reply({error:'SAME_ORIGIN_BROWSER_REQUIRED'},403);
        if(session&&session.expires>Date.now())return reply({ready:true,csrf:session.csrf});
        let identity:{userId:string;accessToken?:string};
        if(options.localDemoUserId)identity={userId:options.localDemoUserId};
        else{
          const accessToken=request.headers.get('authorization')?.match(/^Bearer (.+)$/u)?.[1];
          if(!options.authentication||!accessToken)return reply({error:'HUMAN_AUTH_REQUIRED'},401);
          identity={userId:await options.authentication.verify(accessToken),accessToken};
        }
        const sessionToken=randomBytes(32).toString('hex'),csrf=randomBytes(24).toString('hex');
        await sessions.put(sessionToken,{...identity,expires:Date.now()+HUMAN_SESSION_TTL_MS,csrf});
        const secure=new URL(request.url).protocol==='https:'?'; Secure':'';
        return reply({ready:true,csrf},200,{'Set-Cookie':'lf_human='+sessionToken+'; HttpOnly; SameSite=Strict; Path=/api; Max-Age=1800'+secure});
      }
      if(request.method==='POST'&&['/api/human/decision','/api/human/close','/api/human/evidence'].includes(path)){
        if(!session||session.expires<=Date.now()||!sameCsrf(request.headers.get('x-csrf-token'),session.csrf))return reply({error:'HUMAN_SESSION_REQUIRED'},401);
        if(path==='/api/human/decision'){
          const q=decisionInput.parse(await body(request));if(q.companyId!==options.companyId)return reply({error:'FORBIDDEN'},403);
          return reply(await service.decide(q));
        }
        if(path==='/api/human/close'){
          const q=periodInput.parse(await body(request));if(q.companyId!==options.companyId)return reply({error:'FORBIDDEN'},403);
          return reply(await service.close(q));
        }
        if(path==='/api/human/evidence'){
          if(!session.accessToken||!options.evidenceStorage)return reply({error:'STORAGE_NOT_CONFIGURED'},503);
          const q=documentInput.extend({documentId:uuidSchema}).parse(await body(request));
          if(q.companyId!==options.companyId)return reply({error:'FORBIDDEN'},403);
          const documents=await service.documents(q),document=documents.find(d=>d.id===q.documentId);
          if(!document)return reply({error:'NOT_FOUND'},404);
          await service.repository.checkEvidenceWrite(q.companyId);
          const object=await options.evidenceStorage.archive(session.accessToken,q.companyId,{id:String(document.id),sha256:String(document.sha256),content:document.content});
          return reply(await service.repository.archiveEvidence(q.companyId,q.documentId,String(document.sha256),object.bytes));
        }
      }
      if(request.method==='GET'){
        const url=new URL(request.url);
        if(path==='/api/journals')return reply(await options.reader.list({companyId:options.companyId,state:url.searchParams.get('state')??undefined,limit:100}));
        if(path==='/api/journal')return reply(await options.reader.get({companyId:options.companyId,journalId:url.searchParams.get('id')}));
        if(path==='/api/approval')return reply(await options.reader.approval({companyId:options.companyId,journalId:url.searchParams.get('id')}));
        if(path==='/api/documents')return reply(await options.reader.documents({companyId:options.companyId,transactionId:url.searchParams.get('transactionId')}));
        const range={companyId:options.companyId,from:url.searchParams.get('from')??'2026-01-01',to:url.searchParams.get('to')??'2026-12-31'};
        if(path==='/api/transactions'&&options.erp)return reply(await options.erp.getTransactions({...range,...(url.searchParams.get('cursor')?{cursor:url.searchParams.get('cursor')!}:{})}));
        if(path==='/api/trial-balance')return reply(await options.reader.trialBalance(range));
        if(path==='/api/financial-statements')return reply(await options.reader.financialStatements(range));
        if(path==='/api/audit')return reply(await options.reader.audit(range));
        if(path==='/api/ledger')return reply(await options.reader.ledger(range));
        if(path==='/api/reconciliation')return reply(await options.reader.reconciliation(range));
      }
      return reply({error:'NOT_FOUND'},404);
    }catch(error){
      const code=error instanceof DomainError?error.code:'INVALID_INPUT';
      return reply({error:code},code==='FORBIDDEN'?403:code==='UNAUTHENTICATED'?401:code==='SESSION_STORE_UNAVAILABLE'?503:400);
    }
  };
}
