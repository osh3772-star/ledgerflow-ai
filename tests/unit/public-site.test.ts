import {describe,expect,it,vi} from 'vitest';
import {generateFullErpSeed} from '@ledgerflow/test-data';
import type {PublicSiteSnapshot} from '@ledgerflow/contracts';
import {createPublicSiteRouter} from '../../apps/public-api-gateway/src/public-site.js';

const seed=generateFullErpSeed(),companyId=seed.companies[0]!.id;
const periodRows=seed.periods.filter(p=>p.companyId===companyId).map(p=>({id:p.id,from:p.start,to:p.end,status:'open'}));
const snapshot:PublicSiteSnapshot={schemaVersion:1,generatedAt:'2026-10-16T00:00:00.000Z',origin:'synthetic_erp',company:{companyId,name:'가상회사',periods:periodRows},
  transactions:seed.transactions,periods:Object.fromEntries(periodRows.map(p=>[p.from+'/'+p.to,{trialBalance:{items:[],totalDebit:'0',totalCredit:'0'},financialStatements:{source:'shared-service-export'},audit:{unpostedSources:[]}}])),
  referenceExample:{transactionId:seed.transactions[0]!.id,externalRef:'example',report:{transactionDate:'2026-01-01',preparedAt:'2026-10-16T00:00:00.000Z',items:[],humanReviewRequired:true,affectsAmounts:false}}};
const assets=()=>({fetch:vi.fn(async(_request:Request)=>Response.json(snapshot))});
const request=(path:string,method='GET')=>new Request('https://public.example'+path,{method});

describe('public site is a read-only synthetic snapshot, separate from the local ledger',()=>{
  it('never creates a human session or allows any public mutation, even with guessed authentication headers',async()=>{
    const route=createPublicSiteRouter(),files=assets();
    for(const path of ['/api/human/session','/api/human/decision','/api/human/close','/api/human/evidence']){
      const attempted=new Request(request(path,path.endsWith('session')?'GET':'POST'),{headers:{Authorization:'Bearer fixture-claim','Cookie':'lf_human='+'a'.repeat(64),'X-CSRF-Token':'fixture-claim'}});
      const response=await route(attempted,files);
      expect(response.status).toBe(403);expect(response.headers.has('set-cookie')).toBe(false);
    }
    expect((await route(request('/api/transactions','POST'),files)).status).toBe(403);
    expect(files.fetch).not.toHaveBeenCalled();
  });
  it('announces preview mode and reuses only the generated asset, never an external API or user database',async()=>{
    const route=createPublicSiteRouter(),files=assets();
    const context=await (await route(request('/api/context'),files)).json();
    expect(context).toMatchObject({publicPreview:true,humanApprovalMode:'unavailable',humanSessionStore:'none',publicApi:{mode:'preview'}});
    expect(JSON.stringify(context)).not.toMatch(/NTS_SERVICE_KEY|DART_API_KEY|ACCESS_TOKEN|DATABASE_URL/u);
    await route(request('/api/audit?from=2026-01-01&to=2026-01-31'),files);
    expect(files.fetch).toHaveBeenCalledTimes(1);
    expect(new URL(files.fetch.mock.calls[0]![0]!.url).pathname).toBe('/public-preview.json');
  });
  it('paginates all 1,000 primary-company rows without crossing a month or tenant',async()=>{
    const route=createPublicSiteRouter(),files=assets(),ids=new Set<string>();
    for(const period of periodRows){let cursor:string|null=null;
      do{const response=await route(request('/api/transactions?from='+period.from+'&to='+period.to+(cursor?'&cursor='+encodeURIComponent(cursor):'')),files);
        expect(response.status).toBe(200);const page=await response.json() as {items:typeof snapshot.transactions;nextCursor:string|null};
        expect(page.items.length).toBeLessThanOrEqual(50);
        for(const row of page.items){expect(row.companyId).toBe(companyId);expect(row.recognitionOn>=period.from&&row.recognitionOn<=period.to).toBe(true);expect(ids.has(row.id)).toBe(false);ids.add(row.id);}
        cursor=page.nextCursor;
      }while(cursor);
    }
    expect(ids.size).toBe(1000);
  });
  it('rejects tampered cursors, alternate company selectors, unknown routes and absent artifacts',async()=>{
    const route=createPublicSiteRouter(),files=assets();
    expect((await route(request('/api/transactions?cursor=garbage'),files)).status).toBe(400);
    expect((await route(request('/api/transactions?companyId=foreign'),files)).status).toBe(400);
    expect((await route(request('/api/journal?id=anything'),files)).status).toBe(404);
    expect((await createPublicSiteRouter()(request('/api/context'),{fetch:async()=>new Response(null,{status:404})})).status).toBe(503);
  });
  it('returns the exported reports and the explicitly selected reference example without inventing a posted ledger',async()=>{
    const route=createPublicSiteRouter(),files=assets();
    expect(await (await route(request('/api/journals'),files)).json()).toEqual([]);
    expect(await (await route(request('/api/financial-statements'),files)).json()).toEqual({source:'shared-service-export'});
    expect((await route(request('/api/public-references?transactionId=other'),files)).status).toBe(404);
    expect(await (await route(request('/api/public-references?transactionId='+snapshot.referenceExample.transactionId),files)).json()).toMatchObject({transactionId:snapshot.referenceExample.transactionId});
  });
});
