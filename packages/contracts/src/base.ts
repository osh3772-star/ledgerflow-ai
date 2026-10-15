import { Decimal } from 'decimal.js';
import { z } from 'zod';

export const ExactDecimal = Decimal.clone({ precision: 40, rounding: Decimal.ROUND_HALF_UP });
export const uuidSchema = z.uuid();
export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const time = Date.parse(value + 'T00:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}, '유효한 YYYY-MM-DD 날짜가 필요합니다.');

export const moneySchema = z.string()
  .regex(/^-?(?:0|[1-9]\d{0,17})(?:\.\d{1,6})?$/, '금액은 정수 18자리·소수 6자리 이내의 문자열이어야 합니다.')
  .transform((value) => new ExactDecimal(value).toFixed());
export const nonNegativeMoneySchema = moneySchema.refine(
  (value) => new ExactDecimal(value).gte(0), '금액은 음수일 수 없습니다.',
);
export type Money = z.output<typeof moneySchema>;
export const originSchema = z.enum(['synthetic_erp', 'public_api_live', 'public_api_sample', 'mock']);

export const transactionKindSchema = z.enum([
  'opening_capital', 'purchase', 'sale', 'receipt', 'payment',
  'payroll', 'asset_acquisition', 'prepayment', 'accrual', 'adjustment',
]);
export const transactionStatusSchema = z.enum([
  'unprocessed', 'processing', 'waiting_approval', 'processed', 'failed',
]);

export const transactionSchema = z.strictObject({
  id: uuidSchema,
  companyId: uuidSchema,
  periodId: uuidSchema,
  sourceDocumentId: uuidSchema,
  counterpartyId: uuidSchema.optional(),
  externalRef: z.string().min(1).max(128),
  kind: transactionKindSchema,
  occurredOn: dateSchema,
  recognitionOn: dateSchema,
  currency: z.literal('KRW'),
  origin: z.literal('synthetic_erp'),
  net: nonNegativeMoneySchema,
  tax: nonNegativeMoneySchema,
  gross: nonNegativeMoneySchema,
  status: transactionStatusSchema,
  idempotencyKey: z.string().min(1).max(128),
}).superRefine((value, context) => {
  if (!new ExactDecimal(value.net).plus(value.tax).eq(value.gross)) {
    context.addIssue({ code: 'custom', path: ['gross'], message: 'gross = net + tax 조건을 만족해야 합니다.' });
  }
  for (const field of ['net', 'tax', 'gross'] as const) {
    if (!new ExactDecimal(value[field]).isInteger()) {
      context.addIssue({ code: 'custom', path: [field], message: '이 단계의 KRW 거래는 정수 원 금액만 지원합니다.' });
    }
  }
});
export type BusinessTransaction = z.output<typeof transactionSchema>;

export const transactionQuerySchema = z.strictObject({
  companyId: uuidSchema,
  from: dateSchema,
  to: dateSchema,
  status: transactionStatusSchema.optional(),
  kind: transactionKindSchema.optional(),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().min(1).max(512).optional(),
}).refine((value) => value.from <= value.to, { message: 'from은 to 이후일 수 없습니다.', path: ['to'] });
export type TransactionQuery = z.output<typeof transactionQuerySchema>;

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}
export interface TransactionRepository {
  getTransactions(query: TransactionQuery): Promise<Page<BusinessTransaction>>;
}
export class DomainError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'DomainError';
  }
}
