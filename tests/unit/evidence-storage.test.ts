import {describe,expect,it,vi} from 'vitest';
import {generateFullErpSeed} from '@ledgerflow/test-data';
import {supabaseEvidenceStorage} from '../../apps/mcp-server/src/evidence-storage.js';
describe('immutable JWT scoped evidence storage',()=>{
  const seed=generateFullErpSeed(),doc=seed.documents[0]!;
  it('uploads canonical content with the human JWT, no overwrite and stable company path',async()=>{
    const request=vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{
      expect(String(input)).toContain('/storage/v1/object/ledgerflow-evidence/'+doc.companyId+'/');
      expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer fixture-human-jwt');
      expect(new Headers(init?.headers).get('x-upsert')).toBe('false');
      return Response.json({Key:'fixture'});
    });
    const storage=supabaseEvidenceStorage('https://fixture.supabase.co','fixture-publishable',request);
    expect((await storage.archive('fixture-human-jwt',doc.companyId,doc)).path).toContain(doc.sha256);
    expect(request).toHaveBeenCalledTimes(1);
  });
  it('rejects changed evidence before any provider call',async()=>{
    const request=vi.fn(),storage=supabaseEvidenceStorage('https://fixture.supabase.co','fixture-publishable',request);
    await expect(storage.archive('fixture-human-jwt',doc.companyId,{...doc,content:{changed:true}})).rejects.toMatchObject({code:'EVIDENCE_MISMATCH'});
    expect(request).not.toHaveBeenCalled();
  });
});
