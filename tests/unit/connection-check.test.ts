import {describe,expect,it} from 'vitest';
import {generateFullErpSeed} from '@ledgerflow/test-data';
import {SERVER_NAME,TOOL_NAMES} from '../../apps/mcp-server/src/server.js';
import {localMcpEndpoint,inspectCodexEntry,inspectProjectClients,probeReadConnection,type ReadConnection} from '../../scripts/connection-check.js';
describe('read-only client readiness without native inference',()=>{
  it('rejects remote URLs, embedded credentials and ambiguous endpoint suffixes',()=>{
    for(const url of ['https://example.com/mcp','http://secret:secret@127.0.0.1/mcp','http://127.0.0.1/mcp?key=fixture','http://127.0.0.1/mcp#fragment','not a url']){
      expect(()=>localMcpEndpoint(url)).toThrow('INVALID_ENDPOINT');
    }
    expect(localMcpEndpoint('http://127.0.0.1:8787/mcp').href).toBe('http://127.0.0.1:8787/mcp');
  });
  it('compares both project clients and sanitizes native auth headers to boolean checks',async()=>{
    const endpoint='http://127.0.0.1:8787/mcp';
    expect(await inspectProjectClients(process.cwd(),endpoint)).toMatchObject({codex:{configured:true,endpointMatches:true,catalogMatches:true},claude_code:{configured:true,endpointMatches:true}});
    const result=inspectCodexEntry({enabled:true,transport:{type:'streamable_http',url:endpoint,http_headers:{Authorization:'fixture-hidden-token'}}},endpoint);
    expect(result).toEqual({registered:true,enabled:true,endpointMatches:true});expect(JSON.stringify(result)).not.toContain('fixture-hidden-token');
  });
  const seed=generateFullErpSeed(),company=seed.companies[0]!,period=seed.periods.find(p=>p.companyId===company.id)!;
  function connection(foreign=false,duplicate=false){
    const calls:string[]=[];
    const result=(value:unknown)=>({structuredContent:{ok:true,data:value}});
    const client:ReadConnection={async call(name){
      calls.push(name);
      if(name==='get_system_status')return result({server:SERVER_NAME,profile:'demo',tools:TOOL_NAMES,paidModelApi:false,ownOrchestrator:false,unattendedScheduler:false});
      if(name==='get_company_context')return result({companyId:company.id,name:company.name,origin:'synthetic_erp',functionalCurrency:'KRW',policyVersion:'fixture',accountingBasis:'K-IFRS_target_not_certified',
        periods:[{id:period.id,from:period.start,to:period.end,status:'open'}]});
      return result({items:[seed.transactions.find(row=>foreign?row.companyId!==company.id:row.companyId===company.id)]});
    },async list(){calls.push('list');return {tools:(duplicate?[...TOOL_NAMES.slice(0,-1),TOOL_NAMES[0]]:TOOL_NAMES).map(name=>({name}))};}};
    return {client,calls};
  }
  it('calls status/context first and performs only a bounded ERP read',async()=>{
    const {client,calls}=connection();expect(await probeReadConnection(client)).toMatchObject({reachable:true,toolCount:41,accountingMutations:0,publicApiCalls:0,paidModelApiCalls:0});
    expect(calls).toEqual(['get_system_status','get_company_context','list','get_transactions']);
  });
  it('refuses a spoofed company row or duplicate catalog instead of reporting readiness',async()=>{
    await expect(probeReadConnection(connection(true).client)).rejects.toThrow('COMPANY_MISMATCH');
    await expect(probeReadConnection(connection(false,true).client)).rejects.toThrow('CATALOG_MISMATCH');
  });
});
