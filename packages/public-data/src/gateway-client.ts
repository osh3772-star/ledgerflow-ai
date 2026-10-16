import {DomainError} from '@ledgerflow/contracts';
import {publicInputs,type API_TOOLS,type PublicDataClient,type PublicApiConfiguration} from './index.js';
export class GatewayPublicDataClient implements PublicDataClient{
  metrics={requests:0,cacheHits:0,retries:0,failures:0};
  private endpoint:URL;
  constructor(url:string,private token:string,private fetcher:typeof fetch=fetch){
    const target=new URL(url);
    if(target.protocol!=='https:'||target.username||target.password||target.search||target.hash||token.length<32||token.length>1024||/[\r\n]/u.test(token))
      throw new DomainError('GATEWAY_CONFIGURATION_INVALID','HTTPS 중계 주소와 별도 접속 토큰이 필요합니다.');
    target.pathname=target.pathname.replace(/\/$/u,'')+'/v1/query';this.endpoint=target;
  }
  configuration():PublicApiConfiguration{return {mode:'gateway',providers:(['nts','dart','law','ecos'] as const).map(provider=>({provider,configured:true}))};}
  async call(name:typeof API_TOOLS[number],raw:unknown):Promise<unknown>{
    const input=publicInputs[name].safeParse(raw);if(!input.success)throw new DomainError('INVALID_INPUT','공공 조회 조건을 확인하세요.');
    this.metrics.requests++;
    try{
      const response=await this.fetcher(this.endpoint,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+this.token},
        body:JSON.stringify({tool:name,input:input.data}),redirect:'error',signal:AbortSignal.timeout(28000)});
      if(!response.ok)throw new DomainError(response.status===401?'GATEWAY_AUTH_REQUIRED':response.status===429?'GATEWAY_RATE_LIMITED':'GATEWAY_UNAVAILABLE','중계 서버 연결을 확인하세요.');
      const reader=response.body?.getReader();if(!reader)throw new DomainError('GATEWAY_RESPONSE_INVALID','응답 형식을 확인하세요.');
      let size=0;const chunks:Uint8Array[]=[];
      while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>1048576){await reader.cancel();throw new DomainError('GATEWAY_RESPONSE_TOO_LARGE','응답 제한입니다.');}chunks.push(part.value);}
      const result=JSON.parse(Buffer.concat(chunks).toString('utf8')) as {ok?:boolean;data?:{provenance?:unknown}};
      if(result.ok!==true||!result.data)throw new DomainError('GATEWAY_RESPONSE_INVALID','중계 결과를 확인하세요.');
      const provenance=Array.isArray(result.data.provenance)?result.data.provenance:[result.data.provenance];
      if(!provenance.length||provenance.some(p=>!p||typeof p!=='object'||p.origin!=='public_api_live'))
        throw new DomainError('GATEWAY_NOT_LIVE','중계 응답이 실제 공공자료임을 확인할 수 없습니다.');
      if(provenance.every(p=>p.cacheHit===true))this.metrics.cacheHits++;
      return result.data;
    }catch(error){this.metrics.failures++;if(error instanceof DomainError)throw error;throw new DomainError('GATEWAY_UNAVAILABLE','중계 조회에 실패했습니다.');}
  }
}
