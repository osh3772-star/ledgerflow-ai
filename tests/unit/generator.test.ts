import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateMiniSeed, sha256, canonicalJson } from '@ledgerflow/test-data';
import { ExactDecimal } from '@ledgerflow/contracts';

describe('fixed-seed mini ERP', () => {
  it('regenerates the same ordered payload, IDs and hash', () => {
    const first = generateMiniSeed();
    const second = generateMiniSeed();
    expect(canonicalJson(first)).toBe(canonicalJson(second));
    const { manifest, ...payload } = first;
    expect(manifest.sha256).toBe(sha256(payload));
  });
  it('changes the manifest for a different seed', () => {
    expect(generateMiniSeed(20261015).manifest.sha256).not.toBe(generateMiniSeed().manifest.sha256);
  });
  it('contains 10 demo transactions plus one separately identified isolation fixture', () => {
    const seed = generateMiniSeed();
    const demoCompany = seed.companies[0]!;
    expect(seed.transactions.filter((row) => row.companyId === demoCompany.id)).toHaveLength(10);
    expect(seed.manifest).toMatchObject({ demoTransactions: 10, isolationTransactions: 1, totalTransactions: 11 });
    expect(new Set(seed.transactions.map((row) => row.id)).size).toBe(11);
  });
  it('links each transaction to a same-company evidence and period with an exact total', () => {
    const data = generateMiniSeed();
    for (const row of data.transactions) {
      expect(data.documents.find((doc) => doc.id === row.sourceDocumentId)?.companyId).toBe(row.companyId);
      expect(data.periods.find((period) => period.id === row.periodId)?.companyId).toBe(row.companyId);
      expect(new ExactDecimal(row.net).plus(row.tax).eq(row.gross)).toBe(true);
    }
    for (const doc of data.documents) expect(doc.sha256).toBe(sha256(doc.content));
  });
  it('retains the independently authored sale input for Phase 3', () => {
    const gold = JSON.parse(readFileSync(new URL('../fixtures/sale-gold.json', import.meta.url), 'utf8')) as {
      sourceExternalRef: string; effectiveDate: string; expectedLines: { debit: string; credit: string }[];
    };
    const sale = generateMiniSeed().transactions.find((row) => row.externalRef === gold.sourceExternalRef)!;
    expect(sale).toMatchObject({ kind: 'sale', recognitionOn: gold.effectiveDate, net: '100000', tax: '10000', gross: '110000' });
    const totalDebit = gold.expectedLines.reduce((sum, line) => sum.plus(line.debit), new ExactDecimal(0));
    const totalCredit = gold.expectedLines.reduce((sum, line) => sum.plus(line.credit), new ExactDecimal(0));
    expect(totalDebit.eq(totalCredit)).toBe(true);
    expect(totalDebit.toFixed()).toBe('110000');
  });
});
