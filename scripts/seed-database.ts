import type { Pool, PoolClient } from 'pg';
import { sha256, type MiniSeed } from '@ledgerflow/test-data';
import { transactionSchema } from '@ledgerflow/contracts';

export async function seedMiniDatabase(pool: Pool, data: MiniSeed) {
  const { manifest, ...payload } = data;
  if (sha256(payload) !== manifest.sha256 ||
      data.documents.some((doc) => sha256(doc.content) !== doc.sha256)) {
    throw new Error('SEED_INTEGRITY: seed manifest or evidence content does not match.');
  }
  for (const transaction of data.transactions) transactionSchema.parse(transaction);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const marker = await client.query<{ marker: string | null }>(
      "SELECT to_regclass('private.native_test_bootstrap')::text AS marker",
    );
    if (!marker.rows[0]?.marker) throw new Error('LOCAL_DEMO_ONLY: Supabase Auth users must be created through a separate provisioning workflow.');
    await client.query('SELECT pg_advisory_xact_lock(20261014)');
    const previous = await client.query<{ manifest_hash: string }>(
      'SELECT manifest_hash FROM private.seed_manifests WHERE generator_version=$1 AND seed=$2',
      [data.generatorVersion, data.seed],
    );
    if (previous.rows[0] && previous.rows[0].manifest_hash !== manifest.sha256) throw new Error('SEED_CONFLICT: bump generatorVersion when the same seed changes.');
    await insertSeedFoundation(client, data);
    await client.query(`
      INSERT INTO private.seed_manifests(generator_version,seed,manifest_hash) VALUES($1,$2,$3) ON CONFLICT DO NOTHING
    `, [data.generatorVersion, data.seed, manifest.sha256]);
    await client.query('COMMIT');
    return { reused: Boolean(previous.rows.length), ...manifest };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

// Internal local seed helper: caller owns BEGIN/COMMIT and the bootstrap guard.
// This is not a production Auth provisioning API or a tool exposed to agents.
export async function insertSeedFoundation(client: PoolClient, data: MiniSeed) {
    for (const company of data.companies) await client.query(`
      INSERT INTO public.companies(id,name,data_origin,policy_version,created_at)
      VALUES ($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING
    `, [company.id, company.name, company.origin, company.policyVersion, data.createdAt]);
    for (const identity of data.identities) {
      await client.query('INSERT INTO auth.users(id) VALUES ($1) ON CONFLICT(id) DO NOTHING', [identity.userId]);
      await client.query(`
        INSERT INTO public.company_memberships(company_id,user_id,role,created_at) VALUES ($1,$2,$3,$4)
        ON CONFLICT(company_id,user_id) DO NOTHING
      `, [identity.companyId, identity.userId, identity.role, data.createdAt]);
      await client.query(`
        INSERT INTO public.principals(id,company_id,kind,user_id,created_at) VALUES ($1,$2,'human',$3,$4)
        ON CONFLICT(id) DO NOTHING
      `, [identity.principalId, identity.companyId, identity.userId, data.createdAt]);
      for (const scope of identity.scopes) await client.query(`
        INSERT INTO public.principal_scopes(company_id,principal_id,scope) VALUES ($1,$2,$3)
        ON CONFLICT DO NOTHING
      `, [identity.companyId, identity.principalId, scope]);
    }
    for (const period of data.periods) await client.query(`
      INSERT INTO public.fiscal_periods(id,company_id,fiscal_year,start_date,end_date,created_at)
      VALUES($1,$2,2026,$3,$4,$5) ON CONFLICT(id) DO NOTHING
    `, [period.id, period.companyId, period.start, period.end, data.createdAt]);
    for (const account of data.accounts) await client.query(`
      INSERT INTO public.accounts(id,company_id,code,name,kind,normal_side,created_at)
      VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING
    `, [account.id, account.companyId, account.code, account.name, account.kind, account.normalSide, data.createdAt]);
    for (const document of data.documents) {
      await client.query(`
        INSERT INTO public.source_documents(id,company_id,document_type,issue_date,origin,content,sha256,storage_path,created_at)
        VALUES($1,$2,$3,$4,'synthetic_erp',$5,$6,NULL,$7) ON CONFLICT(id) DO NOTHING
      `, [document.id, document.companyId, document.kind, document.issueDate, document.content, document.sha256, data.createdAt]);
      await assertStoredHash(client, 'source_documents', document.id, document.sha256);
    }
    for (const transaction of data.transactions) {
      const hash = sha256(transaction);
      await client.query(`
        INSERT INTO public.business_transactions(id,company_id,period_id,source_document_id,external_ref,
          kind,occurred_on,recognition_on,currency,origin,net_amount,tax_amount,gross_amount,status,
          idempotency_key,payload_hash,created_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        ON CONFLICT(id) DO NOTHING
      `, [transaction.id, transaction.companyId, transaction.periodId, transaction.sourceDocumentId, transaction.externalRef,
        transaction.kind, transaction.occurredOn, transaction.recognitionOn, transaction.currency, transaction.origin,
        transaction.net, transaction.tax, transaction.gross, transaction.status, transaction.idempotencyKey, hash, data.createdAt]);
      await assertStoredHash(client, 'business_transactions', transaction.id, hash);
    }
}
async function assertStoredHash(
  client: PoolClient, table: 'source_documents' | 'business_transactions', id: string, expected: string,
) {
  const sql = table === 'source_documents'
    ? 'SELECT sha256 AS hash FROM public.source_documents WHERE id=$1'
    : 'SELECT payload_hash AS hash FROM public.business_transactions WHERE id=$1';
  const existing = await client.query<{ hash: string }>(sql, [id]);
  if (existing.rows[0]?.hash !== expected) throw new Error('SEED_CONFLICT: existing ' + table + ' differs.');
}
