import { randomUUID } from 'node:crypto';
import { afterAll,beforeAll,describe,expect,it } from 'vitest';
import type { PoolClient } from 'pg';
import { ExactDecimal,type Invoice,type Page } from '@ledgerflow/contracts';
import { generateFullErpSeed,sha256 } from '@ledgerflow/test-data';
import { PostgresErpRepository } from '@ledgerflow/data-access';
import { ErpService } from '@ledgerflow/application-services';
import { startLocalPostgres } from '../../scripts/local-postgres.js';
import { seedFullDatabase } from '../../scripts/seed-full-database.js';
describe('shared ERP services on native PostgreSQL',()=>{
  const seed=generateFullErpSeed(),company=seed.companies[0]!.id,foreign=seed.companies[1]!.id;
  const preparer=seed.identities.find((row)=>row.companyId===company&&row.role==='preparer')!;
  const viewer=seed.identities.find((row)=>row.companyId===company&&row.role==='viewer')!;
  const range={companyId:company,from:'2026-01-01',to:'2026-12-31'};
  let db:Awaited<ReturnType<typeof startLocalPostgres>>,service:ErpService,readOnly:ErpService;
  beforeAll(async()=>{
    db=await startLocalPostgres();await seedFullDatabase(db.pool,seed);
    service=new ErpService(new PostgresErpRepository(db.pool,preparer.userId));
    readOnly=new ErpService(new PostgresErpRepository(db.pool,viewer.userId));
  });
  afterAll(async()=>{if(db)await db.stop();});
  const request=(patch:Record<string,unknown>={})=>{
    const ref=randomUUID();
    return {companyId:company,idempotencyKey:'create/'+ref,externalRef:'source/'+ref,kind:'sale',currency:'KRW',
      occurredOn:'2026-12-30',recognitionOn:'2026-12-30',counterpartyId:seed.counterparties[0]!.id,
      net:'100',tax:'10',gross:'110',documents:[{documentType:'synthetic_invoice',issueDate:'2026-12-30',
        content:{origin:'synthetic_erp',externalRef:ref,description:'한글 증빙 📄',quantity:1}}],...patch};
  };
  async function actor<T>(user:string|null,action:(client:PoolClient)=>Promise<T>){
    const client=await db.pool.connect();
    try{await client.query('BEGIN');await client.query(user?'SET LOCAL ROLE authenticated':'SET LOCAL ROLE anon');
      if(user)await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)",[user]);return await action(client);
    }finally{await client.query('ROLLBACK');client.release();}
  }
  async function invoicePages(options:Record<string,unknown>={}){
    const all:Invoice[]=[];let cursor:string|undefined;
    do{const page:Page<Invoice>=await service.getInvoices({...range,limit:17,...options,...(cursor?{cursor}:{})});
      all.push(...page.items);cursor=page.nextCursor??undefined;}while(cursor);
    return all;
  }
  it('paginates all 492 company invoices and returns exact lines, hashes, and correct sales/purchase filters',async()=>{
    const all=await invoicePages();expect(all).toHaveLength(492);expect(new Set(all.map((row)=>row.id)).size).toBe(492);
    expect(all.every((row)=>row.companyId===company&&row.governmentIssued===false)).toBe(true);
    expect(await invoicePages({direction:'sales'})).toHaveLength(260);
    expect(await invoicePages({direction:'purchase'})).toHaveLength(232);
    const sale=seed.transactions.find((row)=>row.externalRef==='LF26-SAL-0101')!;
    const page=await service.getInvoices({...range,transactionId:sale.id});
    expect(page.items[0]).toMatchObject({net:'2800',tax:'280',gross:'3080',direction:'sales',lines:[{quantity:'2',unitPrice:'1400',net:'2800'}]});
    expect(page.items[0]!.evidenceSha256).toBe(seed.documents.find((row)=>row.id===sale.sourceDocumentId)!.sha256);
  });
  it('paginates bank rows and exposes ERP allocation amounts without treating them as journal reconciliation',async()=>{
    let cursor:string|undefined;const ids:string[]=[];
    do{const page=await service.getBankTransactions({...range,limit:31,...(cursor?{cursor}:{})});
      for(const row of page.items){ids.push(row.id);expect(new ExactDecimal(row.erpAllocatedAmount).plus(row.erpUnallocatedAmount).eq(row.amount)).toBe(true);}
      cursor=page.nextCursor??undefined;}while(cursor);
    expect(ids).toHaveLength(414);expect(new Set(ids).size).toBe(414);
    const unmatched=await service.getBankTransactions({...range,unmatchedOnly:true,limit:100});
    expect(unmatched.items).toHaveLength(74);expect(unmatched.items.every((row)=>row.erpUnallocatedAmount===row.amount)).toBe(true);
    const filtered=await service.getBankTransactions({...range,bankAccountId:seed.bankAccounts[0]!.id});
    expect(filtered.items.every((row)=>row.bankAccountId===seed.bankAccounts[0]!.id)).toBe(true);
  });
  it('derives inventory from movements with an independent January gold position and a pending cost signal',async()=>{
    const product=seed.products[0]!;
    expect((await service.getInventory({companyId:company,asOf:'2026-01-31',productId:product.id})).items[0])
      .toMatchObject({quantity:'58',carryingAmount:'58000',movementCount:2,costStatus:'source_estimate'});
    expect((await service.getInventory({companyId:company,asOf:'2026-01-04',productId:product.id})).items[0]).toMatchObject({quantity:'0',carryingAmount:'0'});
    let cursor:string|undefined;const seen:string[]=[];
    do{const page=await service.getInventory({companyId:company,asOf:'2026-12-31',limit:7,...(cursor?{cursor}:{})});
      seen.push(...page.items.map((row)=>row.productId));cursor=page.nextCursor??undefined;}while(cursor);
    expect(new Set(seen).size).toBe(20);
    await db.pool.query('UPDATE public.products SET unit_cost=999 WHERE id=$1',[product.id]);
    try{expect((await service.getInventory({companyId:company,asOf:'2026-01-31',productId:product.id})).items[0])
      .toMatchObject({costStatus:'pending',carryingAmount:null,costPolicyVersion:null});}
    finally{await db.pool.query('UPDATE public.products SET unit_cost=$1 WHERE id=$2',[product.unitCost,product.id]);}
  });
  it('paginates counterparties, never invents registration numbers, and uses literal substring search',async()=>{
    let cursor:string|undefined;const ids:string[]=[];
    do{const page=await service.getCounterparties({companyId:company,limit:9,...(cursor?{cursor}:{})});
      ids.push(...page.items.map((row)=>row.id));expect(page.items.every((row)=>row.businessNoMasked===null)).toBe(true);cursor=page.nextCursor??undefined;}while(cursor);
    expect(new Set(ids).size).toBe(40);
    expect((await service.getCounterparties({companyId:company,query:'거래처 01'})).items).toHaveLength(1);
    expect((await service.getCounterparties({companyId:company,query:"%' OR 1=1 --"})).items).toHaveLength(0);
    expect((await service.getCounterparties({companyId:company,query:'%'})).items).toHaveLength(0);
  });
  it('binds cursors to endpoint/company/filters while allowing a different page size',async()=>{
    const first=await service.getInvoices({...range,limit:2,direction:'sales'}),cursor=first.nextCursor!;
    await expect(service.getInvoices({...range,cursor,direction:'purchase'})).rejects.toMatchObject({code:'INVALID_CURSOR'});
    await expect(service.getInvoices({...range,cursor,companyId:foreign,direction:'sales'})).rejects.toMatchObject({code:'INVALID_CURSOR'});
    await expect(service.getBankTransactions({...range,cursor})).rejects.toMatchObject({code:'INVALID_CURSOR'});
    expect((await service.getInvoices({...range,cursor,direction:'sales',limit:10})).items).toHaveLength(10);
    const corrupted=JSON.parse(Buffer.from(cursor,'base64url').toString('utf8'));corrupted.date=null;
    await expect(service.getInvoices({...range,direction:'sales',cursor:Buffer.from(JSON.stringify(corrupted)).toString('base64url')})).rejects.toMatchObject({code:'INVALID_CURSOR'});
  });
  it('enforces scope for every read, filters unprocessed/kind, audits calls, and clears pooled identity',async()=>{
    await expect(service.getInvoices({...range,companyId:foreign})).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(service.getBankTransactions({...range,companyId:foreign})).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(service.getInventory({companyId:foreign,asOf:'2026-12-31'})).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(service.getCounterparties({companyId:foreign})).rejects.toMatchObject({code:'FORBIDDEN'});
    const source=seed.transactions.find((row)=>row.companyId===company&&row.kind==='sale')!;
    await db.pool.query("UPDATE public.business_transactions SET status='processing' WHERE id=$1",[source.id]);
    try{expect((await service.getUnprocessedTransactions({...range,kind:'sale',limit:100})).items.some((row)=>row.id===source.id)).toBe(false);}
    finally{await db.pool.query("UPDATE public.business_transactions SET status='unprocessed' WHERE id=$1",[source.id]);}
    const first=await service.getTransactions({...range,kind:'sale',limit:2});
    await expect(service.getTransactions({...range,kind:'purchase',cursor:first.nextCursor!})).rejects.toMatchObject({code:'INVALID_CURSOR'});
    const audit=await db.pool.query("SELECT DISTINCT entity_type FROM public.audit_logs WHERE action='erp_read' AND actor_user_id=$1",[preparer.userId]);
    expect(new Set(audit.rows.map((row)=>row.entity_type))).toEqual(new Set(['business_transactions','invoices','bank_transactions','inventory','counterparties']));
    expect((await db.pool.query("SELECT current_user AS role,nullif(current_setting('request.jwt.claim.sub',true),'') AS uid")).rows[0])
      .toEqual({role:'postgres',uid:null});
  });
  it('creates a transaction with inline evidence, multiple document links, canonical hashes and actor audit atomically',async()=>{
    const input=request(),second={documentType:'delivery',issueDate:'2026-12-30',content:{origin:'synthetic_erp',description:'배송 완료'}};
    const created=await service.createTransaction({...input,documents:[...input.documents,second]});
    expect(created).toMatchObject({reused:false,transaction:{companyId:company,status:'unprocessed',net:'100',tax:'10',gross:'110',counterpartyId:seed.counterparties[0]!.id}});
    expect(created.documentIds).toHaveLength(2);
    const documents=await db.pool.query('SELECT id,content,sha256,storage_path FROM public.source_documents WHERE id=ANY($1::uuid[])',[created.documentIds]);
    for(const row of documents.rows){expect(row.sha256).toBe(sha256(row.content));expect(row.storage_path).toBe(null);}
    const links=await db.pool.query('SELECT document_id FROM public.transaction_documents WHERE transaction_id=$1 ORDER BY position',[created.transaction.id]);
    expect(links.rows.map((row)=>row.document_id)).toEqual(created.documentIds);
    const stored=await db.pool.query('SELECT payload_hash FROM public.business_transactions WHERE id=$1',[created.transaction.id]);
    expect(stored.rows[0].payload_hash).toBe(sha256(created.transaction));
    expect((await db.pool.query('SELECT actor_user_id FROM public.audit_logs WHERE entity_id=$1',[created.transaction.id])).rows[0].actor_user_id).toBe(preparer.userId);
  });
  it('serializes same-key concurrent creation and rejects changed payloads without another write',async()=>{
    const input=request();
    const results=await Promise.all([service.createTransaction(input),service.createTransaction(input)]);
    expect(new Set(results.map((row)=>row.transaction.id)).size).toBe(1);
    expect(results.map((row)=>row.reused).sort()).toEqual([false,true]);
    expect((await service.createTransaction({...input,net:'100.000000'})).reused).toBe(true);
    await expect(service.createTransaction({...input,externalRef:'changed'})).rejects.toMatchObject({code:'IDEMPOTENCY_CONFLICT'});
    expect((await db.pool.query('SELECT id FROM public.business_transactions WHERE idempotency_key=$1',[input.idempotencyKey])).rows).toHaveLength(1);
    const audit=await db.pool.query("SELECT id FROM public.audit_logs WHERE entity_id=$1 AND action='erp_insert'",[results[0]!.transaction.id]);
    expect(audit.rows).toHaveLength(1);
  });
  it('references existing same-company evidence and rejects missing/foreign documents or counterparties',async()=>{
    const {documents:_,...input}=request();
    expect((await service.createTransaction({...input,documentIds:[seed.documents[0]!.id,seed.documents[1]!.id]})).documentIds)
      .toEqual([seed.documents[0]!.id,seed.documents[1]!.id]);
    for(const documentId of [randomUUID(),seed.documents.find((row)=>row.companyId===foreign)!.id])
      await expect(service.createTransaction({...input,idempotencyKey:randomUUID(),externalRef:randomUUID(),documentIds:[documentId]})).rejects.toMatchObject({code:'REFERENCE_INVALID'});
    await expect(service.createTransaction(request({counterpartyId:seed.counterparties.at(-1)!.id}))).rejects.toMatchObject({code:'REFERENCE_INVALID'});
    await expect(service.createTransaction(request({counterpartyId:seed.counterparties[20]!.id}))).rejects.toMatchObject({code:'REFERENCE_INVALID'});
  });
  it('deduplicates inline evidence across requests while rejecting inconsistent metadata',async()=>{
    const first=request(),created=await service.createTransaction(first);
    const other=request({documents:first.documents}),reused=await service.createTransaction(other);
    expect(reused.documentIds).toEqual(created.documentIds);
    await expect(service.createTransaction(request({documents:[{...first.documents[0]!,issueDate:'2026-12-29'}]}))).rejects.toMatchObject({code:'DOCUMENT_CONFLICT'});
  });
  it('rolls back newly inserted evidence, links and audit on duplicate external reference or invalid later evidence',async()=>{
    const first=request();await service.createTransaction(first);
    const before=(await db.pool.query('SELECT count(*)::int AS count FROM public.audit_logs')).rows[0].count;
    const failed=request({externalRef:first.externalRef});
    await expect(service.createTransaction(failed)).rejects.toMatchObject({code:'DUPLICATE_SOURCE'});
    expect((await db.pool.query('SELECT id FROM public.source_documents WHERE sha256=$1',[sha256(failed.documents[0]!.content)])).rows).toHaveLength(0);
    expect((await db.pool.query('SELECT count(*)::int AS count FROM public.audit_logs')).rows[0].count).toBe(before);
    const fresh=request();
    await expect(service.createTransaction({...fresh,documents:[...fresh.documents,{...first.documents[0]!,issueDate:'2026-12-28'}]})).rejects.toMatchObject({code:'DOCUMENT_CONFLICT'});
    expect((await db.pool.query('SELECT id FROM public.source_documents WHERE sha256=$1',[sha256(fresh.documents[0]!.content)])).rows).toHaveLength(0);
  });
  it('returns a replay after period closure but rejects new writes, rechecks revoked permissions and supports exact large KRW',async()=>{
    const input=request({net:'999999999999999999',tax:'0',gross:'999999999999999999'});
    const created=await service.createTransaction(input);
    expect(created.transaction.net).toBe('999999999999999999');
    const period=created.transaction.periodId;
    await db.pool.query("UPDATE public.fiscal_periods SET status='closed' WHERE id=$1",[period]);
    try{expect((await service.createTransaction(input)).reused).toBe(true);
      await expect(service.createTransaction(request())).rejects.toMatchObject({code:'PERIOD_CLOSED'});}
    finally{await db.pool.query("UPDATE public.fiscal_periods SET status='open' WHERE id=$1",[period]);}
    await db.pool.query('UPDATE public.company_memberships SET active=false WHERE company_id=$1 AND user_id=$2',[company,preparer.userId]);
    try{await expect(service.createTransaction(input)).rejects.toMatchObject({code:'FORBIDDEN'});}
    finally{await db.pool.query('UPDATE public.company_memberships SET active=true WHERE company_id=$1 AND user_id=$2',[company,preparer.userId]);}
  });
  it('denies viewer and agent creation and cannot accept forged actor/state through the service or raw RPC',async()=>{
    const input=request();
    await expect(readOnly.createTransaction(input)).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(service.createTransaction({...input,actorUserId:preparer.userId,status:'processed'})).rejects.toMatchObject({code:'INVALID_INPUT'});
    await expect(actor(preparer.userId,(client)=>client.query('SELECT public.create_erp_transaction($1::jsonb)',[JSON.stringify({...input,status:'processed'})]))).rejects.toMatchObject({code:'23514',message:'INVALID_INPUT'});
    await expect(actor(null,(client)=>client.query('SELECT public.create_erp_transaction($1::jsonb)',[JSON.stringify(input)]))).rejects.toMatchObject({code:'42501'});
    await db.pool.query("UPDATE public.principals SET kind='agent',user_id=NULL,service_subject='test-agent' WHERE id=$1",[preparer.principalId]);
    try{await expect(service.createTransaction(input)).rejects.toMatchObject({code:'FORBIDDEN'});}
    finally{await db.pool.query("UPDATE public.principals SET kind='human',user_id=$1,service_subject=NULL WHERE id=$2",[preparer.userId,preparer.principalId]);}
    await db.pool.query("INSERT INTO public.principal_scopes(company_id,principal_id,scope) VALUES($1,$2,'erp:write')",[company,viewer.principalId]);
    try{await expect(readOnly.createTransaction(input)).rejects.toMatchObject({code:'FORBIDDEN'});}
    finally{await db.pool.query("DELETE FROM public.principal_scopes WHERE company_id=$1 AND principal_id=$2 AND scope='erp:write'",[company,viewer.principalId]);}
  });
});
