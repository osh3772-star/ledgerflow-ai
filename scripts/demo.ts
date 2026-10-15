import { ErpService } from '@ledgerflow/application-services';
import { PostgresTransactionRepository } from '@ledgerflow/data-access';
import { FIXTURE_IDS, generateMiniSeed } from '@ledgerflow/test-data';
import { startLocalPostgres } from './local-postgres.js';
import { seedMiniDatabase } from './seed-database.js';

const db = await startLocalPostgres();
try {
  const data = generateMiniSeed();
  await seedMiniDatabase(db.pool, data);
  const repeated = await seedMiniDatabase(db.pool, data);
  const serviceA = new ErpService(new PostgresTransactionRepository(db.pool, FIXTURE_IDS.userA));
  const serviceB = new ErpService(new PostgresTransactionRepository(db.pool, FIXTURE_IDS.userB));
  const query = { companyId: FIXTURE_IDS.companyA, from: '2026-01-01', to: '2026-01-31' };
  const result = await serviceA.getTransactions(query);
  const isolation = await serviceB.getTransactions({ ...query, companyId: FIXTURE_IDS.companyB });
  let isolationDenied = false;
  try { await serviceA.getTransactions({ ...query, companyId: FIXTURE_IDS.companyB }); }
  catch (error) { isolationDenied = error instanceof Error && 'code' in error && error.code === 'FORBIDDEN'; }
  const version = await db.pool.query<{ version: string }>('SELECT version() AS version');
  console.log(JSON.stringify({
    phase: 'P2-A', database: version.rows[0]?.version.split(',')[0],
    databaseType: 'native_local_postgresql', supabaseStackVerified: false,
    origin: 'synthetic_erp', apiCalls: 0, aiCalls: 0,
    manifest: data.manifest, repeatedSeedReused: repeated.reused,
    demoCompanyVisible: result.items.length, isolationCompanyVisible: isolation.items.length,
    crossCompanyDenied: isolationDenied,
    transactions: result.items.map(({ externalRef, kind, net, tax, gross }) => ({ externalRef, kind, net, tax, gross })),
  }, null, 2));
} finally { await db.stop(); }
