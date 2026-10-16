import {describe,expect,it,vi} from 'vitest';
import {MemoryApiCache,GatewayPublicDataClient} from '@ledgerflow/public-data';
import {createReferenceGateway,EdgeApiCache,type GatewayEnvironment} from '../../apps/public-api-gateway/src/worker.js';

const token='test-access-token-not-a-real-secret-123456';
const environment=():GatewayEnvironment=>({NTS_SERVICE_KEY:'nts-fixture',DART_API_KEY:'dart-fixture',LAW_OC:'law-fixture',ECOS_API_KEY:'ecos-fixture',GATEWAY_ACCESS_TOKEN:token,
  REFERENCE_RATE_LIMITER:{limit:async()=>({success:true})}});
const query=(input:unknown={businessNumbers:['0000000000']},tool='get_business_status',auth=token)=>new Request('https://gateway.example/v1/query',{method:'POST',headers:{'content-type':'application/json',authorization:'Bearer '+auth},body:JSON.stringify({tool,input})});

describe('read-only public reference gateway and local MCP client',()=>{
  it('exposes no MCP or ledger routes and refuses unauthenticated queries before calling providers',async()=>{
    const fetcher=vi.fn(),gateway=createReferenceGateway({cache:new MemoryApiCache(),fetcher});
    expect(await (await gateway.fetch(new Request('https://gateway.example/health'),environment())).json()).toMatchObject({mcpServer:false,ledgerAccess:false});
    expect((await gateway.fetch(new Request('https://gateway.example/mcp'),environment())).status).toBe(404);
    expect((await gateway.fetch(query(undefined,'get_business_status','wrong'),environment())).status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('fails closed for missing provider secrets or the rate limiter',async()=>{
    const gateway=createReferenceGateway({cache:new MemoryApiCache()}),env=environment();env.DART_API_KEY='';
    expect((await gateway.fetch(query(),env)).status).toBe(503);
    expect((await gateway.fetch(query(),{...environment(),REFERENCE_RATE_LIMITER:undefined} as unknown as GatewayEnvironment)).status).toBe(503);
  });
  it('rejects arbitrary tools, URLs and oversized bodies without upstream requests',async()=>{
    const fetcher=vi.fn(),gateway=createReferenceGateway({cache:new MemoryApiCache(),fetcher});
    expect((await gateway.fetch(query({},'execute_sql'),environment())).status).toBe(400);
    expect((await gateway.fetch(query({businessNumbers:['0000000000'],url:'http://internal/'}),environment())).status).toBe(400);
    expect((await gateway.fetch(query({junk:'x'.repeat(17000)}),environment())).status).toBe(400);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('enforces quota before performing a paid-by-owner public API request',async()=>{
    const fetcher=vi.fn(),gateway=createReferenceGateway({cache:new MemoryApiCache(),fetcher});
    const env={...environment(),REFERENCE_RATE_LIMITER:{limit:async()=>({success:false})}};
    expect((await gateway.fetch(query(),env)).status).toBe(429);expect(fetcher).not.toHaveBeenCalled();
  });
  it('reuses live responses and logs only tool, outcome and timing',async()=>{
    const fetcher=vi.fn(async()=>Response.json({status_code:'OK',data:[{b_no:'0000000000',b_stt_cd:'01',tax_type:'일반과세'}]})),events:unknown[]=[];
    const gateway=createReferenceGateway({cache:new MemoryApiCache(),fetcher,log:event=>events.push(event)});
    const first=await (await gateway.fetch(query(),environment())).json(),second=await (await gateway.fetch(query(),environment())).json();
    expect(first).toMatchObject({ok:true,data:{provenance:{origin:'public_api_live',cacheHit:false}}});
    expect(second).toMatchObject({ok:true,data:{provenance:{cacheHit:true}}});expect(fetcher).toHaveBeenCalledTimes(1);
    for(const secret of [token,'nts-fixture','0000000000'])expect(JSON.stringify([first,second,events])).not.toContain(secret);
    expect(Object.keys(events[0] as object).sort()).toEqual(['durationMs','outcome','tool']);
  });
  it('keeps the owner keys out of client requests and rejects mock relay responses',async()=>{
    const provenance={origin:'public_api_live',cacheHit:true},fetcher=vi.fn(async()=>Response.json({ok:true,data:{provenance}}));
    const client=new GatewayPublicDataClient('https://gateway.example',token,fetcher);
    await client.call('get_business_status',{businessNumbers:['0000000000']});
    expect(fetcher.mock.calls[0]).toBeDefined();
    expect(client.metrics).toMatchObject({requests:1,cacheHits:1});
    const mockClient=new GatewayPublicDataClient('https://gateway.example',token,async()=>Response.json({ok:true,data:{provenance:{origin:'mock'}}}));
    await expect(mockClient.call('get_business_status',{businessNumbers:['0000000000']})).rejects.toMatchObject({code:'GATEWAY_NOT_LIVE'});
    expect(()=>new GatewayPublicDataClient('http://gateway.example',token)).toThrow();
    expect(()=>new GatewayPublicDataClient('https://gateway.example?token=bad',token)).toThrow();
  });
  it('does not bind Workers global fetch to the adapter instance',async()=>{
    const nativeLikeFetch=function(this:unknown,_input:unknown,init?:RequestInit){
      if(this!==undefined&&this!==globalThis)throw new TypeError('Illegal invocation');
      expect(init?.redirect).toBe('manual');
      return Promise.resolve(Response.json({status_code:'OK',data:[{b_no:'0000000000',b_stt_cd:'01'}]}));
    };
    vi.stubGlobal('fetch',nativeLikeFetch);
    try{const gateway=createReferenceGateway({cache:new MemoryApiCache()});
      expect((await gateway.fetch(query(),environment())).status).toBe(200);
    }finally{vi.unstubAllGlobals();}
  });
  it('rejects redirects without forwarding provider credentials to a new host',async()=>{
    const fetcher=vi.fn(async()=>new Response(null,{status:302,headers:{location:'https://untrusted.example/collect'}}));
    const gateway=createReferenceGateway({cache:new MemoryApiCache(),fetcher});
    const response=await gateway.fetch(query(),environment());
    expect(response.status).toBe(502);expect(await response.json()).toMatchObject({error:{code:'PROVIDER_HTTP_302'}});
    expect(fetcher).toHaveBeenCalledTimes(1);expect(fetcher.mock.calls[0]).toBeDefined();
  });
  it('returns only a numeric DART rejection code without exposing the service message or key',async()=>{
    const gateway=createReferenceGateway({cache:new MemoryApiCache(),fetcher:async()=>Response.json({status:'012',message:'secret-provider-message'})});
    const result=await (await gateway.fetch(query({corpCode:'00126380',year:2025},'get_financial_statements'),environment())).json();
    expect(result).toEqual({ok:false,error:{code:'DART_012'}});
    expect(JSON.stringify(result)).not.toContain('secret-provider-message');
  });
  it('uses hashed cache keys with expiry and forbids request URLs as cache keys',async()=>{
    const entries=new Map<string,Response>(),cache=new EdgeApiCache({match:async key=>entries.get(key)?.clone(),put:async(key,value)=>{entries.set(key,value);}});
    const record={response:{safe:true},origin:'public_api_live' as const,fetchedAt:new Date().toISOString(),expiresAt:new Date(Date.now()+60000).toISOString(),sourceUrl:'https://ecos.bok.or.kr/api/StatisticSearch'};
    await cache.put('a'.repeat(64),'ecos',record);expect(await cache.get('a'.repeat(64))).toEqual(record);
    await expect(cache.get('https://api.example/?key=secret')).rejects.toThrow('CACHE_KEY_INVALID');
  });
});
