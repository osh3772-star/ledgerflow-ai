import pg from 'pg';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  DomainError, dateSchema, uuidSchema, transactionSchema, transactionStatusSchema, transactionKindSchema,
  type TransactionRepository, type TransactionQuery, type BusinessTransaction, type Page,
} from '@ledgerflow/contracts';
const { Pool } = pg;

export { Pool };
export type { PoolClient } from 'pg';

const cursorSchema = z.strictObject({
  companyId: uuidSchema, from: dateSchema, to: dateSchema,
  status: transactionStatusSchema.nullable(), date: dateSchema, id: uuidSchema,
  kind: transactionKindSchema.nullable(),
});
type Cursor = z.output<typeof cursorSchema>;
function decodeCursor(query: TransactionQuery): Cursor | null {
  if (!query.cursor) return null;
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(query.cursor)) throw new Error();
    const cursor = cursorSchema.parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')));
    if (cursor.companyId !== query.companyId || cursor.from !== query.from ||
        cursor.to !== query.to || cursor.status !== (query.status ?? null) || cursor.kind !== (query.kind ?? null)) throw new Error();
    if (cursor.date < query.from || cursor.date > query.to) throw new Error();
    return cursor;
  } catch {
    throw new DomainError('INVALID_CURSOR', '현재 회사·조회 조건과 일치하는 cursor가 필요합니다.');
  }
}
export class PostgresTransactionReader implements TransactionRepository {
  protected readonly authenticatedUserId: string;
  // The caller identity must come from trusted authentication, never from tool arguments.
  constructor(protected readonly pool: pg.Pool, authenticatedUserId: string) {
    this.authenticatedUserId = uuidSchema.parse(authenticatedUserId);
  }
  async getTransactions(query: TransactionQuery): Promise<Page<BusinessTransaction>> {
    const cursor = decodeCursor(query);
    return this.withScope(query.companyId,'erp:read',async (client) => {
      const result = await client.query<{
        id: string; company_id: string; period_id: string; source_document_id: string; counterparty_id: string | null;
        external_ref: string; kind: string; occurred_on: string; recognition_on: string;
        currency: string; origin: string; net_amount: string; tax_amount: string;
        gross_amount: string; status: string; idempotency_key: string;
      }>(`
        SELECT id, company_id, period_id, source_document_id, counterparty_id, external_ref, kind,
          occurred_on::text, recognition_on::text, currency, origin,
          net_amount::text, tax_amount::text, gross_amount::text, status, idempotency_key
        FROM public.business_transactions
        WHERE company_id = $1::uuid AND recognition_on BETWEEN $2::date AND $3::date
          AND ($4::text IS NULL OR status = $4)
          AND ($5::date IS NULL OR (recognition_on, id) > ($5::date, $6::uuid))
          AND ($8::text IS NULL OR kind=$8)
        ORDER BY recognition_on, id LIMIT $7
      `, [query.companyId,query.from,query.to,query.status ?? null,cursor?.date ?? null,cursor?.id ?? null,query.limit+1,query.kind ?? null]);
      const more=result.rows.length>query.limit;
      const items=result.rows.slice(0,query.limit).map((row)=>transactionSchema.parse({
        id:row.id,companyId:row.company_id,periodId:row.period_id,sourceDocumentId:row.source_document_id,
        ...(row.counterparty_id ? {counterpartyId:row.counterparty_id}:{}),externalRef:row.external_ref,kind:row.kind,
        occurredOn:row.occurred_on,recognitionOn:row.recognition_on,currency:row.currency,origin:row.origin,
        net:row.net_amount,tax:row.tax_amount,gross:row.gross_amount,status:row.status,idempotencyKey:row.idempotency_key,
      }));
      const last=items.at(-1);
      const nextCursor=more&&last ? Buffer.from(JSON.stringify({companyId:query.companyId,from:query.from,to:query.to,
        status:query.status ?? null,kind:query.kind ?? null,date:last.recognitionOn,id:last.id})).toString('base64url'):null;
      return {items,nextCursor};
    },'business_transactions');
  }
  protected async withScope<T>(companyId: string,scope: 'erp:read'|'erp:write',action: (client: pg.PoolClient)=>Promise<T>,readResource?: string): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE authenticated');
      await client.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [this.authenticatedUserId]);
      const traceId=randomUUID();
      await client.query("SELECT set_config('ledgerflow.trace_id',$1,true)",[traceId]);
      const permission = await client.query<{ allowed: boolean }>(
        "SELECT private.has_company_scope($1::uuid,$2) AS allowed", [companyId,scope],
      );
      if (!permission.rows[0]?.allowed) throw new DomainError('FORBIDDEN', '이 회사의 ERP 권한이 없습니다.');
      const result=await action(client);
      if(readResource) await client.query('SELECT public.record_erp_read($1,$2,$3)',[companyId,readResource,traceId]);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release(); // SET LOCAL identity and role disappear at transaction end.
    }
  }
}
