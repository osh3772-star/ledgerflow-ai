import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { generateFullErpSeed, sha256, stableId, type FullErpSeed } from '@ledgerflow/test-data';
import { ErpService } from '@ledgerflow/application-services';
import { PostgresTransactionRepository } from '@ledgerflow/data-access';
import { startLocalPostgres } from '../../scripts/local-postgres.js';
import { FULL_SEED_TABLES, seedFullDatabase } from '../../scripts/seed-full-database.js';

describe('native PostgreSQL full ERP atomic import and subledger controls', () => {
  const seed = generateFullErpSeed();
  const company = seed.companies[0]!.id, foreign = seed.companies[1]!.id;
  const userA = seed.identities.find((row) => row.companyId === company && row.role === 'preparer')!.userId;
  const userB = seed.identities.find((row) => row.companyId === foreign)!.userId;
  const viewer = seed.identities.find((row) => row.companyId === company && row.role === 'viewer')!.userId;
  let db: Awaited<ReturnType<typeof startLocalPostgres>>;
  beforeAll(async () => { db = await startLocalPostgres(); await seedFullDatabase(db.pool, seed); });
  afterAll(async () => { if (db) await db.stop(); });

  async function tx<T>(action: (client: PoolClient) => Promise<T>, user?: string | null) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      if (user !== undefined) {
        await client.query(user ? 'SET LOCAL ROLE authenticated' : 'SET LOCAL ROLE anon');
        if (user) await client.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [user]);
      }
      return await action(client);
    } finally { await client.query('ROLLBACK'); client.release(); }
  }
  async function createSource(client: PoolClient, kind: string, net = '100', tax = '0', date = '2026-12-30') {
    const id = randomUUID(), document = randomUUID(), ref = randomUUID();
    const period = seed.periods.find((row) => row.companyId === company && row.start <= date && row.end >= date)!;
    const content = { origin: 'synthetic_erp', transactionId: id, externalRef: ref };
    await client.query(`
      INSERT INTO public.source_documents(id,company_id,document_type,issue_date,origin,content,sha256)
      VALUES($1,$2,$3,$4,'synthetic_erp',$5,$6)
    `, [document,company,kind,date,content,sha256(content)]);
    await client.query(`
      INSERT INTO public.business_transactions(id,company_id,period_id,source_document_id,external_ref,kind,
        occurred_on,recognition_on,currency,origin,net_amount,tax_amount,gross_amount,status,idempotency_key,payload_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$7,'KRW','synthetic_erp',$8,$9,$8::numeric+$9::numeric,'unprocessed',$5,$10)
    `, [id,company,period.id,document,ref,kind,date,net,tax,'a'.repeat(64)]);
    return { id, document, date };
  }
  async function createCash(client: PoolClient, amount: string) {
    const source = await createSource(client, 'receipt', amount);
    const id = randomUUID();
    await client.query(`
      INSERT INTO public.bank_transactions(id,company_id,origin,bank_account_id,transaction_id,booked_on,direction,amount)
      VALUES($1,$2,'synthetic_erp',$3,$4,$5,'in',$6)
    `, [id,company,seed.bankAccounts[0]!.id,source.id,source.date,amount]);
    return { ...source, bankId: id };
  }
  async function insertAllocation(client: PoolClient, cash: { id: string; bankId: string }, invoiceId: string, amount: string) {
    return client.query(`
      INSERT INTO public.settlement_allocations(id,company_id,origin,bank_transaction_id,invoice_id,transaction_id,amount)
      VALUES($1,$2,'synthetic_erp',$3,$4,$5,$6)
    `, [randomUUID(),company,cash.bankId,invoiceId,cash.id,amount]);
  }
  async function insertInvoice(client: PoolClient, source: { id: string; document: string; date: string }, overrides: {
    counterparty?: string; net?: string; tax?: string; gross?: string; companyId?: string;
  } = {}) {
    const id = randomUUID();
    await client.query(`
      INSERT INTO public.invoices(id,company_id,origin,number,transaction_id,source_document_id,counterparty_id,
        direction,issue_date,net_amount,tax_amount,gross_amount,government_issued)
      VALUES($1::uuid,$2,'synthetic_erp',$1::text,$3,$4,$5,'sale',$6,$7,$8,$9,false)
    `, [id,overrides.companyId ?? company,source.id,source.document,overrides.counterparty ?? seed.counterparties[0]!.id,
      source.date,overrides.net ?? '100',overrides.tax ?? '0',overrides.gross ?? '100']);
    return id;
  }
  async function line(client: PoolClient, invoiceId: string, net = '100', quantity = '1', unitPrice = net, productId: string | null = null) {
    return client.query(`
      INSERT INTO public.invoice_lines(id,company_id,origin,invoice_id,product_id,description,quantity,unit_price,net_amount)
      VALUES($1,$2,'synthetic_erp',$3,$4,'synthetic test line',$5,$6,$7)
    `, [randomUUID(),company,invoiceId,productId,quantity,unitPrice,net]);
  }

  it('persists every fixture table and 1,001 business transactions with all RLS enabled/forced', async () => {
    expect((await db.pool.query('SELECT count(*)::int AS count FROM public.business_transactions')).rows[0].count).toBe(1001);
    for (const config of FULL_SEED_TABLES) {
      const rows = seed[config.key] as unknown[];
      expect((await db.pool.query('SELECT count(*)::int AS count FROM public.' + config.table)).rows[0].count).toBe(rows.length);
      const state = await db.pool.query('SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid=$1::regclass', ['public.' + config.table]);
      expect(state.rows[0]).toEqual({ relrowsecurity: true, relforcerowsecurity: true });
    }
    expect((await db.pool.query('SELECT count(*)::int AS count FROM public.audit_logs')).rows[0].count).toBe(5728);
  });
  it('serializes concurrent reimports, compares persisted rows, and creates no duplicate audit records', async () => {
    const results = await Promise.all([seedFullDatabase(db.pool, seed), seedFullDatabase(db.pool, seed)]);
    expect(results.every((row) => row.reused)).toBe(true);
    expect((await db.pool.query('SELECT count(*)::int AS count FROM public.audit_logs')).rows[0].count).toBe(5728);
    expect((await db.pool.query('SELECT count(*)::int AS count FROM private.seed_manifests')).rows[0].count).toBe(1);
  });
  it('reads all 1,000 events through the existing shared service in ten cursor pages', async () => {
    const service = new ErpService(new PostgresTransactionRepository(db.pool,userA));
    const ids = new Set<string>();
    let cursor: string | undefined, pages = 0;
    do {
      const page = await service.getTransactions({ companyId: company, from: '2026-01-01', to: '2026-12-31', limit: 100, ...(cursor ? { cursor } : {}) });
      for (const row of page.items) { expect(row.companyId).toBe(company); expect(ids.has(row.id)).toBe(false); ids.add(row.id); }
      cursor = page.nextCursor ?? undefined; pages++;
    } while (cursor);
    expect(ids.size).toBe(1000); expect(pages).toBe(10);
    await expect(service.getTransactions({ companyId: foreign, from:'2026-01-01',to:'2026-12-31' })).rejects.toMatchObject({ code:'FORBIDDEN' });
  });
  it('isolates every new table and audit history without application WHERE clauses', async () => {
    for (const table of [...FULL_SEED_TABLES.map((row) => row.table), 'audit_logs']) {
      for (const [user, expected] of [[userA,company],[userB,foreign]] as const) {
        const rows = await tx((client) => client.query('SELECT company_id FROM public.' + table),user);
        expect(rows.rows.every((row) => row.company_id === expected)).toBe(true);
      }
    }
    expect((await tx((client) => client.query('SELECT id FROM public.counterparties'),userA)).rows).toHaveLength(40);
    expect((await tx((client) => client.query('SELECT id FROM public.counterparties'),userB)).rows).toHaveLength(1);
  });
  it('denies anonymous reads, viewer inserts, all client updates/deletes, and direct allocation/proposal/audit inserts', async () => {
    for (const table of [...FULL_SEED_TABLES.map((row) => row.table),'audit_logs']) {
      await expect(tx((client) => client.query('SELECT * FROM public.' + table),null)).rejects.toMatchObject({code:'42501'});
      await expect(tx((client) => client.query('UPDATE public.' + table + ' SET origin=origin'),userA)).rejects.toMatchObject({code:'42501'});
      await expect(tx((client) => client.query('DELETE FROM public.' + table),userA)).rejects.toMatchObject({code:'42501'});
    }
    await expect(tx((client) => client.query("INSERT INTO public.counterparties(id,company_id,origin,name,role) VALUES($1,$2,'synthetic_erp','test','customer')",[randomUUID(),company]),viewer)).rejects.toMatchObject({code:'42501'});
    for (const table of ['settlement_allocations','adjustment_proposals','audit_logs'])
      await expect(tx((client) => client.query('INSERT INTO public.' + table + ' DEFAULT VALUES'),userA)).rejects.toMatchObject({code:'42501'});
  });
  it('allows own-company metadata insert, records the trusted actor, and blocks cross-company WITH CHECK', async () => {
    const id = randomUUID();
    await tx(async (client) => {
      await client.query("INSERT INTO public.counterparties(id,company_id,origin,name,role) VALUES($1,$2,'synthetic_erp','test','customer')",[id,company]);
      const audit = await client.query('SELECT actor_user_id,entity_type FROM public.audit_logs WHERE entity_id=$1',[id]);
      expect(audit.rows[0]).toEqual({actor_user_id:userA,entity_type:'counterparties'});
    },userA);
    await expect(tx((client) => client.query("INSERT INTO public.counterparties(id,company_id,origin,name,role) VALUES($1,$2,'synthetic_erp','test','customer')",[randomUUID(),foreign]),userA)).rejects.toMatchObject({code:'42501'});
    await expect(db.pool.query("UPDATE public.audit_logs SET action='erp_insert'")).rejects.toMatchObject({code:'23514'});
  });
  it('blocks cross-company counterparty/product/bank/asset references in SQL, including trusted importers', async () => {
    await expect(tx(async (client) => {
      const source = await createSource(client,'sale');
      await insertInvoice(client,source,{counterparty:seed.counterparties.at(-1)!.id});
    })).rejects.toMatchObject({code:'23503'});
    await expect(tx(async (client) => {
      const source = await createSource(client,'sale'), invoiceId = await insertInvoice(client,source);
      await line(client,invoiceId,'100','1','100',seed.products.at(-1)!.id);
    })).rejects.toMatchObject({code:'23503'});
    await expect(tx(async (client) => {
      const source = await createSource(client,'receipt');
      await client.query("INSERT INTO public.bank_transactions(id,company_id,origin,bank_account_id,transaction_id,booked_on,direction,amount) VALUES($1,$2,'synthetic_erp',$3,$4,$5,'in',100)",[randomUUID(),company,seed.bankAccounts.at(-1)!.id,source.id,source.date]);
    })).rejects.toMatchObject({code:'23503'});
    await expect(tx(async (client) => {
      const source = await createSource(client,'adjustment','10000','0','2026-12-31');
      await client.query("INSERT INTO public.adjustment_proposals(id,company_id,origin,transaction_id,type,asset_id,effective_on,amount,posting_state) VALUES($1,$2,'synthetic_erp',$3,'depreciation',$4,$5,10000,'proposed')",[randomUUID(),foreign,source.id,seed.fixedAssets[0]!.id,source.date]);
    })).rejects.toMatchObject({code:'23503'});
  });
  it('defers complete-package validation and allows matching invoice+lines in one transaction', async () => {
    await tx(async (client) => {
      const source = await createSource(client,'sale','100');
      const invoiceId = await insertInvoice(client,source);
      await line(client,invoiceId);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    },userA);
  });
  it('rejects missing lines, wrong source totals and wrong counterparty role at transaction completion', async () => {
    await expect(tx(async (client) => {
      const source = await createSource(client,'sale');
      await insertInvoice(client,source);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    })).rejects.toMatchObject({code:'23514',message:'INVOICE_PACKAGE_MISMATCH'});
    await expect(tx(async (client) => {
      const source = await createSource(client,'sale');
      const invoiceId = await insertInvoice(client,source,{net:'101',gross:'101'});
      await line(client,invoiceId,'101');
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    })).rejects.toMatchObject({code:'23514',message:'INVOICE_PACKAGE_MISMATCH'});
    await expect(tx(async (client) => {
      const source = await createSource(client,'sale');
      const invoiceId = await insertInvoice(client,source,{counterparty:seed.counterparties[20]!.id});
      await line(client,invoiceId);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    })).rejects.toMatchObject({code:'23514'});
  });
  it('rejects fractional KRW, fractional quantities, incorrect multiplication and public-data origin', async () => {
    for (const [net,quantity,unitPrice] of [['0.0000001','1','0.0000001'],['100','0.5','200'],['101','1','100']] as const)
      await expect(tx(async (client) => {
        const source = await createSource(client,'sale'), invoiceId = await insertInvoice(client,source);
        await line(client,invoiceId,net,quantity,unitPrice);
      })).rejects.toMatchObject({code:'23514'});
    await expect(tx((client) => client.query("INSERT INTO public.products(id,company_id,origin,sku,unit_cost,unit_price) VALUES($1,$2,'public_api_live','external',100,140)",[randomUUID(),company]))).rejects.toMatchObject({code:'23514'});
    await expect(tx((client) => client.query("INSERT INTO public.products(id,company_id,origin,sku,unit_cost,unit_price) VALUES($1,$2,'synthetic_erp','negative',-1,100)",[randomUUID(),company]))).rejects.toMatchObject({code:'23514'});
  });
  it('rejects child inserts into closed periods even when the source transaction already exists', async () => {
    const source = seed.transactions.find((row) => row.companyId===company && row.kind==='sale')!;
    await db.pool.query("UPDATE public.fiscal_periods SET status='closed' WHERE id=$1",[source.periodId]);
    try {
      await expect(tx((client) => client.query("INSERT INTO public.sales_contracts(id,company_id,origin,transaction_id,counterparty_id,delivered_on,performance_obligations) VALUES($1,$2,'synthetic_erp',$3,$4,$5,1)",[randomUUID(),company,source.id,seed.counterparties[0]!.id,source.recognitionOn]))).rejects.toMatchObject({code:'23514',message:'PERIOD_CLOSED'});
    } finally { await db.pool.query("UPDATE public.fiscal_periods SET status='open' WHERE id=$1",[source.periodId]); }
  });
  it('blocks unsupported bank directions and missing payroll evidence at completion', async () => {
    await expect(tx(async (client) => {
      const source = await createSource(client,'receipt');
      await client.query("INSERT INTO public.bank_transactions(id,company_id,origin,bank_account_id,transaction_id,booked_on,direction,amount) VALUES($1,$2,'synthetic_erp',$3,$4,$5,'out',100)",[randomUUID(),company,seed.bankAccounts[0]!.id,source.id,source.date]);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    })).rejects.toMatchObject({code:'23514',message:'BANK_SOURCE_MISMATCH'});
    await expect(tx(async (client) => {
      const source = await createSource(client,'payroll');
      await client.query("INSERT INTO public.bank_transactions(id,company_id,origin,bank_account_id,transaction_id,booked_on,direction,amount) VALUES($1,$2,'synthetic_erp',$3,$4,$5,'out',100)",[randomUUID(),company,seed.bankAccounts[0]!.id,source.id,source.date]);
      await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    })).rejects.toMatchObject({code:'23514'});
  });
  it('blocks over-allocation and wrong cash/source references', async () => {
    const settlement = seed.settlements[0]!;
    await expect(tx((client) => insertAllocation(client,{id:settlement.transactionId,bankId:settlement.bankTransactionId},settlement.invoiceId,'1'))).rejects.toMatchObject({code:'23514'});
    await expect(tx(async (client) => {
      const cash = await createCash(client,'100');
      const bill = seed.invoices.find((row) => row.companyId===company && row.direction==='purchase')!;
      await insertAllocation(client,cash,bill.id,'100');
    })).rejects.toMatchObject({code:'23514',message:'ALLOCATION_SOURCE_MISMATCH'});
  });
  it('detects persisted row tampering even if an attacker leaves receipt/hash columns unchanged', async () => {
    const original = seed.invoiceLines[0]!;
    await db.pool.query("UPDATE public.invoice_lines SET description='tampered' WHERE id=$1",[original.id]);
    try { await expect(seedFullDatabase(db.pool,seed)).rejects.toThrow('persisted invoice_lines differs'); }
    finally { await db.pool.query('UPDATE public.invoice_lines SET description=$1 WHERE id=$2',[original.description,original.id]); }
    const document = seed.documents[0]!;
    await db.pool.query("UPDATE public.source_documents SET content=content||'{\"tampered\":true}'::jsonb WHERE id=$1",[document.id]);
    try { await expect(seedFullDatabase(db.pool,seed)).rejects.toThrow('persisted evidence differs'); }
    finally { await db.pool.query('UPDATE public.source_documents SET content=$1 WHERE id=$2',[document.content,document.id]); }
  });
  it('rolls back the entire fresh tenant import, Auth rows and audit rows on a late FK failure', async () => {
    function remap(value: unknown): unknown {
      if (typeof value==='string' && /^[0-9a-f-]{36}$/u.test(value)) return stableId('rollback-test/'+value);
      if (Array.isArray(value)) return value.map(remap);
      if (value && typeof value==='object') return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,remap(item)]));
      return value;
    }
    const broken = remap(seed) as FullErpSeed;
    broken.generatorVersion+='-rollback';
    broken.documents.forEach((row)=>{row.sha256=sha256(row.content);});
    broken.adjustments.at(-1)!.prepaymentId=randomUUID();
    const {manifest,...payload}=broken; manifest.sha256=sha256(payload);
    const before = (await db.pool.query('SELECT count(*)::int AS count FROM public.audit_logs')).rows[0].count;
    await expect(seedFullDatabase(db.pool,broken)).rejects.toMatchObject({code:'23503'});
    expect((await db.pool.query('SELECT id FROM public.companies WHERE id=$1',[broken.companies[0]!.id])).rows).toHaveLength(0);
    expect((await db.pool.query('SELECT id FROM auth.users WHERE id=$1',[broken.identities[0]!.userId])).rows).toHaveLength(0);
    expect((await db.pool.query('SELECT count(*)::int AS count FROM public.audit_logs')).rows[0].count).toBe(before);
    expect((await db.pool.query('SELECT * FROM private.seed_manifests WHERE generator_version=$1',[broken.generatorVersion])).rows).toHaveLength(0);
  });
  it('rejects a modified manifest and refuses to provision users without the local bootstrap marker', async () => {
    const modified=structuredClone(seed); modified.invoices[0]!.net='1';
    await expect(seedFullDatabase(db.pool,modified)).rejects.toThrow('SEED_INTEGRITY');
    await db.pool.query('ALTER TABLE private.native_test_bootstrap RENAME TO native_test_bootstrap_hidden');
    try { await expect(seedFullDatabase(db.pool,seed)).rejects.toThrow('LOCAL_DEMO_ONLY'); }
    finally { await db.pool.query('ALTER TABLE private.native_test_bootstrap_hidden RENAME TO native_test_bootstrap'); }
  });
  it('rejects forged manifest counts and processed initial states even with a recomputed hash', async () => {
    const counts=structuredClone(seed); counts.manifest.demoTransactions=9999;
    await expect(seedFullDatabase(db.pool,counts)).rejects.toThrow('fixture counts or initial transaction states differ');
    const processed=structuredClone(seed);processed.transactions[0]!.status='processed';
    const {manifest,...payload}=processed;manifest.sha256=sha256(payload);
    await expect(seedFullDatabase(db.pool,processed)).rejects.toThrow('fixture counts or initial transaction states differ');
  });

  for (const isolation of ['READ COMMITTED','REPEATABLE READ'] as const) {
    it('prevents concurrent invoice over-allocation under '+isolation,async()=>{
      const setup=await db.pool.connect();
      let a: PoolClient|undefined,b: PoolClient|undefined;
      const cashRows: Awaited<ReturnType<typeof createCash>>[]=[];
      try {
        await setup.query('BEGIN');
        const bill=(await setup.query<{id:string;gross:string}>(`
          SELECT i.id,i.gross_amount::text AS gross FROM public.invoices i
          WHERE i.company_id=$1 AND i.direction='sale' AND NOT EXISTS(
            SELECT 1 FROM public.settlement_allocations a WHERE a.invoice_id=i.id)
          ORDER BY i.issue_date,i.id LIMIT 1
        `,[company])).rows[0]!;
        cashRows.push(await createCash(setup,String(BigInt(bill.gross)-150n)),await createCash(setup,'100'),await createCash(setup,'100'));
        await insertAllocation(setup,cashRows[0]!,bill.id,String(BigInt(bill.gross)-150n));
        await setup.query('COMMIT');
        a=await db.pool.connect();b=await db.pool.connect();
        await a.query('BEGIN ISOLATION LEVEL '+isolation);await b.query('BEGIN ISOLATION LEVEL '+isolation);
        await a.query("SET LOCAL statement_timeout='8s'");await b.query("SET LOCAL statement_timeout='8s'");
        const pid=(await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
        await b.query('SELECT amount FROM public.settlement_allocations WHERE invoice_id=$1',[bill.id]); // establish RR snapshot
        await insertAllocation(a,cashRows[1]!,bill.id,'100');
        const second=insertAllocation(b,cashRows[2]!,bill.id,'100').then(()=>({code:'unexpected-success'}),(error: {code:string})=>({code:error.code}));
        let waiting=false;
        for(let tries=0;tries<100;tries++){
          const state=await setup.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",[pid]);
          if(state.rows[0]?.wait_event_type==='Lock'){waiting=true;break;}
          await new Promise((done)=>setTimeout(done,20));
        }
        expect(waiting).toBe(true);
        await a.query('COMMIT');
        expect((await second).code).toBe(isolation==='READ COMMITTED'?'23514':'40001');
        await b.query('ROLLBACK');
        const total=(await setup.query('SELECT sum(amount)::text AS amount FROM public.settlement_allocations WHERE invoice_id=$1',[bill.id])).rows[0].amount;
        expect(BigInt(total)).toBe(BigInt(bill.gross)-50n);
      } finally {
        if(a){await a.query('ROLLBACK');a.release();}
        if(b){await b.query('ROLLBACK');b.release();}
        try{
          await setup.query('ROLLBACK');
          const ids=cashRows.map((row)=>row.id);
          await setup.query('DELETE FROM public.settlement_allocations WHERE transaction_id=ANY($1::uuid[])',[ids]);
          await setup.query('DELETE FROM public.bank_transactions WHERE transaction_id=ANY($1::uuid[])',[ids]);
          await setup.query('DELETE FROM public.transaction_documents WHERE transaction_id=ANY($1::uuid[])',[ids]);
          await setup.query('DELETE FROM public.business_transactions WHERE id=ANY($1::uuid[])',[ids]);
          await setup.query('DELETE FROM public.source_documents WHERE id=ANY($1::uuid[])',[cashRows.map((row)=>row.document)]);
        }finally{setup.release();}
      }
    });
  }
});
