import type {Pool} from 'pg';
import {DomainError} from '@ledgerflow/contracts';
import {ErpService,AccountingService,AccountingReferenceService} from '@ledgerflow/application-services';
import {PostgresErpRepository,PostgresAccountingRepository} from '@ledgerflow/data-access';
import type {PublicDataClient} from '@ledgerflow/public-data';
import {companyContextSchema,type ServerDependencies} from './server.js';
import type {Workspace} from './remote-workspace.js';

export function remoteServices(pool:Pool,workspace:Workspace,actor:'human'|'mcp',publicData:PublicDataClient):ServerDependencies{
  const userId=actor==='mcp'?workspace.writerId:workspace.userId,companyId=workspace.companyId;
  const service=new ErpService(new PostgresErpRepository(pool,userId));
  const accounting=new AccountingService(new PostgresAccountingRepository(pool,userId),new AccountingReferenceService(publicData));
  return {service,accounting,publicData,companyId,profile:'postgres',
    async getCompanyContext(){
      const c=await pool.connect();try{
        await c.query('BEGIN');await c.query('SET LOCAL ROLE authenticated');
        await c.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[userId]);
        const company=(await c.query('SELECT id,name,data_origin,functional_currency,policy_version FROM public.companies WHERE id=$1',[companyId])).rows[0];
        if(!company)throw new DomainError('FORBIDDEN','회사 접근 권한을 확인하세요.');
        const periods=(await c.query('SELECT id,start_date::text AS "from",end_date::text AS "to",status FROM public.fiscal_periods WHERE company_id=$1 ORDER BY start_date',[companyId])).rows;
        await c.query('COMMIT');return companyContextSchema.parse({companyId,name:company.name,origin:company.data_origin,functionalCurrency:company.functional_currency,
          accountingBasis:'K-IFRS_target_not_certified',policyVersion:company.policy_version,periods});
      }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
    },
    async audit(event){await pool.query('INSERT INTO public.mcp_tool_calls(trace_id,company_id,tool_name,outcome,duration_ms,error_code) VALUES($1,$2,$3,$4,$5,$6)',
      [event.traceId,companyId,event.tool,event.outcome,event.durationMs,event.errorCode??null]);},
  };
}
