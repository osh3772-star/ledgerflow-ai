import type {Pool,PoolClient} from 'pg';
import {generateFullErpSeed,stableId,sha256,type FullErpSeed} from '@ledgerflow/test-data';
import {insertErpSubledgers} from '../../../scripts/seed-full-database.js';
import {uuidSchema,DomainError} from '@ledgerflow/contracts';

export type Workspace={userId:string;companyId:string;writerId:string};
// Bulk fixture import: avoid thousands of sequential DB round trips at the edge.
// Only this internal allowlisted schema is accepted; it is not a web/SQL tool.
export async function insertRemoteFoundation(client:PoolClient,data:FullErpSeed){
  const company=data.companies[0]!;
  await client.query('INSERT INTO public.companies(id,name,data_origin,policy_version) VALUES($1,$2,$3,$4)',[company.id,company.name,company.origin,company.policyVersion]);
  await client.query('INSERT INTO public.fiscal_periods(id,company_id,fiscal_year,start_date,end_date) SELECT id,"companyId",2026,start,"end" FROM jsonb_to_recordset($1::jsonb) AS r(id uuid,"companyId" uuid,start date,"end" date)',[JSON.stringify(data.periods)]);
  await client.query('INSERT INTO public.accounts(id,company_id,code,name,kind,normal_side) SELECT id,"companyId",code,name,kind,"normalSide" FROM jsonb_to_recordset($1::jsonb) AS r(id uuid,"companyId" uuid,code text,name text,kind text,"normalSide" text)',[JSON.stringify(data.accounts)]);
  await client.query("INSERT INTO public.source_documents(id,company_id,document_type,issue_date,origin,content,sha256) SELECT id,\"companyId\",kind,\"issueDate\",'synthetic_erp',content,sha256 FROM jsonb_to_recordset($1::jsonb) AS r(id uuid,\"companyId\" uuid,kind text,\"issueDate\" date,content jsonb,sha256 text)",[JSON.stringify(data.documents)]);
  const transactions=data.transactions.map(row=>({...row,payloadHash:sha256(row)}));
  await client.query('INSERT INTO public.business_transactions(id,company_id,period_id,source_document_id,external_ref,kind,occurred_on,recognition_on,currency,origin,net_amount,tax_amount,gross_amount,status,idempotency_key,payload_hash) SELECT id,"companyId","periodId","sourceDocumentId","externalRef",kind,"occurredOn","recognitionOn",currency,origin,net,tax,gross,status,"idempotencyKey","payloadHash" FROM jsonb_to_recordset($1::jsonb) AS r(id uuid,"companyId" uuid,"periodId" uuid,"sourceDocumentId" uuid,"externalRef" text,kind text,"occurredOn" date,"recognitionOn" date,currency text,origin text,net numeric,tax numeric,gross numeric,status text,"idempotencyKey" text,"payloadHash" text)',[JSON.stringify(transactions)]);
}
export function tenantFixture(userId:string):FullErpSeed {
  uuidSchema.parse(userId);
  const original=generateFullErpSeed(),primary=original.companies[0]!.id;
  const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
  function remap(value:unknown):unknown {
    if(typeof value==='string')return uuid.test(value)?stableId('remote/'+userId+'/'+value):value;
    if(Array.isArray(value))return value.map(remap);
    if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,remap(v)]));
    return value;
  }
  const filtered=Object.fromEntries(Object.entries(original).map(([k,v])=>[k,
    k==='identities'?[]:Array.isArray(v)?v.filter((row:{id?:string;companyId?:string})=>k==='companies'?row.id===primary:row.companyId===primary):v]));
  const data=remap(filtered) as FullErpSeed;
  data.companies[0]!.name='한빛유통 주식회사';
  for(const document of data.documents)document.sha256=sha256(document.content);
  const {manifest:_originalManifest,...payload}=data;
  data.manifest={sha256:sha256(payload),demoTransactions:data.transactions.length,isolationTransactions:0,totalTransactions:data.transactions.length};
  return data;
}
export async function provisionWorkspace(pool:Pool,verifiedUserId:string):Promise<Workspace>{
  const userId=uuidSchema.parse(verifiedUserId),client=await pool.connect();
  try{
    await client.query('BEGIN');
    await client.query("SET LOCAL statement_timeout='60s'");
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['remote-workspace/'+userId]);
    const existing=(await client.query('SELECT company_id,writer_id FROM private.remote_workspaces WHERE user_id=$1',[userId])).rows[0];
    if(existing){await client.query('COMMIT');return {userId,companyId:existing.company_id,writerId:existing.writer_id};}
    // Real users must already exist in Supabase Auth; never manufacture Auth rows.
    if(!(await client.query('SELECT 1 FROM auth.users WHERE id=$1',[userId])).rowCount)throw new Error('AUTH_USER_REQUIRED');
    await client.query('SELECT pg_advisory_xact_lock(20261017,1000)');
    if(Number((await client.query('SELECT count(*) AS n FROM private.remote_workspaces')).rows[0].n)>=25)
      throw new DomainError('WORKSPACE_CAPACITY_REACHED','체험 계정 정원이 찼습니다.');
    await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[userId]);
    const data=tenantFixture(userId),companyId=data.companies[0]!.id,writerId=stableId('remote-writer/'+userId);
    await insertRemoteFoundation(client,data);
    await insertErpSubledgers(client,data);
    await client.query('INSERT INTO private.execution_actors(id,company_id) VALUES($1,$2)',[writerId,companyId]);
    const ownerPrincipal=stableId('remote-owner/'+userId);
    await client.query("INSERT INTO public.company_memberships(company_id,user_id,role) VALUES($1,$2,'admin')",[companyId,userId]);
    await client.query("INSERT INTO public.principals(id,company_id,kind,user_id) VALUES($1,$2,'human',$3)",[ownerPrincipal,companyId,userId]);
    await client.query("INSERT INTO public.principals(id,company_id,kind,service_subject) VALUES($1,$2,'service',$3)",[writerId,companyId,'remote-mcp/'+userId]);
    for(const scope of ['erp:read','accounting:approve','accounting:close'])
      await client.query('INSERT INTO public.principal_scopes(company_id,principal_id,scope) VALUES($1,$2,$3)',[companyId,ownerPrincipal,scope]);
    for(const scope of ['erp:read','accounting:write','accounting:close'])
      await client.query('INSERT INTO public.principal_scopes(company_id,principal_id,scope) VALUES($1,$2,$3)',[companyId,writerId,scope]);
    await client.query('INSERT INTO private.remote_workspaces(user_id,company_id,writer_id) VALUES($1,$2,$3)',[userId,companyId,writerId]);
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query('COMMIT');return {userId,companyId,writerId};
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
