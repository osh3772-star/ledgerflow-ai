import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { generateFullErpSeed, generateMiniSeed, canonicalJson, sha256 } from '@ledgerflow/test-data';
import { ExactDecimal, transactionSchema } from '@ledgerflow/contracts';

const data = generateFullErpSeed();
const primary = data.companies[0]!.id;
const transactions = new Map(data.transactions.map((row) => [row.id, row]));
const documents = new Map(data.documents.map((row) => [row.id, row]));
const products = new Map(data.products.map((row) => [row.id, row]));
const invoices = new Map(data.invoices.map((row) => [row.id, row]));
const counterparties = new Map(data.counterparties.map((row) => [row.id, row]));
const bankEntries = new Map(data.bankTransactions.map((row) => [row.id, row]));
const total = (values: string[]) => values.reduce((sum, value) => sum.plus(value), new ExactDecimal(0));

describe('1,000-event synthetic ERP fixture', () => {
  it('reproduces the canonical payload/hash with a fixed seed and changes with another seed', () => {
    const { manifest, ...payload } = data;
    expect(canonicalJson(generateFullErpSeed())).toBe(canonicalJson(data));
    expect(manifest.sha256).toBe(sha256(payload));
    expect(generateFullErpSeed(20261015).manifest.sha256).not.toBe(manifest.sha256);
    expect(() => generateFullErpSeed(-1)).toThrow('seed must be a uint32.');
  });
  it('keeps exactly 1,000 company events and one separate isolation event across ten kinds', () => {
    const expected = { opening_capital: 1, purchase: 220, sale: 260, receipt: 180, payment: 160,
      payroll: 36, asset_acquisition: 12, prepayment: 24, accrual: 48, adjustment: 59 };
    for (const [kind, count] of Object.entries(expected)) {
      expect(data.transactions.filter((row) => row.companyId === primary && row.kind === kind)).toHaveLength(count);
    }
    expect(data.manifest).toMatchObject({ demoTransactions: 1000, isolationTransactions: 1, totalTransactions: 1001 });
  });
  it('uses a separate namespace from the mini DB demo to avoid accidental mixed seeding', () => {
    const miniIds = new Set(generateMiniSeed().transactions.map((row) => row.id));
    expect(data.transactions.some((row) => miniIds.has(row.id))).toBe(false);
    expect(data.companies[0]!.id).not.toBe(generateMiniSeed().companies[0]!.id);
  });
  it('has unique IDs and idempotency keys in each entity with strictly valid evidence/period references', () => {
    for (const rows of [data.transactions, data.documents, data.counterparties, data.products, data.contracts, data.invoices,
      data.invoiceLines, data.inventoryMovements, data.bankTransactions, data.settlements, data.fixedAssets,
      data.prepayments, data.payrolls, data.accruals, data.adjustments]) {
      expect(new Set(rows.map((row) => row.id)).size).toBe(rows.length);
    }
    expect(new Set(data.transactions.map((row) => row.idempotencyKey)).size).toBe(1001);
    for (const row of data.transactions) {
      expect(transactionSchema.safeParse(row).success).toBe(true);
      expect(documents.get(row.sourceDocumentId)?.companyId).toBe(row.companyId);
      const period = data.periods.find((p) => p.id === row.periodId)!;
      expect(period.companyId).toBe(row.companyId);
      expect(row.recognitionOn >= period.start && row.recognitionOn <= period.end).toBe(true);
    }
    for (const row of data.documents) expect(row.sha256).toBe(sha256(row.content));
  });
  it('links invoice lines to same-company transactions/counterparties and exact integer totals', () => {
    expect(data.invoices).toHaveLength(493);
    expect(data.invoiceLines).toHaveLength(493);
    for (const row of data.invoices) {
      const transaction = transactions.get(row.transactionId)!;
      expect(transaction.companyId).toBe(row.companyId);
      expect(transaction.sourceDocumentId).toBe(row.sourceDocumentId);
      expect(counterparties.get(row.counterpartyId)?.companyId).toBe(row.companyId);
      expect([transaction.net, transaction.tax, transaction.gross]).toEqual([row.net, row.tax, row.gross]);
      const lines = data.invoiceLines.filter((line) => line.invoiceId === row.id);
      expect(total(lines.map((line) => line.net)).eq(row.net)).toBe(true);
      for (const line of lines) {
        expect(line.companyId).toBe(row.companyId);
        expect(new ExactDecimal(line.quantity).mul(line.unitPrice).eq(line.net)).toBe(true);
        if (line.productId) expect(products.get(line.productId)?.companyId).toBe(row.companyId);
      }
      expect(new ExactDecimal(row.net).mul('0.1').eq(row.tax)).toBe(true);
    }
  });
  it('ties delivery contracts to each sale and never recognizes before delivery', () => {
    expect(data.contracts).toHaveLength(260);
    for (const contract of data.contracts) {
      const row = transactions.get(contract.transactionId)!;
      expect(row.kind).toBe('sale');
      expect(row.companyId).toBe(contract.companyId);
      expect(counterparties.get(contract.counterpartyId)?.role).toBe('customer');
      expect(counterparties.get(contract.counterpartyId)?.companyId).toBe(contract.companyId);
      expect(row.recognitionOn >= contract.deliveredOn).toBe(true);
    }
  });
  it('keeps stock nonnegative and ties each goods event to exactly one movement/invoice', () => {
    expect(data.inventoryMovements).toHaveLength(481);
    for (const product of data.products) {
      let stock = new ExactDecimal(0);
      const movements = data.inventoryMovements.filter((row) => row.productId === product.id)
        .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.direction === b.direction ? 0 : a.direction === 'in' ? -1 : 1);
      for (const row of movements) {
        expect(row.companyId).toBe(product.companyId);
        const source = transactions.get(row.transactionId)!;
        expect(source.companyId).toBe(row.companyId);
        expect(source.kind).toBe(row.direction === 'in' ? 'purchase' : 'sale');
        expect(source.recognitionOn).toBe(row.date);
        expect(row.unitCost).toBe(product.unitCost);
        stock = row.direction === 'in' ? stock.plus(row.quantity) : stock.minus(row.quantity);
        expect(stock.gte(0)).toBe(true);
        expect(data.invoices.filter((bill) => bill.transactionId === row.transactionId)).toHaveLength(1);
      }
    }
    for (const row of data.transactions.filter((row) => row.kind === 'purchase' || row.kind === 'sale')) {
      expect(data.inventoryMovements.filter((m) => m.transactionId === row.id)).toHaveLength(1);
    }
  });
  it('reconciles partial/full settlements without overpayment and uses the right cash direction', () => {
    expect(data.settlements).toHaveLength(340);
    let partial = 0;
    for (const bill of data.invoices) {
      const matches = data.settlements.filter((row) => row.invoiceId === bill.id);
      const paid = total(matches.map((row) => row.amount));
      expect(paid.lte(bill.gross)).toBe(true);
      if (paid.gt(0) && paid.lt(bill.gross)) partial++;
      for (const row of matches) {
        const bank = bankEntries.get(row.bankTransactionId)!;
        const source = transactions.get(row.transactionId)!;
        expect([source.companyId, bank.companyId, row.companyId]).toEqual([bill.companyId, bill.companyId, bill.companyId]);
        expect(bank.direction).toBe(bill.direction === 'sale' ? 'in' : 'out');
        expect(source.kind).toBe(bill.direction === 'sale' ? 'receipt' : 'payment');
        expect(bank.amount).toBe(row.amount);
        expect(source.gross).toBe(row.amount);
        expect(bank.date >= bill.issueDate).toBe(true);
      }
    }
    expect(partial).toBeGreaterThan(0);
  });
  it('keeps daily closing bank balances nonnegative and exact, with payroll withholding separate', () => {
    expect(data.bankTransactions).toHaveLength(414);
    for (const account of data.bankAccounts) {
      const rows = data.bankTransactions.filter((row) => row.bankAccountId === account.id);
      let balance = new ExactDecimal(0);
      for (const date of [...new Set(rows.map((row) => row.date))].sort()) {
        for (const row of rows.filter((row) => row.date === date)) {
          expect(row.companyId).toBe(account.companyId);
          expect(transactions.get(row.transactionId)?.companyId).toBe(row.companyId);
          expect(new ExactDecimal(row.amount).isInteger()).toBe(true);
          balance = row.direction === 'in' ? balance.plus(row.amount) : balance.minus(row.amount);
        }
        expect(balance.gte(0)).toBe(true);
      }
    }
    expect(total(data.bankTransactions.filter((row) => transactions.get(row.transactionId)?.kind === 'opening_capital').map((row) => row.amount)).toFixed()).toBe('500000000');
    for (const row of data.payrolls) {
      expect(new ExactDecimal(row.netPay).plus(row.withholding).eq(row.gross)).toBe(true);
      expect(bankEntries.size).toBe(414);
      expect(data.bankTransactions.find((b) => b.transactionId === row.transactionId)?.amount).toBe(row.netPay);
    }
  });
  it('links adjustment proposals to eligible assets/prepayments without exceeding their cost', () => {
    expect(data.fixedAssets).toHaveLength(12);
    expect(data.prepayments).toHaveLength(24);
    expect(data.adjustments).toHaveLength(59);
    for (const asset of data.fixedAssets) {
      expect(new ExactDecimal(asset.cost).minus(asset.residual).div(asset.usefulLifeMonths).eq(asset.monthlyDepreciation)).toBe(true);
      const entries = data.adjustments.filter((a) => a.assetId === asset.id);
      expect(total(entries.map((a) => a.amount)).lte(asset.cost)).toBe(true);
      for (const entry of entries) {
        expect(entry.companyId).toBe(asset.companyId);
        expect(transactions.get(entry.transactionId)!.recognitionOn >= asset.availableOn).toBe(true);
        expect(entry.amount).toBe(asset.monthlyDepreciation);
        expect(entry.postingState).toBe('proposed');
      }
    }
    for (const prepayment of data.prepayments) {
      const months = 13 - Number(prepayment.coverageStart.slice(5, 7));
      expect(new ExactDecimal(prepayment.monthlyExpense).mul(months).eq(prepayment.cost)).toBe(true);
      const entries = data.adjustments.filter((a) => a.prepaymentId === prepayment.id);
      expect(total(entries.map((a) => a.amount)).lte(prepayment.cost)).toBe(true);
      for (const entry of entries) {
        const date = transactions.get(entry.transactionId)!.recognitionOn;
        expect(date >= prepayment.coverageStart && date <= prepayment.coverageEnd).toBe(true);
      }
    }
  });
  it('keeps accrual service periods and reversal dates explicit with same-company references', () => {
    expect(data.accruals).toHaveLength(48);
    for (const accrual of data.accruals) {
      const row = transactions.get(accrual.transactionId)!;
      expect(row.companyId).toBe(accrual.companyId);
      expect(row.gross).toBe(accrual.amount);
      expect(row.recognitionOn).toBe(accrual.serviceEnd);
      expect(accrual.serviceStart <= accrual.serviceEnd && accrual.reversalOn > accrual.serviceEnd).toBe(true);
    }
  });
  it('matches an independently authored sale gold fixture including cost of sales', () => {
    const gold = JSON.parse(readFileSync(new URL('../fixtures/full-sale-gold.json', import.meta.url), 'utf8')) as {
      sourceExternalRef: string; recognitionOn: string; net: string; tax: string; gross: string; costOfSales: string;
      expectedLines: { debit: string; credit: string }[];
    };
    const sale = data.transactions.find((row) => row.externalRef === gold.sourceExternalRef)!;
    expect(sale).toMatchObject({ recognitionOn: gold.recognitionOn, net: gold.net, tax: gold.tax, gross: gold.gross });
    const movement = data.inventoryMovements.find((row) => row.transactionId === sale.id)!;
    expect(new ExactDecimal(movement.quantity).mul(movement.unitCost).toFixed()).toBe(gold.costOfSales);
    expect(total(gold.expectedLines.map((row) => row.debit)).eq(total(gold.expectedLines.map((row) => row.credit)))).toBe(true);
  });
  it('keeps all public data out of the ERP and contains no real registration/account/employee IDs', () => {
    for (const rows of [data.companies, data.transactions, data.counterparties, data.products, data.invoices, data.bankTransactions])
      expect(rows.every((row) => row.origin === 'synthetic_erp')).toBe(true);
    expect(data.counterparties.every((row) => row.registrationNumber === null)).toBe(true);
    expect(data.bankAccounts.every((row) => row.accountNumber === null)).toBe(true);
    expect(data.invoices.every((row) => row.governmentIssued === false)).toBe(true);
  });
});
