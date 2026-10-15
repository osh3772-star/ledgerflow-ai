import { describe, expect, it } from 'vitest';
import { dateSchema, moneySchema, ExactDecimal, transactionSchema } from '@ledgerflow/contracts';
import { generateMiniSeed } from '@ledgerflow/test-data';

describe('exact money and transaction contracts', () => {
  it('adds decimal fractions without binary floating-point error', () => {
    expect(new ExactDecimal('0.1').plus('0.2').toFixed()).toBe('0.3');
  });
  it('preserves a KRW integer above Number.MAX_SAFE_INTEGER', () => {
    expect(moneySchema.parse('999999999999999999')).toBe('999999999999999999');
  });
  it('normalizes PostgreSQL numeric output', () => {
    expect(moneySchema.parse('110000.000000')).toBe('110000');
  });
  it.each(['1e3', 'NaN', 'Infinity', '01', '1000000000000000000', '0.0000001'])(
    'rejects unsupported money format %s', (value) => expect(moneySchema.safeParse(value).success).toBe(false),
  );
  it.each(['2026-02-29', '2026-02-30', '2026-13-01', '2026-00-01'])(
    'rejects an invalid date %s', (date) => expect(dateSchema.safeParse(date).success).toBe(false),
  );
  it('accepts a leap day', () => expect(dateSchema.parse('2024-02-29')).toBe('2024-02-29'));
  it('rejects an unbalanced source amount', () => {
    const row = generateMiniSeed().transactions[2]!;
    expect(transactionSchema.safeParse({ ...row, gross: '110001' }).success).toBe(false);
  });
  it('rejects sub-won transaction amounts and negative totals', () => {
    const row = generateMiniSeed().transactions[2]!;
    expect(transactionSchema.safeParse({ ...row, net: '0.1', tax: '0', gross: '0.1' }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...row, net: '-1', tax: '0', gross: '-1' }).success).toBe(false);
  });
  it('does not admit real public financial data or an injected state property', () => {
    const row = generateMiniSeed().transactions[2]!;
    expect(transactionSchema.safeParse({ ...row, origin: 'public_api_live' }).success).toBe(false);
    expect(transactionSchema.safeParse({ ...row, posted: true }).success).toBe(false);
  });
});
