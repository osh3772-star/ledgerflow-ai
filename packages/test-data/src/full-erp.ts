import { ExactDecimal, transactionSchema, type BusinessTransaction } from '@ledgerflow/contracts';
import { DEFAULT_SEED, generateMiniSeed, integerRandom, sha256, stableId, type MiniSeed } from './index.js';

export const FULL_GENERATOR_VERSION = 'lf-erp-1000-v1';
interface Fixture { id: string; companyId: string; origin: 'synthetic_erp' }
export interface CounterpartyFixture extends Fixture { name: string; role: 'customer' | 'supplier'; registrationNumber: null }
export interface ProductFixture extends Fixture { sku: string; unitCost: string; unitPrice: string }
export interface ContractFixture extends Fixture { counterpartyId: string; transactionId: string; deliveredOn: string; performanceObligations: number }
export interface InvoiceFixture extends Fixture { number: string; transactionId: string; sourceDocumentId: string; counterpartyId: string; direction: 'sale' | 'purchase'; issueDate: string; net: string; tax: string; gross: string; governmentIssued: false }
export interface InvoiceLineFixture extends Fixture { invoiceId: string; productId: string | null; description: string; quantity: string; unitPrice: string; net: string }
export interface MovementFixture extends Fixture { transactionId: string; productId: string; date: string; direction: 'in' | 'out'; quantity: string; unitCost: string }
export interface BankFixture extends Fixture { bankAccountId: string; transactionId: string; date: string; direction: 'in' | 'out'; amount: string }
export interface SettlementFixture extends Fixture { bankTransactionId: string; invoiceId: string; transactionId: string; amount: string }
export interface AssetFixture extends Fixture { transactionId: string; acquiredOn: string; availableOn: string; cost: string; residual: string; usefulLifeMonths: number; monthlyDepreciation: string }
export interface PrepaymentFixture extends Fixture { transactionId: string; coverageStart: string; coverageEnd: string; cost: string; monthlyExpense: string }
export interface PayrollFixture extends Fixture { transactionId: string; employeeRef: string; gross: string; withholding: string; netPay: string; statutoryCalculation: false }
export interface AccrualFixture extends Fixture { transactionId: string; serviceStart: string; serviceEnd: string; amount: string; reversalOn: string }
export interface AdjustmentFixture extends Fixture { transactionId: string; type: 'depreciation' | 'prepaid_expense'; assetId: string | null; prepaymentId: string | null; amount: string; postingState: 'proposed' }
export interface FullErpSeed extends MiniSeed {
  assumptions: string[];
  counterparties: CounterpartyFixture[];
  products: ProductFixture[];
  bankAccounts: (Fixture & { label: string; accountNumber: null })[];
  contracts: ContractFixture[];
  invoices: InvoiceFixture[];
  invoiceLines: InvoiceLineFixture[];
  inventoryMovements: MovementFixture[];
  bankTransactions: BankFixture[];
  settlements: SettlementFixture[];
  fixedAssets: AssetFixture[];
  prepayments: PrepaymentFixture[];
  payrolls: PayrollFixture[];
  accruals: AccrualFixture[];
  adjustments: AdjustmentFixture[];
}
const money = (value: string | number | InstanceType<typeof ExactDecimal>) => new ExactDecimal(value).toFixed();
const pad = (value: number) => String(value).padStart(2, '0');
const day = (month: number, date: number) => '2026-' + pad(month) + '-' + pad(date);
const lastDay = (month: number) => new Date(Date.UTC(2026, month, 0)).toISOString().slice(0, 10);
const id = (name: string) => stableId(FULL_GENERATOR_VERSION + '/' + name);

