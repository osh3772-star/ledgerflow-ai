import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PoolClient } from 'pg';
import { ErpService } from '@ledgerflow/application-services';
import { PostgresTransactionRepository } from '@ledgerflow/data-access';
import { generateMiniSeed, FIXTURE_IDS, sha256 } from '@ledgerflow/test-data';
import { startLocalPostgres } from '../../scripts/local-postgres.js';
import { seedMiniDatabase } from '../../scripts/seed-database.js';

describe('native PostgreSQL ERP integrity and tenant isolation', () => {
  let db: Awaited<ReturnType<typeof startLocalPostgres>>;
  const seed = generateMiniSeed();
  const queryA = { companyId: FIXTURE_IDS.companyA, from: '2026-01-01', to: '2026-01-31' };
  let serviceA: ErpService;
  let serviceB: ErpService;
  beforeAll(async () => {
    db = await startLocalPostgres();
    await seedMiniDatabase(db.pool, seed);
    serviceA = new ErpService(new PostgresTransactionRepository(db.pool, FIXTURE_IDS.userA));
    serviceB = new ErpService(new PostgresTransactionRepository(db.pool, FIXTURE_IDS.userB));
  });
  afterAll(async () => { if (db) await db.stop(); });

  async function actor<T>(user: string | null, action: (client: PoolClient) => Promise<T>) {
    const client = await db.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(user ? 'SET LOCAL ROLE authenticated' : 'SET LOCAL ROLE anon');
      if (user) await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [user]);
      return await action(client);
    } finally {
      await client.query('ROLLBACK'); // Keeps fixture data unchanged for every test.
      client.release();
    }
  }
  async function insert(client: PoolClient, patch: Record<string, string> = {}) {
    const row = { ...seed.transactions[0]!, id: randomUUID(), externalRef: randomUUID(), idempotencyKey: randomUUID(), ...patch };
    return client.query(`
      INSERT INTO public.business_transactions(id,company_id,period_id,source_document_id,external_ref,kind,
        occurred_on,recognition_on,currency,origin,net_amount,tax_amount,gross_amount,status,idempotency_key,payload_hash)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id
    `, [row.id,row.companyId,row.periodId,row.sourceDocumentId,row.externalRef,row.kind,row.occurredOn,row.recognitionOn,
      row.currency,row.origin,row.net,row.tax,row.gross,row.status,row.idempotencyKey,'a'.repeat(64)]);
  }
  it('runs on a native PostgreSQL 17 server and applies the migration', async () => {
    const result = await db.pool.query<{ version: string; rls: boolean }>(`
      SELECT version(), relrowsecurity AS rls FROM pg_class WHERE oid='public.business_transactions'::regclass
    `);
    expect(result.rows[0]?.version).toContain('PostgreSQL 17.');
    expect(result.rows[0]?.rls).toBe(true);
  });
  it('queries only the current company through the shared service', async () => {
    const pageA = await serviceA.getTransactions(queryA);
    const pageB = await serviceB.getTransactions({ ...queryA, companyId: FIXTURE_IDS.companyB });
    expect(pageA.items).toHaveLength(10);
    expect(pageA.items.every((row) => row.companyId === FIXTURE_IDS.companyA)).toBe(true);
    expect(pageB.items).toHaveLength(1);
    await expect(serviceA.getTransactions({ ...queryA, companyId: FIXTURE_IDS.companyB })).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
  it('enforces RLS even without a company WHERE clause', async () => {
    const rows = await actor(FIXTURE_IDS.userA, (client) => client.query('SELECT company_id FROM public.business_transactions'));
    expect(rows.rows).toHaveLength(10);
    expect(rows.rows.every((row) => row.company_id === FIXTURE_IDS.companyA)).toBe(true);
    const hidden = await actor(FIXTURE_IDS.userA, (client) => client.query(
      'SELECT id FROM public.business_transactions WHERE company_id=$1', [FIXTURE_IDS.companyB],
    ));
    expect(hidden.rows).toHaveLength(0);
  });
  it('exposes only the caller membership, principal and scopes', async () => {
    const rows = await actor(FIXTURE_IDS.userA, (client) => client.query('SELECT company_id FROM public.principal_scopes'));
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows.every((row) => row.company_id === FIXTURE_IDS.companyA)).toBe(true);
  });
  it('denies anonymous read and insert', async () => {
    await expect(actor(null, (client) => client.query('SELECT * FROM public.business_transactions'))).rejects.toMatchObject({ code: '42501' });
    await expect(actor(null, (client) => insert(client))).rejects.toMatchObject({ code: '42501' });
  });
  it('allows a preparer own-company insert and does not persist the test write', async () => {
    const result = await actor(FIXTURE_IDS.userA, (client) => insert(client));
    expect(result.rows).toHaveLength(1);
    expect((await serviceA.getTransactions(queryA)).items).toHaveLength(10);
  });
  it('rejects cross-company INSERT through WITH CHECK', async () => {
    const other = seed.transactions.find((row) => row.companyId === FIXTURE_IDS.companyB)!;
    await expect(actor(FIXTURE_IDS.userA, (client) => insert(client, {
      companyId: other.companyId, periodId: other.periodId, sourceDocumentId: other.sourceDocumentId,
    }))).rejects.toMatchObject({ code: '42501' });
  });
  it('denies viewer write and membership/scope self-escalation', async () => {
    await expect(actor(FIXTURE_IDS.viewerA, (client) => insert(client))).rejects.toMatchObject({ code: '42501' });
    await expect(actor(FIXTURE_IDS.userA, (client) => client.query(
      "UPDATE public.company_memberships SET role='admin' WHERE user_id=$1", [FIXTURE_IDS.userA],
    ))).rejects.toMatchObject({ code: '42501' });
    await expect(actor(FIXTURE_IDS.userA, (client) => client.query(
      "INSERT INTO public.principal_scopes SELECT company_id,id,'erp:write' FROM public.principals",
    ))).rejects.toMatchObject({ code: '42501' });
  });
  it('cannot update/delete transactions or inject a processed state', async () => {
    await expect(actor(FIXTURE_IDS.userA, (client) => client.query(
      "UPDATE public.business_transactions SET status='processed'",
    ))).rejects.toMatchObject({ code: '42501' });
    await expect(actor(FIXTURE_IDS.userA, (client) => client.query(
      'DELETE FROM public.business_transactions',
    ))).rejects.toMatchObject({ code: '42501' });
    await expect(actor(FIXTURE_IDS.userA, (client) => insert(client, { status: 'processed' }))).rejects.toMatchObject({ code: '42501' });
  });
  it('blocks another-company or missing evidence with composite FK', async () => {
    const foreign = seed.documents.find((row) => row.companyId === FIXTURE_IDS.companyB)!;
    await expect(actor(FIXTURE_IDS.userA, (client) => insert(client, { sourceDocumentId: foreign.id }))).rejects.toMatchObject({ code: '23503' });
    await expect(actor(FIXTURE_IDS.userA, (client) => insert(client, { sourceDocumentId: randomUUID() }))).rejects.toMatchObject({ code: '23503' });
  });
  it('blocks another-company period reference', async () => {
    const foreign = seed.periods.find((row) => row.companyId === FIXTURE_IDS.companyB)!;
    await expect(actor(FIXTURE_IDS.userA, (client) => insert(client, { periodId: foreign.id }))).rejects.toMatchObject({ code: '23503' });
  });
  it('blocks wrong totals, negative amounts and even tiny sub-won amounts in SQL', async () => {
    await expect(actor(FIXTURE_IDS.userA, (client) => insert(client, { gross: '50000001' }))).rejects.toMatchObject({ code: '23514' });
    await expect(actor(FIXTURE_IDS.userA, (client) => insert(client, { net: '-1', tax: '0', gross: '-1' }))).rejects.toMatchObject({ code: '23514' });
    await expect(actor(FIXTURE_IDS.userA, (client) => insert(client, { net: '0.0000001', tax: '0', gross: '0.0000001' }))).rejects.toMatchObject({ code: '23514' });
  });
  it('keeps large whole-won amounts exact in SQL', async () => {
    const result = await actor(FIXTURE_IDS.userA, async (client) => {
      const inserted = await insert(client, { net: '999999999999999999', tax: '0', gross: '999999999999999999' });
      return client.query<{ value: string }>('SELECT gross_amount::text AS value FROM public.business_transactions WHERE id=$1', [inserted.rows[0].id]);
    });
    expect(result.rows[0]?.value).toBe('999999999999999999');
  });
  it('rejects external-data origin and a date outside the fiscal period', async () => {
    await expect(actor(FIXTURE_IDS.userA, (client) => insert(client, { origin: 'public_api_live' }))).rejects.toMatchObject({ code: '23514' });
    await expect(actor(FIXTURE_IDS.userA, (client) => insert(client, { recognitionOn: '2026-02-01' }))).rejects.toMatchObject({ code: '23514' });
  });
  it('prevents duplicate idempotency keys', async () => {
    await expect(actor(FIXTURE_IDS.userA, (client) => insert(client, {
      idempotencyKey: seed.transactions[0]!.idempotencyKey,
    }))).rejects.toMatchObject({ code: '23505' });
  });
  it('prevents overlapping periods', async () => {
    await expect(db.pool.query(`
      INSERT INTO public.fiscal_periods(id,company_id,fiscal_year,start_date,end_date)
      VALUES($1,$2,2026,'2026-01-15','2026-02-15')
    `, [randomUUID(), FIXTURE_IDS.companyA])).rejects.toMatchObject({ code: '23P01' });
  });
  it('rejects new transactions after closing a period', async () => {
    const periodId = seed.periods[0]!.id;
    await db.pool.query("UPDATE public.fiscal_periods SET status='closed' WHERE id=$1", [periodId]);
    try {
      await expect(actor(FIXTURE_IDS.userA, (client) => insert(client))).rejects.toMatchObject({ code: '23514' });
    } finally { await db.pool.query("UPDATE public.fiscal_periods SET status='open' WHERE id=$1", [periodId]); }
  });
  it('honors membership expiry and principal revocation on the next call', async () => {
    await db.pool.query("UPDATE public.company_memberships SET expires_at='2020-01-01' WHERE user_id=$1", [FIXTURE_IDS.userA]);
    try {
      await expect(serviceA.getTransactions(queryA)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    } finally { await db.pool.query('UPDATE public.company_memberships SET expires_at=NULL WHERE user_id=$1', [FIXTURE_IDS.userA]); }
    await db.pool.query('UPDATE public.principals SET active=false WHERE user_id=$1', [FIXTURE_IDS.userA]);
    try {
      await expect(serviceA.getTransactions(queryA)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    } finally { await db.pool.query('UPDATE public.principals SET active=true WHERE user_id=$1', [FIXTURE_IDS.userA]); }
  });
  it('paginates every transaction once, including same-date rows', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await serviceA.getTransactions({ ...queryA, limit: 3, ...(cursor ? { cursor } : {}) });
      seen.push(...page.items.map((row) => row.id));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(10);
    expect(new Set(seen).size).toBe(10);
  });
  it('rejects malformed cursors and cursors reused for a different company/filter', async () => {
    await expect(serviceA.getTransactions({ ...queryA, cursor: 'not-json' })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    const page = await serviceA.getTransactions({ ...queryA, limit: 3 });
    await expect(serviceB.getTransactions({
      ...queryA, companyId: FIXTURE_IDS.companyB, cursor: page.nextCursor!,
    })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    await expect(serviceA.getTransactions({
      ...queryA, status: 'processed', cursor: page.nextCursor!,
    })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
  });
  it('does not leak identity through connection-pool reuse', async () => {
    await serviceA.getTransactions(queryA);
    await serviceB.getTransactions({ ...queryA, companyId: FIXTURE_IDS.companyB });
    const result = await db.pool.query<{ role: string; uid: string | null }>(
      "SELECT current_user AS role, nullif(current_setting('request.jwt.claim.sub', true), '') AS uid",
    );
    expect(result.rows[0]).toEqual({ role: 'postgres', uid: null });
  });
  it('re-seeds idempotently and rolls back conflicting or damaged seeds', async () => {
    const result = await seedMiniDatabase(db.pool, seed);
    expect(result.reused).toBe(true);
    expect((await db.pool.query('SELECT id FROM public.business_transactions')).rows).toHaveLength(11);
    const damaged = structuredClone(seed);
    damaged.documents[0]!.content['tampered'] = true;
    await expect(seedMiniDatabase(db.pool, damaged)).rejects.toThrow('SEED_INTEGRITY');
    const conflict = generateMiniSeed(20261015);
    conflict.documents[0]!.content['newMarker'] = true;
    conflict.documents[0]!.sha256 = sha256(conflict.documents[0]!.content);
    const { manifest: _, ...payload } = conflict;
    conflict.manifest.sha256 = sha256(payload);
    await expect(seedMiniDatabase(db.pool, conflict)).rejects.toThrow('SEED_CONFLICT');
    expect((await db.pool.query('SELECT id FROM public.business_transactions')).rows).toHaveLength(11);
    expect((await db.pool.query('SELECT * FROM private.seed_manifests')).rows).toHaveLength(1);
  });
});
