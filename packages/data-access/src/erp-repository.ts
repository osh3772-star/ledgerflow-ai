import { createHash } from 'node:crypto';
import { z } from 'zod';
import { DomainError, dateSchema, uuidSchema, invoiceSchema, bankTransactionSchema, inventoryPositionSchema,
  counterpartySchema, createTransactionResultSchema, type ErpRepository, type InvoiceQuery, type BankQuery,
  type InventoryQuery, type CounterpartyQuery, type CreateTransactionInput, type Page } from '@ledgerflow/contracts';
import { PostgresTransactionReader } from './transaction-reader.js';

const cursorSchema=z.strictObject({v:z.literal(1),resource:z.enum(['invoices','bank_transactions','inventory','counterparties']),
  filters:z.string().regex(/^[a-f0-9]{64}$/u),date:dateSchema.nullable(),id:uuidSchema});
function filterHash(query: Record<string,unknown>) {
  const {limit:_,cursor:__,...filters}=query;
  const sorted=Object.fromEntries(Object.keys(filters).sort().map((key)=>[key,filters[key]]));
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}
function decode(query: {cursor?:string|undefined}&Record<string,unknown>,resource:z.output<typeof cursorSchema>['resource']) {
  if(!query.cursor)return null;
  try {
    if(!/^[A-Za-z0-9_-]+$/u.test(query.cursor))throw new Error();
    const row=cursorSchema.parse(JSON.parse(Buffer.from(query.cursor,'base64url').toString('utf8')));
    if(row.resource!==resource||row.filters!==filterHash(query))throw new Error();
    if(['invoices','bank_transactions'].includes(resource)){
      if(!row.date||row.date<String(query.from)||row.date>String(query.to))throw new Error();
    }else if(row.date!==null)throw new Error();
    return row;
  }catch{throw new DomainError('INVALID_CURSOR','현재 회사·조회 조건에 맞는 cursor가 필요합니다.');}
}
function paged<T>(query: {limit:number}&Record<string,unknown>,resource:z.output<typeof cursorSchema>['resource'],
  rows: {id:string;date:string|null;item:T}[]):Page<T>{
  const page=rows.slice(0,query.limit),last=page.at(-1);
  const nextCursor=rows.length>query.limit&&last?Buffer.from(JSON.stringify({v:1,resource,filters:filterHash(query),date:last.date,id:last.id})).toString('base64url'):null;
  return {items:page.map((row)=>row.item),nextCursor};
}
function mapped<T>(schema:{safeParse(input:unknown):{success:boolean;data?:T}},input:unknown):T{
  const result=schema.safeParse(input);
  if(!result.success)throw new DomainError('DATA_INTEGRITY','저장된 ERP 자료의 출력 계약을 확인하세요.');
  return result.data!;
}
function writeError(error:unknown):never{
  if(error instanceof DomainError)throw error;
  const record=error as {code?:string;message?:string};
  const codes:Record<string,string>={FORBIDDEN:'FORBIDDEN',INVALID_INPUT:'INVALID_INPUT',IDEMPOTENCY_CONFLICT:'IDEMPOTENCY_CONFLICT',
    REFERENCE_INVALID:'REFERENCE_INVALID',PERIOD_CLOSED:'PERIOD_CLOSED',DOCUMENT_CONFLICT:'DOCUMENT_CONFLICT'};
  if(record.message && codes[record.message])throw new DomainError(codes[record.message]!,record.message);
  if(record.code==='23505')throw new DomainError('DUPLICATE_SOURCE','외부 거래 참조 또는 증빙이 중복됩니다.');
  if(record.code==='23503')throw new DomainError('REFERENCE_INVALID','같은 회사의 유효한 참조가 필요합니다.');
  if(['22P02','22007','22008','22003','23514'].includes(record.code??''))throw new DomainError('INVALID_INPUT','거래 입력 조건을 확인하세요.');
  if(record.code==='42501')throw new DomainError('FORBIDDEN','거래 생성 권한이 없습니다.');
  if(['40001','40P01','55P03','57014'].includes(record.code??''))throw new DomainError('RETRYABLE_CONFLICT','동일 멱등성 키로 전체 요청을 다시 시도하세요.');
  throw new DomainError('DATABASE_ERROR','ERP 저장 요청을 완료하지 못했습니다.');
}

