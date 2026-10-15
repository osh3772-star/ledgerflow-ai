import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { sha256, type FullErpSeed } from '@ledgerflow/test-data';
import { transactionSchema } from '@ledgerflow/contracts';
import { insertSeedFoundation } from './seed-database.js';

type Column = { name: string; property: string; type: string };
type TableConfig = { table: string; key: keyof FullErpSeed; columns: Column[] };
const specifications: [string, keyof FullErpSeed, string[]][] = [
  [
    "counterparties",
    "counterparties",
    [
      "name:text",
      "role:text",
      "registration_number:registrationNumber:text"
    ]
  ],
  [
    "products",
    "products",
    [
      "sku:text",
      "unit_cost:unitCost:private.erp_won",
      "unit_price:unitPrice:private.erp_won"
    ]
  ],
  [
    "bank_accounts",
    "bankAccounts",
    [
      "label:text",
      "account_number:accountNumber:text"
    ]
  ],
  [
    "sales_contracts",
    "contracts",
    [
      "transaction_id:transactionId:uuid",
      "counterparty_id:counterpartyId:uuid",
      "delivered_on:deliveredOn:date",
      "performance_obligations:performanceObligations:integer"
    ]
  ],
  [
    "invoices",
    "invoices",
    [
      "number:text",
      "transaction_id:transactionId:uuid",
      "source_document_id:sourceDocumentId:uuid",
      "counterparty_id:counterpartyId:uuid",
      "direction:text",
      "issue_date:issueDate:date",
      "net_amount:net:private.erp_won",
      "tax_amount:tax:private.erp_won",
      "gross_amount:gross:private.erp_won",
      "government_issued:governmentIssued:boolean"
    ]
  ],
  [
    "invoice_lines",
    "invoiceLines",
    [
      "invoice_id:invoiceId:uuid",
      "product_id:productId:uuid",
      "description:text",
      "quantity:private.erp_quantity",
      "unit_price:unitPrice:private.erp_won",
      "net_amount:net:private.erp_won"
    ]
  ],
  [
    "inventory_movements",
    "inventoryMovements",
    [
      "transaction_id:transactionId:uuid",
      "product_id:productId:uuid",
      "occurred_on:date:date",
      "direction:text",
      "quantity:private.erp_quantity",
      "unit_cost:unitCost:private.erp_won"
    ]
  ],
  [
    "fixed_assets",
    "fixedAssets",
    [
      "transaction_id:transactionId:uuid",
      "acquired_on:acquiredOn:date",
      "available_on:availableOn:date",
      "cost:private.erp_won",
      "residual:private.erp_won",
      "useful_life_months:usefulLifeMonths:integer",
      "monthly_depreciation:monthlyDepreciation:private.erp_won"
    ]
  ],
  [
    "prepayments",
    "prepayments",
    [
      "transaction_id:transactionId:uuid",
      "coverage_start:coverageStart:date",
      "coverage_end:coverageEnd:date",
      "cost:private.erp_won",
      "monthly_expense:monthlyExpense:private.erp_won"
    ]
  ],
  [
    "payrolls",
    "payrolls",
    [
      "transaction_id:transactionId:uuid",
      "employee_ref:employeeRef:text",
      "gross:private.erp_won",
      "withholding:private.erp_won",
      "net_pay:netPay:private.erp_won",
      "statutory_calculation:statutoryCalculation:boolean"
    ]
  ],
  [
    "accruals",
    "accruals",
    [
      "transaction_id:transactionId:uuid",
      "service_start:serviceStart:date",
      "service_end:serviceEnd:date",
      "amount:private.erp_won",
      "reversal_on:reversalOn:date"
    ]
  ],
  [
    "bank_transactions",
    "bankTransactions",
    [
      "bank_account_id:bankAccountId:uuid",
      "transaction_id:transactionId:uuid",
      "booked_on:date:date",
      "direction:text",
      "amount:private.erp_won"
    ]
  ],
  [
    "settlement_allocations",
    "settlements",
    [
      "bank_transaction_id:bankTransactionId:uuid",
      "invoice_id:invoiceId:uuid",
      "transaction_id:transactionId:uuid",
      "amount:private.erp_won"
    ]
  ],
  [
    "adjustment_proposals",
    "adjustments",
    [
      "transaction_id:transactionId:uuid",
      "type:text",
      "asset_id:assetId:uuid",
      "prepayment_id:prepaymentId:uuid",
      "effective_on:$transactionDate:date",
      "amount:private.erp_won",
      "posting_state:postingState:text"
    ]
  ]
];

