import {describe,expect,it,vi} from 'vitest';
import {DomainError} from '@ledgerflow/contracts';
import type {AccountingService} from '@ledgerflow/application-services';
import {createHumanRouter} from '../../apps/mcp-server/src/human-routes.js';
import {memoryHumanSessionStore,type HumanSessionStore} from '../../apps/mcp-server/src/human-session-store.js';
const companyId='00000000-0000-4000-8000-000000000001',operator='00000000-0000-4000-8000-000000000002';
const reader={} as AccountingService;
const common={accounting:()=>reader,reader,companyId,companyContext:async()=>({companyId})};
const request=(path:string,headers:Record<string,string>={})=>new Request('http://127.0.0.1:8787/api/human/'+path,{headers});
describe('login-free local demo session and persistent DB boundary',()=>{
  it('requires same-origin browser context and reuses a local session without creating decisions',async()=>{
    const router=createHumanRouter({...common,localDemoUserId:operator});
    expect((await router(request('session'))).status).toBe(403);
    expect((await router(request('session',{'Sec-Fetch-Site':'same-origin',Origin:'https://evil.example'}))).status).toBe(403);
    const session=await router(request('session',{'Sec-Fetch-Site':'same-origin'}));
    expect(session.status).toBe(200);
    const body=await session.json() as {csrf:string},cookie=session.headers.get('set-cookie')!.split(';')[0]!;
    expect(session.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');
    expect(await (await router(request('session',{'Sec-Fetch-Site':'same-origin',Cookie:cookie}))).json()).toEqual(body);
  });
  it('does not grant an anonymous operator to an existing DB profile or retain login endpoints',async()=>{
    const router=createHumanRouter(common);
    expect((await router(request('session',{'Sec-Fetch-Site':'same-origin'}))).status).toBe(401);
    expect((await router(new Request('http://127.0.0.1:8787/api/human/login',{method:'POST'}))).status).toBe(404);
  });
  it('validates an external JWT to establish a persistent session and rechecks it on reuse',async()=>{
    const verify=vi.fn(async(token:string)=>{
      if(token!=='fixture-valid-token')throw new DomainError('UNAUTHENTICATED','Invalid test token.');
      return operator;
    });
    const router=createHumanRouter({...common,authentication:{verify}});
    expect((await router(request('session',{'Sec-Fetch-Site':'same-origin',Authorization:'Bearer fixture-invalid-token'}))).status).toBe(401);
    const session=await router(request('session',{'Sec-Fetch-Site':'same-origin',Authorization:'Bearer fixture-valid-token'}));
    expect(session.status).toBe(200);
    const cookie=session.headers.get('set-cookie')!.split(';')[0]!;
    await router(request('session',{'Sec-Fetch-Site':'same-origin',Cookie:cookie}));
    expect(verify).toHaveBeenCalledTimes(3);
  });
  it('revokes a stored session when the external JWT is withdrawn',async()=>{
    let active=true;const store=memoryHumanSessionStore();
    const verify=vi.fn(async()=>{if(!active)throw new DomainError('UNAUTHENTICATED','revoked fixture');return operator;});
    const router=createHumanRouter({...common,sessionStore:store,authentication:{verify}});
    const first=await router(request('session',{'Sec-Fetch-Site':'same-origin',Authorization:'Bearer fixture-token'}));
    const cookie=first.headers.get('set-cookie')!.split(';')[0]!,raw=cookie.split('=')[1]!;
    active=false;
    expect((await router(request('session',{'Sec-Fetch-Site':'same-origin',Cookie:cookie}))).status).toBe(401);
    expect(await store.get(raw)).toBeUndefined();
  });
  it('never accepts a cached identity without its required external access token',async()=>{
    const store=memoryHumanSessionStore(),raw='a'.repeat(64);
    await store.put(raw,{userId:operator,csrf:'c'.repeat(48),expires:Date.now()+60000});
    const router=createHumanRouter({...common,sessionStore:store,authentication:{verify:async()=>operator}});
    expect((await router(request('session',{'Sec-Fetch-Site':'same-origin',Cookie:'lf_human='+raw}))).status).toBe(401);
    expect(await store.get(raw)).toBeUndefined();
  });
  it('returns a sanitized service failure rather than falling back to a demo identity',async()=>{
    const store:HumanSessionStore={kind:'postgres',async get(){throw new DomainError('SESSION_STORE_UNAVAILABLE','private-db-fixture');},async put(){},async delete(){}};
    const router=createHumanRouter({...common,sessionStore:store,authentication:{verify:async()=>operator}});
    const response=await router(request('session',{'Sec-Fetch-Site':'same-origin',Cookie:'lf_human='+'a'.repeat(64)}));
    expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'SESSION_STORE_UNAVAILABLE'});
  });
  it('marks a browser cookie Secure only when the request itself uses HTTPS',async()=>{
    const router=createHumanRouter({...common,localDemoUserId:operator});
    const response=await router(new Request('https://app.fixture.example/api/human/session',{headers:{'Sec-Fetch-Site':'same-origin'}}));
    expect(response.headers.get('set-cookie')).toContain('; Secure');
    expect((await router(request('session',{'Sec-Fetch-Site':'same-origin'}))).headers.get('set-cookie')).not.toContain('; Secure');
  });
});
