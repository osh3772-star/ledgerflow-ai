import { createHash } from 'node:crypto';
import { transactionSchema, ExactDecimal, type BusinessTransaction } from '@ledgerflow/contracts';

export const GENERATOR_VERSION = 'lf-mini-v1';
export const DEFAULT_SEED = 20261014;
const FIXTURE_TIME = '2026-01-01T00:00:00.000Z';
// RFC 4122 v5 UUIDs use a fixed project namespace and UTF-8 names.
const NAMESPACE = Buffer.from('e920e79c29c24aa8b9862f089454fdc1', 'hex');

export function stableId(name: string): string {
  const bytes = createHash('sha1').update(NAMESPACE).update(name, 'utf8').digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join('-');
}

export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const record = value as Record<string, unknown>;
  return '{' + Object.keys(record).sort().map((key) =>
    JSON.stringify(key) + ':' + canonicalJson(record[key])).join(',') + '}';
}
export const sha256 = (value: unknown): string => createHash('sha256').update(canonicalJson(value)).digest('hex');

export function integerRandom(seed: number): (min: number, max: number) => number {
  let state = seed >>> 0;
  return (min, max) => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), state | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    const unsigned = (t ^ (t >>> 14)) >>> 0;
    return min + unsigned % (max - min + 1);
  };
}

export * from './full-erp.js';

export interface CompanyFixture {
  id: string; name: string; origin: 'synthetic_erp'; policyVersion: string;
}
export interface IdentityFixture {
  companyId: string; userId: string; principalId: string;
  role: 'preparer' | 'viewer'; scopes: string[];
}
export interface PeriodFixture {
  id: string; companyId: string; start: string; end: string;
}
export interface DocumentFixture {
  id: string; companyId: string; issueDate: string; kind: string;
  storagePath: null; content: Record<string, unknown>; sha256: string;
}
export interface MiniSeed {
  generatorVersion: string; seed: number; createdAt: string;
  companies: CompanyFixture[]; identities: IdentityFixture[];
  periods: PeriodFixture[];
  accounts: { id: string; companyId: string; code: string; name: string; kind: string; normalSide: string }[];
  documents: DocumentFixture[]; transactions: BusinessTransaction[];
  manifest: { sha256: string; demoTransactions: number; isolationTransactions: number; totalTransactions: number };
}

export const FIXTURE_IDS = {
  companyA: stableId('company-a'), companyB: stableId('company-b'),
  userA: stableId('user-a'), userB: stableId('user-b'), viewerA: stableId('viewer-a'),
};

