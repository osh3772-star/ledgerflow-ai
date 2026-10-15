import { z } from 'zod';
import { ExactDecimal, dateSchema, uuidSchema, nonNegativeMoneySchema,
  transactionKindSchema, transactionSchema, type TransactionRepository, type Page } from './base.js';

const pageFields = { companyId: uuidSchema, limit: z.number().int().min(1).max(100).default(50), cursor: z.string().min(1).max(512).optional() };
const rangeFields = { ...pageFields, from: dateSchema, to: dateSchema };
const validRange = (value: { from: string; to: string }) => value.from <= value.to;
const won = nonNegativeMoneySchema.refine((value) => new ExactDecimal(value).isInteger(), '정수 원 금액이 필요합니다.');
const aggregate = z.string().regex(/^-?(?:0|[1-9]\d{0,35})$/u);
const quantity = z.string().regex(/^[1-9]\d{0,11}$/u);
export const invoiceQuerySchema = z.strictObject({ ...rangeFields, direction: z.enum(['sales','purchase']).optional(), transactionId: uuidSchema.optional() })
  .refine(validRange,{message:'유효한 기간 범위가 필요합니다.'});
export const bankQuerySchema = z.strictObject({ ...rangeFields, bankAccountId: uuidSchema.optional(), unmatchedOnly: z.boolean().default(false) })
  .refine(validRange,{message:'유효한 기간 범위가 필요합니다.'});
export const inventoryQuerySchema = z.strictObject({ ...pageFields, asOf: dateSchema, productId: uuidSchema.optional() });
export const counterpartyQuerySchema = z.strictObject({ ...pageFields, query: z.string().trim().max(200).default('') });
export const unprocessedQuerySchema = z.strictObject({ ...rangeFields, kind: transactionKindSchema.optional() })
  .refine(validRange,{message:'유효한 기간 범위가 필요합니다.'});

const origin = z.literal('synthetic_erp');
const entity = { id: uuidSchema, companyId: uuidSchema, origin };
export const invoiceLineSchema = z.strictObject({ ...entity, invoiceId: uuidSchema, productId: uuidSchema.nullable(),
  description: z.string(), quantity, unitPrice: won, net: won });
export const invoiceSchema = z.strictObject({ ...entity, transactionId: uuidSchema, sourceDocumentId: uuidSchema,
  counterpartyId: uuidSchema, direction: z.enum(['sales','purchase']), number: z.string(), issueDate: dateSchema,
  net: won, tax: won, gross: won, governmentIssued: z.literal(false), evidenceSha256: z.string().regex(/^[a-f0-9]{64}$/u),
  lines: z.array(invoiceLineSchema).max(200) });
export const bankTransactionSchema = z.strictObject({ ...entity, transactionId: uuidSchema, bankAccountId: uuidSchema,
  bookedOn: dateSchema, direction: z.enum(['in','out']), amount: won, currency: z.literal('KRW'),
  erpAllocatedAmount: won, erpUnallocatedAmount: won });
export const inventoryPositionSchema = z.strictObject({ companyId: uuidSchema, origin, productId: uuidSchema, sku: z.string(),
  quantity: aggregate, carryingAmount: aggregate.nullable(), asOf: dateSchema, movementCount: z.number().int().nonnegative(),
  costStatus: z.enum(['source_estimate','pending']), costPolicyVersion: z.literal('synthetic-constant-unit-cost-v1').nullable() });
export const counterpartySchema = z.strictObject({ ...entity, name: z.string(), role: z.enum(['customer','supplier']), businessNoMasked: z.null() });

// Metadata field names use ASCII; text values may be Korean/Unicode. Numbers
// are safe integers, decimal amounts are strings, depth/size are bounded.
function validEvidenceJson(value: unknown, depth = 0): boolean {
  if (depth > 8) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isSafeInteger(value);
  if (typeof value === 'string') return !/[\u0000\uD800-\uDFFF]/u.test(value);
  if (Array.isArray(value)) return value.length <= 100 && value.every((item) => validEvidenceJson(item, depth + 1));
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    return entries.length <= 64 && entries.every(([key,item]) => /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(key) && validEvidenceJson(item,depth+1));
  }
  return false;
}
export const evidenceSchema = z.strictObject({ documentType: z.string().trim().min(1).max(64),
  issueDate: dateSchema, content: z.object({ origin }).catchall(z.json()).refine(validEvidenceJson)
    .refine((value) => new TextEncoder().encode(JSON.stringify(value)).length <= 16384, '증빙 메타데이터가 너무 큽니다.') });
export const createTransactionSchema = z.strictObject({ companyId: uuidSchema, idempotencyKey: z.string().min(1).max(128),
  externalRef: z.string().min(1).max(128), kind: transactionKindSchema, occurredOn: dateSchema, recognitionOn: dateSchema,
  counterpartyId: uuidSchema.optional(), currency: z.literal('KRW'), net: won, tax: won, gross: won,
  documentIds: z.array(uuidSchema).min(1).max(20).optional(), documents: z.array(evidenceSchema).min(1).max(20).optional(),
}).superRefine((value,ctx) => {
  if (!new ExactDecimal(value.net).plus(value.tax).eq(value.gross)) ctx.addIssue({code:'custom',path:['gross'],message:'gross = net + tax 조건이 필요합니다.'});
  if (Boolean(value.documentIds) === Boolean(value.documents)) ctx.addIssue({code:'custom',path:['documents'],message:'기존 증빙 또는 새 증빙 중 하나가 필요합니다.'});
  if (value.documentIds && new Set(value.documentIds).size !== value.documentIds.length) ctx.addIssue({code:'custom',path:['documentIds'],message:'중복 증빙 참조를 허용하지 않습니다.'});
});
export const createTransactionResultSchema = z.strictObject({ transaction: transactionSchema, documentIds: z.array(uuidSchema).min(1).max(20), reused: z.boolean() });
export type InvoiceQuery = z.output<typeof invoiceQuerySchema>;
export type BankQuery = z.output<typeof bankQuerySchema>;
export type InventoryQuery = z.output<typeof inventoryQuerySchema>;
export type CounterpartyQuery = z.output<typeof counterpartyQuerySchema>;
export type CreateTransactionInput = z.output<typeof createTransactionSchema>;
export type CreateTransactionResult = z.output<typeof createTransactionResultSchema>;
export type Invoice = z.output<typeof invoiceSchema>;
export type BankTransaction = z.output<typeof bankTransactionSchema>;
export type InventoryPosition = z.output<typeof inventoryPositionSchema>;
export type Counterparty = z.output<typeof counterpartySchema>;
export interface ErpRepository extends TransactionRepository {
  getInvoices(query: InvoiceQuery): Promise<Page<Invoice>>;
  getBankTransactions(query: BankQuery): Promise<Page<BankTransaction>>;
  getInventory(query: InventoryQuery): Promise<Page<InventoryPosition>>;
  getCounterparties(query: CounterpartyQuery): Promise<Page<Counterparty>>;
  createTransaction(input: CreateTransactionInput): Promise<CreateTransactionResult>;
}