export const FULL_SEED_TABLES: TableConfig[] = specifications.map(([table, key, fields]) => ({
  table, key, columns: ['id:uuid', 'company_id:companyId:uuid', 'origin:text', ...fields].map((field) => {
    const parts = field.split(':');
    return { name: parts[0]!, property: parts.length === 2 ? parts[0]! : parts[1]!, type: parts.at(-1)! };
  }),
}));

function rowsFor(config: TableConfig, data: FullErpSeed): Record<string, unknown>[] {
  const dates = new Map(data.transactions.map((row) => [row.id, row.recognitionOn]));
  const rows = data[config.key] as unknown as Record<string, unknown>[];
  return rows.map((row) => Object.fromEntries(config.columns.map((column) => [
    column.name, column.property === '$transactionDate' ? dates.get(String(row.transactionId)) : row[column.property],
  ])));
}
const quote = (identifier: string) => '"' + identifier + '"';

// SQL identifiers and record types come exclusively from the static allowlist above.
// No generic SQL interface is available to clients or agents.
async function insertAndCompare(client: PoolClient, config: TableConfig, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const names = config.columns.map((column) => quote(column.name)).join(',');
  const types = config.columns.map((column) => quote(column.name) + ' ' + column.type).join(',');
  const table = 'public.' + quote(config.table);
  // Filter existing IDs before BEFORE INSERT triggers. ON CONFLICT alone would
  // incorrectly re-run allocation guards against already-imported settlements.
  await client.query(`
    INSERT INTO ${table}(${names})
    SELECT ${config.columns.map((column) => 'incoming.' + quote(column.name)).join(',')}
    FROM jsonb_to_recordset($1::jsonb) AS incoming(${types})
    WHERE NOT EXISTS(SELECT 1 FROM ${table} existing WHERE existing.id=incoming.id)
  `, [JSON.stringify(rows)]);
  const projection = config.columns.flatMap((column) => [
    "'" + column.name + "'",
    quote(column.name) + (['integer', 'boolean'].includes(column.type) ? '' : '::text'),
  ]).join(',');
  const stored = await client.query<{ payload: Record<string, unknown> }>(`
    SELECT jsonb_build_object(${projection}) AS payload FROM ${table}
    WHERE id=ANY($1::uuid[]) ORDER BY id
  `, [rows.map((row) => row.id)]);
  const expected = new Map(rows.map((row) => [row.id, sha256(row)]));
  if (expected.size !== rows.length || stored.rows.length !== rows.length ||
    stored.rows.some((row) => expected.get(row.payload.id) !== sha256(row.payload))) {
    throw new Error('SEED_CONFLICT: persisted ' + config.table + ' differs from fixture.');
  }
}

