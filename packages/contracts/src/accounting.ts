import { z } from 'zod';
import { uuidSchema,dateSchema } from './base.js';

export const wonSchema=z.string().regex(/^(?:0|[1-9]\d{0,17})$/u);
export const journalLineSchema=z.strictObject({accountCode:z.string().regex(/^\d{4}$/u),debit:wonSchema,credit:wonSchema});
export const basisSchema=z.strictObject({standards:z.array(z.string().max(120)).min(1).max(12),
  assumptions:z.array(z.string().max(500)).min(1).max(20),uncertainty:z.string().max(2000),
  expertReviewed:z.literal(false)});
export const journalPayloadSchema=z.strictObject({transactionId:uuidSchema,periodId:uuidSchema,recognitionOn:dateSchema,
  entryType:z.enum(['source','adjustment','reversal']),description:z.string().min(1).max(500),
  sourceDocumentIds:z.array(uuidSchema).min(1).max(20),lines:z.array(journalLineSchema).min(2).max(100),
  evidenceHashes:z.array(z.strictObject({documentId:uuidSchema,sha256:z.string().regex(/^[a-f0-9]{64}$/u)})).min(1).max(20),
  basis:basisSchema,policyVersion:z.literal('lf-accounting-v1'),reversalOf:uuidSchema.optional(),
  calculation:z.strictObject({type:z.enum(['depreciation','prepaid_expense']),referenceId:uuidSchema,periodId:uuidSchema}).optional()});
export type JournalPayload=z.output<typeof journalPayloadSchema>;
export const journalSchema=z.strictObject({id:uuidSchema,companyId:uuidSchema,payload:journalPayloadSchema,
  hash:z.string().regex(/^[a-f0-9]{64}$/u),version:z.number().int().positive(),
  state:z.enum(['Draft','Validated','Approval','Posted']),idempotencyKey:z.string(),postedAt:z.string().nullable(),
  discardedAt:z.string().nullable().default(null),discardReason:z.string().nullable().default(null)});
export type Journal=z.output<typeof journalSchema>;
export const companyInput=z.strictObject({companyId:uuidSchema});
export const proposeInput=companyInput.extend({transactionId:uuidSchema,idempotencyKey:z.string().min(1).max(128)});
export const journalInput=companyInput.extend({journalId:uuidSchema});
export const postInput=journalInput.extend({expectedHash:z.string().regex(/^[a-f0-9]{64}$/u)});
export const discardInput=postInput.extend({reason:z.string().min(1).max(500)});
export const reconciliationInput=companyInput.extend({bankTransactionId:uuidSchema,journalId:uuidSchema});
export const rangeInput=companyInput.extend({from:dateSchema,to:dateSchema}).refine(v=>v.from<=v.to);
export const periodInput=companyInput.extend({periodId:uuidSchema});
export const reverseInput=journalInput.extend({recognitionOn:dateSchema,idempotencyKey:z.string().min(1).max(128)});
export const documentInput=companyInput.extend({transactionId:uuidSchema});
export const listJournalInput=companyInput.extend({state:z.enum(['Draft','Validated','Approval','Posted']).optional(),
  limit:z.number().int().min(1).max(100).default(50),after:uuidSchema.optional()});
export const decisionInput=postInput.extend({decision:z.enum(['approved','rejected'])});
export const agentResultSchema=z.strictObject({taskId:z.string().min(1).max(128),role:z.enum(['supervisor','sales','purchase','treasury','closing','audit']),
  status:z.enum(['completed','blocked','failed']),transactionIds:z.array(uuidSchema).max(1000),
  toolTraceIds:z.array(uuidSchema).max(1000),findings:z.array(z.string().max(1000)).max(100),
  missingEvidence:z.array(z.string().max(500)).max(100),riskFlags:z.array(z.string().max(500)).max(100),
  blockedReasons:z.array(z.string().max(500)).max(100),humanApprovalRequired:z.boolean(),journalPosted:z.boolean(),
  accountingJudgments:z.array(z.strictObject({standardReference:z.string().max(200),assumptions:z.array(z.string().max(500)).max(20),
    uncertainty:z.string().max(2000)})).max(20).default([]),
  proposedActions:z.array(z.string().max(500)).max(100).default([])});
