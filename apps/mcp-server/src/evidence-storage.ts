import {createHash} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
import {DomainError} from '@ledgerflow/contracts';
// Canonical JSON archives preserve the already immutable synthetic evidence.
// These are not uploads of government-issued tax invoices.
const canonical=(value:unknown):string=>{
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  const record=value as Record<string,unknown>;
  return '{'+Object.keys(record).sort().map(k=>JSON.stringify(k)+':'+canonical(record[k])).join(',')+'}';
};
export interface EvidenceStorage{
  archive(token:string,companyId:string,document:{id:string;sha256:string;content:unknown}):Promise<{path:string;bytes:number}>;
}
export function supabaseEvidenceStorage(url:string,publishableKey:string,fetcher:typeof fetch=fetch):EvidenceStorage{
  const target=new URL(url);
  if(target.protocol!=='https:'&&!(target.protocol==='http:'&&['localhost','127.0.0.1'].includes(target.hostname)))throw new Error('Storage requires HTTPS or localhost.');
  return {async archive(token,companyId,document){
    const bytes=Buffer.from(canonical(document.content),'utf8');
    if(bytes.length>10485760||createHash('sha256').update(bytes).digest('hex')!==document.sha256)throw new DomainError('EVIDENCE_MISMATCH','증빙 원문 hash를 확인하세요.');
    const path=companyId+'/'+document.id+'/'+document.sha256+'.json';
    const client=createClient(target.href,publishableKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
      global:{headers:{Authorization:'Bearer '+token},fetch:async(input,init)=>fetcher(input,{...init,redirect:'error',signal:AbortSignal.timeout(15000)})}});
    const bucket=client.storage.from('ledgerflow-evidence');
    // Retry after a DB/network failure is safe: verify existing bytes rather
    // than overwriting an object or trusting a provider conflict response.
    const upload=await bucket.upload(path,bytes,{contentType:'application/json',upsert:false});
    if(upload.error){
      const existing=await bucket.download(path);
      if(existing.error||!existing.data||existing.data.size>10485760)throw new DomainError('STORAGE_UNAVAILABLE','증빙 보관 실패; 설정과 권한을 확인하세요.');
      const actual=Buffer.from(await existing.data.arrayBuffer());
      if(createHash('sha256').update(actual).digest('hex')!==document.sha256)throw new DomainError('EVIDENCE_MISMATCH','보관된 증빙 hash가 다릅니다.');
    }
    return {path,bytes:bytes.length};
  }};
}