export class PostgresErpRepository extends PostgresTransactionReader implements ErpRepository{
  async getInvoices(query:InvoiceQuery){
    const cursor=decode(query,'invoices');
    return this.withScope(query.companyId,'erp:read',async(client)=>{
      const rows=await client.query<{id:string;date:string;item:unknown}>(`
        SELECT i.id,i.issue_date::text AS date,jsonb_build_object('id',i.id,'companyId',i.company_id,'origin',i.origin,
          'transactionId',i.transaction_id,'sourceDocumentId',i.source_document_id,'counterpartyId',i.counterparty_id,
          'direction',CASE WHEN i.direction='sale' THEN 'sales' ELSE 'purchase' END,'number',i.number,'issueDate',i.issue_date::text,
          'net',i.net_amount::text,'tax',i.tax_amount::text,'gross',i.gross_amount::text,'governmentIssued',i.government_issued,
          'evidenceSha256',d.sha256,'lines',coalesce(lines.items,'[]'::jsonb)) AS item
        FROM public.invoices i JOIN public.source_documents d ON d.company_id=i.company_id AND d.id=i.source_document_id
        LEFT JOIN LATERAL(
          SELECT jsonb_agg(jsonb_build_object('id',l.id,'companyId',l.company_id,'origin',l.origin,'invoiceId',l.invoice_id,
            'productId',l.product_id,'description',l.description,'quantity',l.quantity::text,'unitPrice',l.unit_price::text,'net',l.net_amount::text) ORDER BY l.id) AS items
          FROM (SELECT * FROM public.invoice_lines WHERE company_id=i.company_id AND invoice_id=i.id ORDER BY id LIMIT 201) l
        ) lines ON true
        WHERE i.company_id=$1 AND i.issue_date BETWEEN $2::date AND $3::date
          AND ($4::text IS NULL OR i.direction=$4) AND ($5::uuid IS NULL OR i.transaction_id=$5)
          AND ($6::date IS NULL OR (i.issue_date,i.id)>($6::date,$7::uuid))
        ORDER BY i.issue_date,i.id LIMIT $8
      `,[query.companyId,query.from,query.to,query.direction==='sales'?'sale':query.direction??null,query.transactionId??null,cursor?.date??null,cursor?.id??null,query.limit+1]);
      return paged(query,'invoices',rows.rows.map((row)=>({...row,item:mapped(invoiceSchema,row.item)})));
    },'invoices');
  }
  async getBankTransactions(query:BankQuery){
    const cursor=decode(query,'bank_transactions');
    return this.withScope(query.companyId,'erp:read',async(client)=>{
      const rows=await client.query<{id:string;date:string;item:unknown}>(`
        SELECT b.id,b.booked_on::text AS date,jsonb_build_object('id',b.id,'companyId',b.company_id,'origin',b.origin,
          'transactionId',b.transaction_id,'bankAccountId',b.bank_account_id,'bookedOn',b.booked_on::text,'direction',b.direction,
          'amount',b.amount::text,'currency',b.currency,'erpAllocatedAmount',a.amount::text,'erpUnallocatedAmount',(b.amount-a.amount)::text) AS item
        FROM public.bank_transactions b
        LEFT JOIN LATERAL(SELECT coalesce(sum(amount),0) AS amount FROM public.settlement_allocations WHERE company_id=b.company_id AND bank_transaction_id=b.id) a ON true
        WHERE b.company_id=$1 AND b.booked_on BETWEEN $2::date AND $3::date AND ($4::uuid IS NULL OR b.bank_account_id=$4)
          AND (NOT $5::boolean OR b.amount>a.amount)
          AND ($6::date IS NULL OR (b.booked_on,b.id)>($6::date,$7::uuid))
        ORDER BY b.booked_on,b.id LIMIT $8
      `,[query.companyId,query.from,query.to,query.bankAccountId??null,query.unmatchedOnly,cursor?.date??null,cursor?.id??null,query.limit+1]);
      return paged(query,'bank_transactions',rows.rows.map((row)=>({...row,item:mapped(bankTransactionSchema,row.item)})));
    },'bank_transactions');
  }
  async getInventory(query:InventoryQuery){
    const cursor=decode(query,'inventory');
    return this.withScope(query.companyId,'erp:read',async(client)=>{
      const rows=await client.query<{id:string;item:unknown}>(`
        SELECT p.id,jsonb_build_object('companyId',p.company_id,'origin',p.origin,'productId',p.id,'sku',p.sku,'asOf',$2::date::text,
          'quantity',coalesce(m.quantity,0)::text,'movementCount',coalesce(m.count,0),
          'carryingAmount',CASE WHEN coalesce(m.quantity,0)>=0 AND coalesce(m.cost_count,0)<=1 AND (m.unit_cost IS NULL OR m.unit_cost=p.unit_cost)
            THEN coalesce(m.amount,0)::text ELSE NULL END,
          'costStatus',CASE WHEN coalesce(m.quantity,0)>=0 AND coalesce(m.cost_count,0)<=1 AND (m.unit_cost IS NULL OR m.unit_cost=p.unit_cost)
            THEN 'source_estimate' ELSE 'pending' END,
          'costPolicyVersion',CASE WHEN coalesce(m.quantity,0)>=0 AND coalesce(m.cost_count,0)<=1 AND (m.unit_cost IS NULL OR m.unit_cost=p.unit_cost)
            THEN 'synthetic-constant-unit-cost-v1' ELSE NULL END) AS item
        FROM public.products p LEFT JOIN LATERAL(
          SELECT sum(CASE WHEN direction='in' THEN quantity ELSE -quantity END) AS quantity,
            sum(CASE WHEN direction='in' THEN quantity*unit_cost ELSE -quantity*unit_cost END) AS amount,
            count(*)::int AS count,count(DISTINCT unit_cost)::int AS cost_count,min(unit_cost) AS unit_cost
          FROM public.inventory_movements WHERE company_id=p.company_id AND product_id=p.id AND occurred_on<=$2::date
        ) m ON true WHERE p.company_id=$1 AND ($3::uuid IS NULL OR p.id=$3) AND ($4::uuid IS NULL OR p.id>$4)
        ORDER BY p.id LIMIT $5
      `,[query.companyId,query.asOf,query.productId??null,cursor?.id??null,query.limit+1]);
      return paged(query,'inventory',rows.rows.map((row)=>({...row,date:null,item:mapped(inventoryPositionSchema,row.item)})));
    },'inventory');
  }
  async getCounterparties(query:CounterpartyQuery){
    const cursor=decode(query,'counterparties');
    return this.withScope(query.companyId,'erp:read',async(client)=>{
      const rows=await client.query<{id:string;item:unknown}>(`
        SELECT id,jsonb_build_object('id',id,'companyId',company_id,'origin',origin,'name',name,'role',role,'businessNoMasked',NULL) AS item
        FROM public.counterparties WHERE company_id=$1 AND strpos(lower(name),lower($2::text))>0 AND ($3::uuid IS NULL OR id>$3)
        ORDER BY id LIMIT $4
      `,[query.companyId,query.query,cursor?.id??null,query.limit+1]);
      return paged(query,'counterparties',rows.rows.map((row)=>({...row,date:null,item:mapped(counterpartySchema,row.item)})));
    },'counterparties');
  }
  async createTransaction(input:CreateTransactionInput){
    try{return await this.withScope(input.companyId,'erp:write',async(client)=>{
      const result=await client.query<{result:unknown}>('SELECT public.create_erp_transaction($1::jsonb) AS result',[JSON.stringify(input)]);
      return mapped(createTransactionResultSchema,result.rows[0]!.result);
    });}catch(error){writeError(error);}
  }
}