export function generateFullErpSeed(seed: number = DEFAULT_SEED): FullErpSeed {
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new Error('seed must be a uint32.');
  const random = integerRandom(seed);
  const mini = generateMiniSeed(seed);
  const company = id('company-a');
  const isolation = id('company-b');
  const base = (name: string, companyId = company): Fixture => ({ id: id(companyId + '/' + name), companyId, origin: 'synthetic_erp' });
  const companies = mini.companies.map((row, i) => ({ ...row, id: i === 0 ? company : isolation, policyVersion: 'synthetic-goods-2026-v1' }));
  const identities = mini.identities.map((row) => ({ ...row, companyId: row.companyId === mini.companies[0]!.id ? company : isolation,
    userId: id(row.userId), principalId: id(row.principalId) }));
  const periods = [company, isolation].flatMap((companyId) => Array.from({ length: companyId === company ? 12 : 1 }, (_, i) => ({
    id: id(companyId + '/period/' + (i + 1)), companyId, start: day(i + 1, 1), end: lastDay(i + 1),
  })));
  const extraAccounts = [
    ['1400', '선급비용', 'asset', 'debit'], ['1500', '비품', 'asset', 'debit'], ['1590', '감가상각누계액', 'asset', 'credit'],
    ['2020', '미지급비용', 'liability', 'credit'], ['2030', '예수금', 'liability', 'credit'],
    ['5020', '급여', 'expense', 'debit'], ['5030', '감가상각비', 'expense', 'debit'],
    ['5040', '보험료', 'expense', 'debit'], ['5050', '용역비', 'expense', 'debit'],
  ] as const;
  const accounts = [company, isolation].flatMap((companyId) => [
    ...mini.accounts.filter((row) => row.companyId === mini.companies[0]!.id).map((row) => ({ ...row, id: id(companyId + '/account/' + row.code), companyId })),
    ...extraAccounts.map(([code, name, kind, normalSide]) => ({ id: id(companyId + '/account/' + code), companyId, code, name, kind, normalSide })),
  ]);
  const counterparties: CounterpartyFixture[] = Array.from({ length: 40 }, (_, i) => ({ ...base('counterparty/' + i), name: '가상 거래처 ' + pad(i + 1),
    role: i < 20 ? 'customer' : 'supplier', registrationNumber: null }));
  counterparties.push({ ...base('counterparty/0', isolation), name: '격리 검증용 가상 공급자', role: 'supplier', registrationNumber: null });
  const products: ProductFixture[] = Array.from({ length: 20 }, (_, i) => ({ ...base('product/' + i), sku: 'LF-SKU-' + pad(i + 1),
    unitCost: String(1000 * (i + 1)), unitPrice: String(1400 * (i + 1)) }));
  products.push({ ...base('product/0', isolation), sku: 'ISOLATION-SKU', unitCost: '1000', unitPrice: '1400' });
  const bankAccounts = [0, 1].map((i) => ({ ...base('bank/' + i), label: '가상 보통예금 ' + (i + 1), accountNumber: null }));
  bankAccounts.push({ ...base('bank/0', isolation), label: '격리 검증용 가상 계좌', accountNumber: null });
  const transactions: BusinessTransaction[] = [];
  const documents: FullErpSeed['documents'] = [];
  const contracts: ContractFixture[] = [], invoices: InvoiceFixture[] = [], invoiceLines: InvoiceLineFixture[] = [];
  const inventoryMovements: MovementFixture[] = [], bankTransactions: BankFixture[] = [], settlements: SettlementFixture[] = [];
  const fixedAssets: AssetFixture[] = [], prepayments: PrepaymentFixture[] = [], payrolls: PayrollFixture[] = [], accruals: AccrualFixture[] = [], adjustments: AdjustmentFixture[] = [];
  const add = (ref: string, kind: BusinessTransaction['kind'], date: string, net: string, tax = '0', details: Record<string, unknown> = {}, companyId = company) => {
    const transactionId = base('transaction/' + ref, companyId).id;
    const documentId = base('document/' + ref, companyId).id;
    const content = { origin: 'synthetic_erp', externalRef: ref, kind, transactionId, issuedOn: date, net, tax, ...details };
    documents.push({ id: documentId, companyId, issueDate: date, kind, storagePath: null, content, sha256: sha256(content) });
    const row = transactionSchema.parse({ id: transactionId, companyId, periodId: id(companyId + '/period/' + Number(date.slice(5, 7))), sourceDocumentId: documentId,
      externalRef: ref, kind, occurredOn: date, recognitionOn: date, currency: 'KRW', origin: 'synthetic_erp', net, tax,
      gross: money(new ExactDecimal(net).plus(tax)), status: 'unprocessed', idempotencyKey: FULL_GENERATOR_VERSION + '/' + companyId + '/' + ref });
    transactions.push(row); return row;
  };
  const bank = (row: BusinessTransaction, direction: 'in' | 'out', amount = row.gross, accountIndex = 0) => {
    const entry: BankFixture = { ...base('bank-transaction/' + row.externalRef + '/' + accountIndex, row.companyId),
      transactionId: row.id, bankAccountId: bankAccounts.filter((a) => a.companyId === row.companyId)[accountIndex]!.id, date: row.recognitionOn, direction, amount };
    bankTransactions.push(entry); return entry;
  };
  const invoice = (row: BusinessTransaction, counterparty: CounterpartyFixture, product: ProductFixture | null, quantity: string, unitPrice: string) => {
    const entry: InvoiceFixture = { ...base('invoice/' + row.externalRef, row.companyId), number: 'DEMO-' + row.externalRef, transactionId: row.id,
      sourceDocumentId: row.sourceDocumentId, counterpartyId: counterparty.id, direction: row.kind === 'sale' ? 'sale' : 'purchase',
      issueDate: row.occurredOn, net: row.net, tax: row.tax, gross: row.gross, governmentIssued: false };
    invoices.push(entry);
    invoiceLines.push({ ...base('invoice-line/' + row.externalRef, row.companyId), invoiceId: entry.id, productId: product?.id ?? null,
      description: product?.sku ?? '가상 사무용 비품', quantity, unitPrice, net: row.net });
    return entry;
  };
  const opening = add('LF26-CAP-01', 'opening_capital', day(1, 1), '500000000', '0', { capitalPaidIn: true });
  bank(opening, 'in', '250000000', 0); bank(opening, 'in', '250000000', 1);
  let purchaseIndex = 0, saleIndex = 0;
  for (let month = 1; month <= 12; month++) {
    if (month <= 11) for (let skuIndex = 0; skuIndex < 20; skuIndex++) {
      const product = products[skuIndex]!, supplier = counterparties[20 + skuIndex]!;
      const quantity = month === 1 && skuIndex === 0 ? '60' : String(random(50, 90));
      const net = money(new ExactDecimal(product.unitCost).mul(quantity));
      const row = add('LF26-PUR-' + pad(month) + pad(skuIndex + 1), 'purchase', day(month, 5), net,
        money(new ExactDecimal(net).mul('0.1')), { productId: product.id, counterpartyId: supplier.id, quantity });
      const bill = invoice(row, supplier, product, quantity, product.unitCost);
      inventoryMovements.push({ ...base('movement/' + row.externalRef), transactionId: row.id, productId: product.id, date: row.occurredOn, direction: 'in', quantity, unitCost: product.unitCost });
      if (purchaseIndex < 160) {
        const amount = money(new ExactDecimal(row.gross).div(purchaseIndex % 3 === 2 ? 2 : 1));
        const payment = add('LF26-PAY-' + pad(month) + pad(skuIndex + 1), 'payment', day(month, 18), amount, '0', { invoiceId: bill.id, counterpartyId: supplier.id });
        const movement = bank(payment, 'out', amount, purchaseIndex % 2);
        settlements.push({ ...base('settlement/' + payment.externalRef), bankTransactionId: movement.id, invoiceId: bill.id, transactionId: payment.id, amount });
      }
      purchaseIndex++;
    }
    const batches = month === 12 ? 2 : 1;
    for (let batch = 0; batch < batches; batch++) for (let skuIndex = 0; skuIndex < 20; skuIndex++) {
      const product = products[skuIndex]!, customer = counterparties[skuIndex]!;
      const quantity = month === 1 && skuIndex === 0 ? '2' : String(random(1, 12));
      const net = money(new ExactDecimal(product.unitPrice).mul(quantity));
      const date = day(month, batch === 0 ? 10 : 20);
      const row = add('LF26-SAL-' + pad(month) + pad(skuIndex + 1) + (batch ? '-B' : ''), 'sale', date, net,
        money(new ExactDecimal(net).mul('0.1')), { productId: product.id, counterpartyId: customer.id, quantity, deliveredOn: date, singlePerformanceObligation: true });
      contracts.push({ ...base('contract/' + row.externalRef), counterpartyId: customer.id, transactionId: row.id, deliveredOn: date, performanceObligations: 1 });
      const bill = invoice(row, customer, product, quantity, product.unitPrice);
      inventoryMovements.push({ ...base('movement/' + row.externalRef), transactionId: row.id, productId: product.id, date, direction: 'out', quantity, unitCost: product.unitCost });
      if (saleIndex < 180) {
        const amount = money(new ExactDecimal(row.gross).div(saleIndex % 3 === 2 ? 2 : 1));
        const receipt = add('LF26-RCP-' + pad(month) + pad(skuIndex + 1), 'receipt', day(month, 15), amount, '0', { invoiceId: bill.id, counterpartyId: customer.id });
        const movement = bank(receipt, 'in', amount, saleIndex % 2);
        settlements.push({ ...base('settlement/' + receipt.externalRef), bankTransactionId: movement.id, invoiceId: bill.id, transactionId: receipt.id, amount });
      }
      saleIndex++;
    }
    const assetCost = String(600000 + (month - 1) * 60000);
    const assetRow = add('LF26-PPE-' + pad(month), 'asset_acquisition', day(month, 1), assetCost, money(new ExactDecimal(assetCost).mul('0.1')), { availableOn: day(month, 1), usefulLifeMonths: 60, residualValue: '0' });
    fixedAssets.push({ ...base('asset/' + assetRow.externalRef), transactionId: assetRow.id, acquiredOn: assetRow.occurredOn, availableOn: assetRow.occurredOn,
      cost: assetCost, residual: '0', usefulLifeMonths: 60, monthlyDepreciation: money(new ExactDecimal(assetCost).div(60)) });
    invoice(assetRow, counterparties[20]!, null, '1', assetCost); bank(assetRow, 'out', assetRow.gross, month % 2);
    for (let i = 0; i < 2; i++) {
      const cost = String((13 - month) * 10000);
      const row = add('LF26-PRE-' + pad(month) + pad(i + 1), 'prepayment', day(month, 1), cost, '0', { coverageEnd: '2026-12-31', fixtureTaxTreatment: 'VAT excluded by scenario assumption; not a tax conclusion' });
      prepayments.push({ ...base('prepayment/' + row.externalRef), transactionId: row.id, coverageStart: row.occurredOn, coverageEnd: '2026-12-31', cost, monthlyExpense: '10000' });
      bank(row, 'out', row.gross, i);
    }
    for (let employee = 0; employee < 3; employee++) {
      const row = add('LF26-PAYROLL-' + pad(month) + pad(employee + 1), 'payroll', day(month, 25), '2000000', '0', { employeeRef: 'SYNTHETIC-EMP-' + (employee + 1), netPay: '1800000', withholding: '200000', statutoryCalculation: false });
      payrolls.push({ ...base('payroll/' + row.externalRef), transactionId: row.id, employeeRef: 'SYNTHETIC-EMP-' + (employee + 1), gross: '2000000', withholding: '200000', netPay: '1800000', statutoryCalculation: false });
      bank(row, 'out', '1800000', employee % 2);
    }
    for (let i = 0; i < 4; i++) {
      const row = add('LF26-ACC-' + pad(month) + pad(i + 1), 'accrual', lastDay(month), String(100000 + i * 50000), '0', { serviceStart: day(month, 1), serviceEnd: lastDay(month), fixtureTaxTreatment: 'VAT excluded by scenario assumption' });
      accruals.push({ ...base('accrual/' + row.externalRef), transactionId: row.id, serviceStart: day(month, 1), serviceEnd: lastDay(month), amount: row.gross,
        reversalOn: month === 12 ? '2027-01-01' : day(month + 1, 1) });
    }
  }
  // 59 proposed examples are part of the 1,000 source events, not a complete year-end close.
  let adjustmentNumber = 0;
  for (let month = 1; month <= 12 && adjustmentNumber < 48; month++) for (const asset of fixedAssets) {
    if (asset.availableOn > lastDay(month) || adjustmentNumber >= 48) continue;
    const row = add('LF26-ADJ-DEP-' + String(++adjustmentNumber).padStart(3, '0'), 'adjustment', lastDay(month), asset.monthlyDepreciation, '0', { assetId: asset.id, type: 'depreciation', postingState: 'proposed' });
    adjustments.push({ ...base('adjustment/' + row.externalRef), transactionId: row.id, type: 'depreciation', assetId: asset.id, prepaymentId: null, amount: row.gross, postingState: 'proposed' });
  }
  for (let month = 2; month <= 12; month++) {
    const prepayment = prepayments[0]!;
    const row = add('LF26-ADJ-PRE-' + pad(month), 'adjustment', lastDay(month), prepayment.monthlyExpense, '0', { prepaymentId: prepayment.id, type: 'prepaid_expense', postingState: 'proposed' });
    adjustments.push({ ...base('adjustment/' + row.externalRef), transactionId: row.id, type: 'prepaid_expense', assetId: null, prepaymentId: prepayment.id, amount: row.gross, postingState: 'proposed' });
  }
  const isolated = add('LF26-ISO-PUR-01', 'purchase', day(1, 5), '50000', '5000', { productId: products.at(-1)!.id, counterpartyId: counterparties.at(-1)!.id, quantity: '50' }, isolation);
  invoice(isolated, counterparties.at(-1)!, products.at(-1)!, '50', '1000');
  inventoryMovements.push({ ...base('movement/' + isolated.externalRef, isolation), transactionId: isolated.id, productId: products.at(-1)!.id, date: isolated.occurredOn, direction: 'in', quantity: '50', unitCost: '1000' });
  transactions.sort((a, b) => a.companyId.localeCompare(b.companyId, 'en') || a.recognitionOn.localeCompare(b.recognitionOn, 'en') || a.externalRef.localeCompare(b.externalRef, 'en'));
  const data = { generatorVersion: FULL_GENERATOR_VERSION, seed, createdAt: '2026-01-01T00:00:00.000Z', companies, identities, periods, accounts, documents, transactions,
    assumptions: ['All data is synthetic; no real registration/account numbers or statutory e-invoices.',
      'Domestic goods/PPE use a fixture VAT rate of 10%; tax eligibility is assumed, not legally verified.',
      'SKU acquisition unit costs are constant; revenue recognition assumes delivery and one obligation.',
      'Depreciation uses 60-month straight line from availability; month convention requires accounting review.',
      'Payroll withholding is a fixture amount; it is not calculated under Korean payroll tax rules.',
      '59 adjustment scenarios are proposed examples; remaining closing adjustments must be computed by the core engine.'],
    counterparties, products, bankAccounts, contracts, invoices, invoiceLines, inventoryMovements, bankTransactions, settlements, fixedAssets, prepayments, payrolls, accruals, adjustments };
  const demoTransactions = transactions.filter((row) => row.companyId === company).length;
  if (demoTransactions !== 1000) throw new Error('Unexpected fixture count.');
  return { ...data, manifest: { sha256: sha256(data), demoTransactions, isolationTransactions: 1, totalTransactions: transactions.length } };
}
