import { appendFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';
import { generateFullErpSeed } from '@ledgerflow/test-data';
import { PostgresErpRepository,PostgresAccountingRepository,PostgresApiCache } from '@ledgerflow/data-access';
import { ErpService,AccountingService,AccountingReferenceService } from '@ledgerflow/application-services';
import {PublicDataService,GatewayPublicDataClient} from '@ledgerflow/public-data';
import {createHumanRouter} from '../apps/mcp-server/src/human-routes.js';
import {supabaseHumanAuthentication} from '../apps/mcp-server/src/supabase-auth.js';
import {supabaseEvidenceStorage} from '../apps/mcp-server/src/evidence-storage.js';
import { DomainError, uuidSchema } from '@ledgerflow/contracts';
import { companyContextSchema, type ServerDependencies } from '../apps/mcp-server/src/server.js';
import { startLocalPostgres } from './local-postgres.js';
import { seedFullDatabase } from './seed-full-database.js';
import {assertDatabaseReady} from './database-readiness.js';
import {validateSessionEncryptionKey} from '../apps/mcp-server/src/human-session-store.js';
import {PostgresHumanSessionStore} from '../apps/mcp-server/src/postgres-human-session-store.js';
import {databasePoolOptions} from './postgres-connection.js';

export async function createMcpRuntime(environment: NodeJS.ProcessEnv = process.env) {
  const profile = environment.LEDGERFLOW_MCP_MODE ?? 'demo';
  if (profile !== 'demo' && profile !== 'postgres') throw new Error('LEDGERFLOW_MCP_MODE must be demo or postgres.');
  const sessionMode=environment.LEDGERFLOW_HUMAN_SESSION_STORE??'memory';
  if(!['memory','postgres'].includes(sessionMode))throw new Error('LEDGERFLOW_HUMAN_SESSION_STORE must be memory or postgres.');
  if(sessionMode==='postgres'){
    if(profile!=='postgres'||!environment.SUPABASE_URL?.trim()||!environment.SUPABASE_PUBLISHABLE_KEY?.trim())
      throw new Error('Persistent human sessions require postgres mode and external Supabase Auth configuration.');
    validateSessionEncryptionKey(environment.LEDGERFLOW_SESSION_ENCRYPTION_KEY??'');
  }
  let pool: pg.Pool, stopDatabase: () => Promise<void>, companyId: string, userId: string;
  let demoApproverId:string|undefined;
  if (profile === 'demo') {
    if (environment.LEDGERFLOW_DATABASE_URL?.trim())
      throw new Error('A database URL is set. Select postgres mode explicitly or remove the URL for the temporary demo.');
    const database = await startLocalPostgres();
    pool = database.pool; stopDatabase = () => database.stop();
    try {
      const seed = generateFullErpSeed();
      await seedFullDatabase(pool,seed);
      companyId = seed.companies[0]!.id;
      userId = seed.identities.find((row)=>row.companyId===companyId && row.role==='viewer')!.userId;
      const reader=seed.identities.find(row=>row.userId===userId)!;
      const approver=seed.identities.find(row=>row.companyId===companyId&&row.role==='preparer')!;
      demoApproverId=approver.userId;
      await pool.query('INSERT INTO public.principal_scopes(company_id,principal_id,scope) VALUES($1,$2,$3),($1,$2,$4),($1,$5,$6),($1,$5,$4) ON CONFLICT DO NOTHING',
        [companyId,reader.principalId,'accounting:write','accounting:close',approver.principalId,'accounting:approve']);
    } catch (error) { await stopDatabase(); throw error; }
  } else {
    if (!environment.LEDGERFLOW_DATABASE_URL?.trim()) throw new Error('postgres mode requires a server-side database URL.');
    const company = uuidSchema.safeParse(environment.LEDGERFLOW_COMPANY_ID), user = uuidSchema.safeParse(environment.LEDGERFLOW_USER_ID);
    if (!company.success || !user.success) throw new Error('postgres mode requires valid server-side company/user IDs.');
    companyId = company.data; userId = user.data;
    pool = new pg.Pool(await databasePoolOptions(environment));
    stopDatabase = () => pool.end();
  }
  try {
  await assertDatabaseReady(pool);
  const directory = resolve('.ledgerflow/mcp-audit');
  await mkdir(directory,{recursive:true});
  const auditFile = resolve(directory,'tool-calls.jsonl');
  const publicData=environment.LEDGERFLOW_PUBLIC_GATEWAY_URL?.trim()
    ?new GatewayPublicDataClient(environment.LEDGERFLOW_PUBLIC_GATEWAY_URL,environment.LEDGERFLOW_PUBLIC_GATEWAY_TOKEN??'')
    :new PublicDataService({nts:environment.NTS_SERVICE_KEY,dart:environment.DART_API_KEY,law:environment.LAW_OC,ecos:environment.ECOS_API_KEY},
      environment.ADAPTER_MODE==='live'?'live':'mock',new PostgresApiCache(pool));
  const referenceReview=new AccountingReferenceService(publicData);
  const dependencies: ServerDependencies = {
    service: new ErpService(new PostgresErpRepository(pool,userId)), companyId, profile,
    accounting:new AccountingService(new PostgresAccountingRepository(pool,userId),referenceReview),publicData,
    ...(environment.LEDGERFLOW_MCP_TOKEN?.trim()?{mcpToken:environment.LEDGERFLOW_MCP_TOKEN}:{}),
    async getCompanyContext() {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('SET LOCAL ROLE authenticated');
        await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[userId]);
        const permission = await client.query<{allowed:boolean}>("SELECT private.has_company_scope($1::uuid,'erp:read') AS allowed",[companyId]);
        if (!permission.rows[0]?.allowed) throw new DomainError('FORBIDDEN','회사 조회 권한이 없습니다.');
        const companies = await client.query('SELECT name, data_origin, functional_currency, policy_version FROM public.companies WHERE id=$1',[companyId]);
        const periods = await client.query('SELECT id,start_date::text,end_date::text,status FROM public.fiscal_periods WHERE company_id=$1 ORDER BY start_date',[companyId]);
        const company = companies.rows[0];
        if (!company) throw new DomainError('FORBIDDEN','회사 조회 권한이 없습니다.');
        const result = companyContextSchema.parse({companyId,name:company.name,origin:company.data_origin,
          functionalCurrency:company.functional_currency,accountingBasis:'K-IFRS_target_not_certified',policyVersion:company.policy_version,
          periods:periods.rows.map((row)=>({id:row.id,from:row.start_date,to:row.end_date,status:row.status}))});
        await client.query('COMMIT');
        return result;
      } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
    },
    async audit(event) {
      await appendFile(auditFile, JSON.stringify({ at:new Date().toISOString(), server:'ledgerflow-accounting-mcp',
        actor:'server_bound_erp_reader', profile, ...event })+'\n','utf8');
      await pool.query('INSERT INTO public.mcp_tool_calls(trace_id,company_id,tool_name,outcome,duration_ms,error_code) VALUES($1,$2,$3,$4,$5,$6)',
        [event.traceId,event.companyId,event.tool,event.outcome,event.durationMs,event.errorCode??null]);
    },
  };
  const authentication=profile==='postgres'&&environment.SUPABASE_URL&&environment.SUPABASE_PUBLISHABLE_KEY
    ?supabaseHumanAuthentication(environment.SUPABASE_URL,environment.SUPABASE_PUBLISHABLE_KEY)
    :undefined;
  let sessionStore:PostgresHumanSessionStore|undefined;
  if(sessionMode==='postgres'){
    sessionStore=new PostgresHumanSessionStore(pool,companyId,environment.LEDGERFLOW_SESSION_ENCRYPTION_KEY!);
    await sessionStore.assertReady();
  }
  dependencies.humanRouter=createHumanRouter({...(authentication?{authentication}:{}),
    ...(sessionStore?{sessionStore}:{}),
    ...(demoApproverId?{localDemoUserId:demoApproverId}:{}),
    ...(authentication&&environment.SUPABASE_URL&&environment.SUPABASE_PUBLISHABLE_KEY?{evidenceStorage:supabaseEvidenceStorage(environment.SUPABASE_URL,environment.SUPABASE_PUBLISHABLE_KEY)}:{}),
    accounting:id=>new AccountingService(new PostgresAccountingRepository(pool,id),referenceReview),reader:dependencies.accounting!,
    publicApiConfiguration:()=>publicData.configuration(),
    companyId,companyContext:()=>dependencies.getCompanyContext(),erp:dependencies.service as ErpService});
  await dependencies.getCompanyContext();
  let closed=false;
  return { dependencies, async close() { if(!closed){closed=true;await stopDatabase();} } };
  }catch(error){await stopDatabase();throw error;}
}