export function generateMiniSeed(seed: number = DEFAULT_SEED): MiniSeed {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('seed must be a uint32.');
  const randomInt = integerRandom(seed);
  const companies: CompanyFixture[] = [
    { id: FIXTURE_IDS.companyA, name: 'LedgerFlow Trading Co., Ltd.', origin: 'synthetic_erp', policyVersion: 'demo-2026-v1' },
    { id: FIXTURE_IDS.companyB, name: 'LedgerFlow Isolation Test Co. (가상)', origin: 'synthetic_erp', policyVersion: 'demo-2026-v1' },
  ];
  const identities: IdentityFixture[] = [
    { companyId: FIXTURE_IDS.companyA, userId: FIXTURE_IDS.userA, principalId: stableId('principal-a'), role: 'preparer', scopes: ['erp:read', 'erp:write'] },
    { companyId: FIXTURE_IDS.companyB, userId: FIXTURE_IDS.userB, principalId: stableId('principal-b'), role: 'preparer', scopes: ['erp:read', 'erp:write'] },
    { companyId: FIXTURE_IDS.companyA, userId: FIXTURE_IDS.viewerA, principalId: stableId('principal-viewer'), role: 'viewer', scopes: ['erp:read'] },
  ];
  const periods = companies.map((company) => ({
    id: stableId(company.id + '/2026-01'), companyId: company.id, start: '2026-01-01', end: '2026-01-31',
  }));
  const accountDefinitions = [
    ['1010', '보통예금', 'asset', 'debit'],
    ['1100', '매출채권', 'asset', 'debit'],
    ['1200', '상품', 'asset', 'debit'],
    ['1300', '부가세대급금', 'asset', 'debit'],
    ['2010', '매입채무', 'liability', 'credit'],
    ['2100', '부가세예수금', 'liability', 'credit'],
    ['3010', '자본금', 'equity', 'credit'],
    ['4010', '상품매출', 'revenue', 'credit'],
    ['5010', '매출원가', 'expense', 'debit'],
  ] as const;
  const accounts = companies.flatMap((company) => accountDefinitions.map(([code, name, kind, normalSide]) =>
    ({ id: stableId(company.id + '/account/' + code), companyId: company.id, code, name, kind, normalSide })));
  const amount = randomInt(2000, 4000) * 100; // Whole KRW, independent of host locale/time.
  const scenarios = [
    ['opening_capital', '2026-01-02', '50000000', '0'],
    ['purchase', '2026-01-05', String(amount), new ExactDecimal(amount).mul('0.1').toFixed()],
    ['sale', '2026-01-10', '100000', '10000'],
    ['receipt', '2026-01-15', '110000', '0'],
    ['payment', '2026-01-16', new ExactDecimal(amount).mul('1.1').toFixed(), '0'],
    ['asset_acquisition', '2026-01-18', '600000', '60000'],
    ['prepayment', '2026-01-20', '120000', '0'],
    ['payroll', '2026-01-25', '2000000', '0'],
    ['accrual', '2026-01-31', '150000', '0'],
    ['adjustment', '2026-01-31', '10000', '0'],
  ] as const;
  const documents: DocumentFixture[] = [];
  const transactions: BusinessTransaction[] = [];
  for (const [companyIndex, company] of companies.entries()) {
    const period = periods[companyIndex]!;
    const subset = companyIndex === 0 ? scenarios : scenarios.slice(0, 1);
    for (const [ordinal, scenario] of subset.entries()) {
      const [kind, date, net, tax] = scenario;
      const externalRef = 'LF-' + (companyIndex === 0 ? 'A' : 'B') + '-' + String(ordinal + 1).padStart(3, '0');
      const transactionId = stableId(company.id + '/transaction/' + externalRef);
      const documentId = stableId(company.id + '/document/' + externalRef);
      const content = {
        origin: 'synthetic_erp', externalRef, kind, issuedOn: date, net, tax,
        transactionRef: transactionId,
        ...(kind === 'sale' ? { deliveryConfirmedOn: date, singlePerformanceObligation: true, sku: 'DEMO-GOODS-001', quantity: '2' } : {}),
        ...(kind === 'receipt' ? { settlesExternalRef: 'LF-A-003' } : {}),
        ...(kind === 'payment' ? { settlesExternalRef: 'LF-A-002' } : {}),
        ...(kind === 'asset_acquisition' ? { availableOn: date, usefulLifeMonths: 60, residualValue: '0' } : {}),
      };
      documents.push({ id: documentId, companyId: company.id, issueDate: date, kind, storagePath: null, content, sha256: sha256(content) });
      transactions.push(transactionSchema.parse({
        id: transactionId, companyId: company.id, periodId: period.id, sourceDocumentId: documentId,
        externalRef, kind, occurredOn: date, recognitionOn: date, currency: 'KRW', origin: 'synthetic_erp',
        net, tax, gross: new ExactDecimal(net).plus(tax).toFixed(), status: 'unprocessed',
        idempotencyKey: GENERATOR_VERSION + '/' + company.id + '/' + externalRef,
      }));
    }
  }
  const data = { generatorVersion: GENERATOR_VERSION, seed, createdAt: FIXTURE_TIME, companies, identities, periods, accounts, documents, transactions };
  return { ...data, manifest: { sha256: sha256(data), demoTransactions: 10, isolationTransactions: 1, totalTransactions: transactions.length } };
}
