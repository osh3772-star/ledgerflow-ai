import {describe,expect,it} from 'vitest';
import {checkContainerHealth} from '../../scripts/health-check.js';
describe('container liveness checks stay on the bounded local health route',()=>{
  it('rejects injected authorities before network access',async()=>{
    let calls=0;
    const fetcher=(async()=>{calls++;return Response.json({});}) as typeof fetch;
    for(const port of ['0','65536','8787/mcp','8787@external.test','08','-1'])expect(await checkContainerHealth(port,fetcher)).toBe(false);
    expect(calls).toBe(0);
  });
  it('accepts only the expected product and explicit ready=true',async()=>{
    const fetcher=(async(input,init)=>{
      expect(String(input)).toBe('http://127.0.0.1:8787/health');
      expect(init?.redirect).toBe('error');expect(init?.signal).toBeInstanceOf(AbortSignal);
      return Response.json({server:'ledgerflow-accounting-mcp',ready:true});
    }) as typeof fetch;
    expect(await checkContainerHealth('8787',fetcher)).toBe(true);
    for(const body of [{server:'other',ready:true},{server:'ledgerflow-accounting-mcp',ready:'true'},null]){
      expect(await checkContainerHealth('8787',async()=>Response.json(body))).toBe(false);
    }
  });
  it('fails closed on HTTP, malformed JSON and transport failures without exposing errors',async()=>{
    for(const fetcher of [async()=>new Response('private fixture',{status:503}),async()=>new Response('bad json'),async()=>{throw new Error('private fixture');}]){
      expect(await checkContainerHealth('8787',fetcher)).toBe(false);
    }
  });
});