async function compareFoundation(client: PoolClient, data: FullErpSeed) {
  const companyIds = data.companies.map((row) => row.id);
  const documents = await client.query<{ payload: FullErpSeed['documents'][number] }>(`
    SELECT jsonb_build_object('id',id,'companyId',company_id,'issueDate',issue_date::text,
      'kind',document_type,'storagePath',storage_path,'content',content,'sha256',sha256) AS payload
    FROM public.source_documents WHERE company_id=ANY($1::uuid[])
  `, [companyIds],
  );
  const expectedDocuments = new Map(data.documents.map((row) => [row.id, row]));
  if (documents.rows.length !== data.documents.length || documents.rows.some(({ payload: row }) =>
    !expectedDocuments.has(row.id) || sha256(row) !== sha256(expectedDocuments.get(row.id)) || row.sha256 !== sha256(row.content))) {
    throw new Error('SEED_CONFLICT: persisted evidence differs.');
  }
  const expectedTransactions = new Map(data.transactions.map((row) => [row.id, sha256(row)]));
  const transactions = await client.query<{ payload: unknown; payload_hash: string }>(`
    SELECT jsonb_build_object('id',id,'companyId',company_id,'periodId',period_id,
      'sourceDocumentId',source_document_id,'externalRef',external_ref,'kind',kind,
      'occurredOn',occurred_on::text,'recognitionOn',recognition_on::text,'currency',currency,
      'origin',origin,'net',net_amount::text,'tax',tax_amount::text,'gross',gross_amount::text,
      'status',status,'idempotencyKey',idempotency_key) AS payload,payload_hash
    FROM public.business_transactions WHERE company_id=ANY($1::uuid[])
  `, [companyIds]);
  if (transactions.rows.length !== data.transactions.length || transactions.rows.some((row) => {
    const parsed = transactionSchema.parse(row.payload);
    const actual = sha256(parsed);
    return expectedTransactions.get(parsed.id) !== actual || row.payload_hash !== actual;
  })) throw new Error('SEED_CONFLICT: persisted transaction differs.');
}

export async function seedFullDatabase(pool: Pool, data: FullErpSeed) {
  const startedAt = performance.now();
  const { manifest, ...payload } = data;
  if (sha256(payload) !== manifest.sha256 || data.documents.some((row) => sha256(row.content) !== row.sha256))
    throw new Error('SEED_INTEGRITY: manifest or evidence hash differs.');
  const primaryCount = data.transactions.filter((row) => row.companyId === data.companies[0]?.id).length;
  const isolationCount = data.transactions.filter((row) => row.companyId === data.companies[1]?.id).length;
  if (data.companies.length !== 2 || primaryCount !== 1000 || isolationCount !== 1 ||
    manifest.demoTransactions !== primaryCount || manifest.isolationTransactions !== isolationCount ||
    manifest.totalTransactions !== data.transactions.length || data.transactions.some((row) => row.status !== 'unprocessed'))
    throw new Error('SEED_INTEGRITY: fixture counts or initial transaction states differ.');
  for (const transaction of data.transactions) transactionSchema.parse(transaction);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const marker = await client.query<{ marker: string | null }>("SELECT to_regclass('private.native_test_bootstrap')::text AS marker");
    if (!marker.rows[0]?.marker) throw new Error('LOCAL_DEMO_ONLY: production Auth provisioning is a separate workflow.');
    await client.query('SELECT pg_advisory_xact_lock(20261014)');
    await client.query("SELECT set_config('ledgerflow.trace_id',$1,true)", [randomUUID()]);
    const previous = await client.query<{ manifest_hash: string }>(
      'SELECT manifest_hash FROM private.seed_manifests WHERE generator_version=$1 AND seed=$2',
      [data.generatorVersion, data.seed],
    );
    if (previous.rows[0] && previous.rows[0].manifest_hash !== manifest.sha256)
      throw new Error('SEED_CONFLICT: same generatorVersion/seed has a different manifest.');
    await insertSeedFoundation(client, data);
    await compareFoundation(client, data);
    for (const config of FULL_SEED_TABLES) await insertAndCompare(client, config, rowsFor(config, data));
    // Fail inside this transaction before acknowledging the import or recording its receipt.
    await client.query('SET CONSTRAINTS ALL IMMEDIATE');
    await client.query(`
      INSERT INTO private.seed_manifests(generator_version,seed,manifest_hash)
      VALUES($1,$2,$3) ON CONFLICT DO NOTHING
    `, [data.generatorVersion, data.seed, manifest.sha256]);
    await client.query('COMMIT');
    return { reused: Boolean(previous.rows.length), durationMs: Math.round(performance.now() - startedAt), ...manifest };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

