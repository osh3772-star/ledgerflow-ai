import { generateFullErpSeed } from '@ledgerflow/test-data';
import { ErpService } from '@ledgerflow/application-services';
import { PostgresTransactionRepository } from '@ledgerflow/data-access';
import { startLocalPostgres } from './local-postgres.js';
import { FULL_SEED_TABLES, seedFullDatabase } from './seed-full-database.js';

const db = await startLocalPostgres();
try {
  const fixture = generateFullErpSeed();
  const first = await seedFullDatabase(db.pool, fixture);
  const repeated = await seedFullDatabase(db.pool, fixture);
  const primary = fixture.companies[0]!.id;
  const identity = fixture.identities.find((row) => row.companyId === primary && row.role === 'preparer')!;
  const service = new ErpService(new PostgresTransactionRepository(db.pool, identity.userId));
  let cursor: string | undefined;
  let visible = 0;
  do {
    const page = await service.getTransactions({ companyId: primary, from: '2026-01-01', to: '2026-12-31', limit: 100, ...(cursor ? { cursor } : {}) });
    visible += page.items.length;
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  const counts: Record<string, number> = {};
  for (const { table } of FULL_SEED_TABLES) {
    const result = await db.pool.query<{ count: number }>('SELECT count(*)::int AS count FROM public.' + table);
    counts[table] = result.rows[0]!.count;
  }
  const audit = await db.pool.query<{ count: number }>('SELECT count(*)::int AS count FROM public.audit_logs');
  const version = await db.pool.query<{ version: string }>('SELECT version() AS version');
  console.log(JSON.stringify({ phase: 'P2-B2', database: version.rows[0]!.version.split(',')[0], supabaseStackVerified: false,
    origin: 'synthetic_erp', apiCalls: 0, aiCalls: 0, visiblePrimaryTransactions: visible,
    firstImport: first, repeatedImport: repeated, counts, auditRows: audit.rows[0]!.count }, null, 2));
} finally { await db.stop(); }
