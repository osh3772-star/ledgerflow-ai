import { DomainError, transactionQuerySchema, invoiceQuerySchema, bankQuerySchema, inventoryQuerySchema,
  counterpartyQuerySchema, unprocessedQuerySchema, createTransactionSchema, type ErpRepository } from '@ledgerflow/contracts';

function validated<T>(schema: { safeParse(input: unknown): { success: boolean; data?: T } }, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new DomainError('INVALID_INPUT','ERP 입력 형식·금액·증빙 조건을 확인하세요.');
  return parsed.data!;
}

export class ErpService {
  constructor(private readonly repository: ErpRepository) {}

  async getTransactions(input: unknown) {
    return this.repository.getTransactions(validated(transactionQuerySchema,input));
  }
  async getUnprocessedTransactions(input: unknown) { return this.repository.getTransactions({ ...validated(unprocessedQuerySchema,input), status:'unprocessed' }); }
  async getInvoices(input: unknown) { return this.repository.getInvoices(validated(invoiceQuerySchema,input)); }
  async getBankTransactions(input: unknown) { return this.repository.getBankTransactions(validated(bankQuerySchema,input)); }
  async getInventory(input: unknown) { return this.repository.getInventory(validated(inventoryQuerySchema,input)); }
  async getCounterparties(input: unknown) { return this.repository.getCounterparties(validated(counterpartyQuerySchema,input)); }
  async createTransaction(input: unknown) { return this.repository.createTransaction(validated(createTransactionSchema,input)); }
}
export * from './accounting.js';
