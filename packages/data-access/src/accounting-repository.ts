import {DomainError,transactionSchema,journalSchema,journalPayloadSchema,uuidSchema,dateSchema,type JournalPayload} from '@ledgerflow/contracts';
import {z} from 'zod';
import type {SourceSnapshot} from '@ledgerflow/accounting-core';
import {PostgresTransactionReader} from './transaction-reader.js';

export class PostgresAccountingRepository extends PostgresTransactionReader{
  async learningSale(companyId:string,from:string,to:string){
    return this.withScope(companyId,'erp:read',async c=>{
      const row=(await c.query(`SELECT t.id FROM public.business_transactions t
        WHERE t.company_id=$1 AND t.kind='sale' AND t.recognition_on BETWEEN $2::date AND $3::date
          AND NOT EXISTS(SELECT 1 FROM public.journal_entries p WHERE p.company_id=t.company_id AND p.transaction_id=t.id AND p.entry_type='source' AND (p.state='Posted' OR p.discarded_at IS NULL))
        ORDER BY t.recognition_on,t.id LIMIT 1`,[companyId,from,to])).rows[0];
      if(!row)throw new DomainError('NO_UNPROCESSED_SALE','이 기간에 미전기 매출이 없습니다.');
      return {transactionId:String(row.id)};
    });
  }
  async recordPreparation(companyId:string,client:string,result:{taskId:string}){
    return this.withScope(companyId,'erp:read',async c=>{
      if(!(await c.query("SELECT private.has_company_scope($1,'accounting:write') allowed",[companyId])).rows[0].allowed)throw new DomainError('FORBIDDEN','준비 결과 기록 권한이 없습니다.');
      await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',['learning-result/'+companyId+'/'+client+'/'+result.taskId]);
      const existing=(await c.query(`SELECT r.id AS "runId",t.id AS "taskId" FROM public.agent_tasks t
        JOIN public.agent_runs r ON r.company_id=t.company_id AND r.id=t.run_id
        WHERE t.company_id=$1 AND t.task_key=$2 AND r.client=$3 AND r.created_by=auth.uid() LIMIT 1`,[companyId,result.taskId,client])).rows[0];
      if(existing)return {...existing,recorded:true};
      return (await c.query('SELECT public.record_agent_result($1,$2,NULL,$3::jsonb) AS result',[companyId,client,JSON.stringify(result)])).rows[0].result;
    });
  }
  async source(companyId:string,transactionId:string):Promise<SourceSnapshot>{
    return this.withScope(companyId,'erp:read',async c=>{
      const row=(await c.query('SELECT t.*,occurred_on::text AS occurred_text,recognition_on::text AS recognition_text FROM public.business_transactions t WHERE company_id=$1 AND id=$2',[companyId,transactionId])).rows[0];
      if(!row)throw new DomainError('NOT_FOUND','거래가 없습니다.');
      const money=(n:unknown)=>String(n).replace(/\.0+$/u,'');
      const transaction=transactionSchema.parse({id:row.id,companyId:row.company_id,periodId:row.period_id,sourceDocumentId:row.source_document_id,
        ...(row.counterparty_id?{counterpartyId:row.counterparty_id}:{}),externalRef:row.external_ref,kind:row.kind,
        occurredOn:row.occurred_text,recognitionOn:row.recognition_text,currency:row.currency,
        origin:row.origin,net:money(row.net_amount),tax:money(row.tax_amount),gross:money(row.gross_amount),status:row.status,idempotencyKey:row.idempotency_key});
      const document=(await c.query('SELECT content FROM public.source_documents WHERE company_id=$1 AND id=$2',[companyId,row.source_document_id])).rows[0]!.content as Record<string,unknown>;
      const documents=(await c.query('SELECT r.document_id,d.sha256 FROM public.transaction_documents r JOIN public.source_documents d ON d.company_id=r.company_id AND d.id=r.document_id WHERE r.company_id=$1 AND r.transaction_id=$2 ORDER BY position',[companyId,transactionId])).rows;
      const period=(await c.query('SELECT id,start_date::text AS "from",end_date::text AS "to",status FROM public.fiscal_periods WHERE company_id=$1 AND id=$2',[companyId,row.period_id])).rows[0]!;
      const accounts=(await c.query('SELECT code,kind,normal_side AS "normalSide",active,valid_from::text AS "validFrom",valid_to::text AS "validTo" FROM public.accounts WHERE company_id=$1 ORDER BY code',[companyId])).rows;
      const source:SourceSnapshot={transaction,document,documentIds:documents.map(r=>r.document_id),documentHashes:documents.map(r=>({documentId:r.document_id,sha256:r.sha256})),period,accounts};
      const invoice=(await c.query('SELECT net_amount::text AS net,tax_amount::text AS tax,gross_amount::text AS gross FROM public.invoices WHERE company_id=$1 AND transaction_id=$2',[companyId,transactionId])).rows[0];
      if(invoice)source.invoice=invoice;
      const contract=(await c.query('SELECT delivered_on::text AS "deliveredOn",performance_obligations AS "performanceObligations" FROM public.sales_contracts WHERE company_id=$1 AND transaction_id=$2',[companyId,transactionId])).rows[0];
      if(contract)source.contract=contract;
      const inventory=(await c.query("SELECT sum(quantity)::text AS quantity,min(unit_cost)::text AS \"unitCost\",count(DISTINCT unit_cost)::int AS costs FROM public.inventory_movements WHERE company_id=$1 AND transaction_id=$2 AND direction='out'",[companyId,transactionId])).rows[0];
      if(inventory?.quantity&&inventory.costs===1)source.inventory={quantity:inventory.quantity,unitCost:inventory.unitCost};
      const payroll=(await c.query('SELECT gross::text,withholding::text,net_pay::text AS "netPay" FROM public.payrolls WHERE company_id=$1 AND transaction_id=$2',[companyId,transactionId])).rows[0];
      if(payroll)source.payroll=payroll;
      const adjustment=(await c.query('SELECT type,asset_id AS "assetId",prepayment_id AS "prepaymentId",amount::text FROM public.adjustment_proposals WHERE company_id=$1 AND transaction_id=$2',[companyId,transactionId])).rows[0];
      if(adjustment)source.adjustment=adjustment;
      const asset=(await c.query('SELECT id,available_on::text AS "availableOn",cost::text,residual::text,useful_life_months AS "usefulLifeMonths" FROM public.fixed_assets WHERE company_id=$1 AND (transaction_id=$2 OR id=$3)',[companyId,transactionId,adjustment?.assetId??null])).rows[0];
      if(asset)source.asset=asset;
      const prepayment=(await c.query('SELECT id,coverage_start::text AS "coverageStart",coverage_end::text AS "coverageEnd",cost::text,monthly_expense::text AS "monthlyExpense" FROM public.prepayments WHERE company_id=$1 AND (transaction_id=$2 OR id=$3)',[companyId,transactionId,adjustment?.prepaymentId??null])).rows[0];
      if(prepayment)source.prepayment=prepayment;
      return source;
    });
  }
  async sourceDocuments(companyId:string,transactionId:string){
    return this.withScope(companyId,'erp:read',async c=>(await c.query(
      'SELECT d.id,d.document_type AS type,d.issue_date::text AS "issueDate",d.origin,d.content,d.sha256,d.storage_path AS "storagePath" FROM public.transaction_documents r JOIN public.source_documents d ON d.company_id=r.company_id AND d.id=r.document_id WHERE r.company_id=$1 AND r.transaction_id=$2 ORDER BY r.position',[companyId,transactionId])).rows);
  }
  async command(companyId:string,command:string,input:Record<string,unknown>){
    try{return await this.withScope(companyId,'erp:read',async c=>{
      const result=(await c.query('SELECT public.accounting_command($1,$2,$3::jsonb) AS result',[companyId,command,JSON.stringify(input)])).rows[0]!.result;
      return command==='close'?result:journalSchema.parse(result);
    });}catch(error){
      if(error instanceof DomainError)throw error;
      const code=(error as {message?:string}).message;
      const allowed=['FORBIDDEN','NOT_FOUND','PERIOD_CLOSED','PERIOD_MISMATCH','HASH_MISMATCH','EVIDENCE_MISMATCH','ACCOUNT_INVALID',
        'UNBALANCED','LINE_INVALID','TRANSACTION_MISMATCH','DUPLICATE_POSTING','APPROVAL_REQUIRED','APPROVAL_INVALID','INVALID_STATE',
        'IDEMPOTENCY_CONFLICT','CLOSE_INCOMPLETE','REVERSAL_INVALID','DECISION_IMMUTABLE','LINE_PAYLOAD_MISMATCH','JOURNAL_DISCARDED'];
      throw new DomainError(allowed.includes(code??'')?code!:'ACCOUNTING_DATABASE_ERROR','회계 처리 조건을 확인하세요.');
    }
  }
  async save(companyId:string,payload:JournalPayload,idempotencyKey:string){return this.command(companyId,'save',{payload:journalPayloadSchema.parse(payload),idempotencyKey});}
  async journal(companyId:string,id:string){
    return this.withScope(companyId,'erp:read',async c=>{
      const j=(await c.query('SELECT * FROM public.journal_entries WHERE company_id=$1 AND id=$2',[companyId,id])).rows[0];
      if(!j)throw new DomainError('NOT_FOUND','전표가 없습니다.');
      return journalSchema.parse({id:j.id,companyId:j.company_id,payload:j.payload,hash:j.content_hash,version:j.version,state:j.state,idempotencyKey:j.idempotency_key,postedAt:j.posted_at?.toISOString()??null,
        discardedAt:j.discarded_at?.toISOString()??null,discardReason:j.discard_reason});
    });
  }
  async byKey(companyId:string,key:string){
    return this.withScope(companyId,'erp:read',async c=>{
      const row=(await c.query('SELECT id,transaction_id FROM public.journal_entries WHERE company_id=$1 AND idempotency_key=$2',[companyId,key])).rows[0];
      return row?{id:String(row.id),transactionId:String(row.transaction_id)}:null;
    });
  }
  async list(companyId:string,state:string|undefined,limit:number,after?:string){
    return this.withScope(companyId,'erp:read',async c=>(await c.query(
      "SELECT id,state,discarded_at AS \"discardedAt\",recognition_on::text AS \"recognitionOn\",content_hash AS hash,payload->>'description' AS description FROM public.journal_entries WHERE company_id=$1 AND ($2::text IS NULL OR state=$2) AND ($4::uuid IS NULL OR id>$4) ORDER BY id LIMIT $3",
      [companyId,state??null,limit,after??null])).rows);
  }
  async approval(companyId:string,journalId:string){
    return this.withScope(companyId,'erp:read',async c=>(await c.query('SELECT id,journal_id AS "journalId",version,content_hash AS hash,status,decided_at AS "decidedAt" FROM public.approval_requests WHERE company_id=$1 AND journal_id=$2 ORDER BY version DESC',[companyId,journalId])).rows[0]??null);
  }
  async ledger(companyId:string,from:string,to:string){
    return this.withScope(companyId,'erp:read',async c=>(await c.query(
      "SELECT j.id AS \"journalId\",j.recognition_on::text AS date,j.entry_type AS \"entryType\",a.code AS \"accountCode\",a.name,a.kind,a.normal_side AS \"normalSide\",l.debit::text,l.credit::text FROM public.journal_entries j JOIN public.journal_lines l ON l.company_id=j.company_id AND l.journal_id=j.id JOIN public.accounts a ON a.company_id=l.company_id AND a.id=l.account_id WHERE j.company_id=$1 AND j.state='Posted' AND j.recognition_on BETWEEN $2::date AND $3::date ORDER BY j.recognition_on,j.id,l.line_no",
      [companyId,from,to])).rows);
  }
  async period(companyId:string,id:string){
    return this.withScope(companyId,'erp:read',async c=>{
      const p=(await c.query('SELECT id,start_date::text AS "from",end_date::text AS "to",status FROM public.fiscal_periods WHERE company_id=$1 AND id=$2',[companyId,id])).rows[0];
      if(!p)throw new DomainError('NOT_FOUND','기간이 없습니다.');return p;
    });
  }
  async periodForDate(companyId:string,date:string){return this.withScope(companyId,'erp:read',async c=>(await c.query(
    'SELECT id,start_date::text AS "from",end_date::text AS "to",status FROM public.fiscal_periods WHERE company_id=$1 AND $2::date BETWEEN start_date AND end_date',[companyId,date])).rows[0]);}
  async schedules(companyId:string,asOf:string){
    return this.withScope(companyId,'erp:read',async c=>({
      assets:(await c.query('SELECT id,transaction_id AS "transactionId",available_on::text AS "availableOn",cost::text,residual::text,useful_life_months AS months FROM public.fixed_assets WHERE company_id=$1 AND available_on<=$2::date ORDER BY id',[companyId,asOf])).rows,
      prepayments:(await c.query('SELECT id,transaction_id AS "transactionId",coverage_start::text AS "from",coverage_end::text AS "to",cost::text,monthly_expense::text AS amount FROM public.prepayments WHERE company_id=$1 AND coverage_start<=$2::date AND coverage_end>=$2::date ORDER BY id',[companyId,asOf])).rows,
      charges:(await c.query("SELECT payload->'calculation'->>'referenceId' AS reference,payload->'calculation'->>'type' AS type,recognition_on::text AS date,((payload->'lines'->0->>'debit')::numeric-(payload->'lines'->0->>'credit')::numeric)::text AS amount FROM public.journal_entries WHERE company_id=$1 AND state='Posted' AND recognition_on<=$2::date AND payload ? 'calculation'",[companyId,asOf])).rows,
    }));
  }
  async audit(companyId:string,from:string,to:string){
    return this.withScope(companyId,'erp:read',async c=>({
      duplicateEvidence:(await c.query('SELECT d.sha256,count(*)::int AS count FROM public.source_documents d WHERE d.company_id=$1 AND d.issue_date BETWEEN $2::date AND $3::date GROUP BY d.sha256 HAVING count(*)>1',[companyId,from,to])).rows,
      unbalancedJournals:(await c.query("SELECT j.id FROM public.journal_entries j JOIN public.journal_lines l ON l.company_id=j.company_id AND l.journal_id=j.id WHERE j.company_id=$1 AND j.state='Posted' AND j.recognition_on BETWEEN $2::date AND $3::date GROUP BY j.id HAVING sum(l.debit)<>sum(l.credit)",[companyId,from,to])).rows,
      unpostedSources:(await c.query("SELECT t.id,t.external_ref AS reference,t.kind FROM public.business_transactions t WHERE t.company_id=$1 AND t.recognition_on BETWEEN $2::date AND $3::date AND NOT EXISTS(SELECT 1 FROM public.journal_entries j WHERE j.company_id=t.company_id AND j.transaction_id=t.id AND j.entry_type='source' AND j.state='Posted') ORDER BY t.recognition_on,t.id LIMIT 100",[companyId,from,to])).rows,
      missingEvidence:(await c.query(
        "SELECT t.id,t.external_ref AS reference FROM public.business_transactions t WHERE t.company_id=$1 AND t.recognition_on BETWEEN $2::date AND $3::date AND (NOT EXISTS(SELECT 1 FROM public.transaction_documents d WHERE d.company_id=t.company_id AND d.transaction_id=t.id) OR (t.kind IN ('sale','purchase','asset_acquisition') AND NOT EXISTS(SELECT 1 FROM public.invoices i WHERE i.company_id=t.company_id AND i.transaction_id=t.id)) OR (t.kind='sale' AND NOT EXISTS(SELECT 1 FROM public.sales_contracts s WHERE s.company_id=t.company_id AND s.transaction_id=t.id AND s.delivered_on=t.recognition_on))) ORDER BY t.id LIMIT 100",[companyId,from,to])).rows,
      periodErrors:(await c.query(
        'SELECT t.id,t.external_ref AS reference FROM public.business_transactions t JOIN public.fiscal_periods p ON p.company_id=t.company_id AND p.id=t.period_id WHERE t.company_id=$1 AND t.recognition_on BETWEEN $2::date AND $3::date AND t.recognition_on NOT BETWEEN p.start_date AND p.end_date LIMIT 100',[companyId,from,to])).rows,
      note:'미처리 거래는 감사 오류 확정이 아니라 업무 누락 후보입니다. 최대 100개 표시.',
    }));
  }
  async pending(q:{companyId:string;from:string;to:string;limit:number;cursor?:string|undefined;kind?:string|undefined}){
    let cursor:{date:string;id:string}|undefined;
    if(q.cursor)try{
      const c=z.strictObject({v:z.literal('ledger-pending-v1'),companyId:uuidSchema,from:dateSchema,to:dateSchema,
        kind:z.string().nullable(),date:dateSchema,id:uuidSchema}).parse(JSON.parse(Buffer.from(q.cursor,'base64url').toString('utf8')));
      if(c.companyId!==q.companyId||c.from!==q.from||c.to!==q.to||c.kind!==(q.kind??null))throw new Error();
      cursor=c;
    }catch{throw new DomainError('INVALID_CURSOR','현재 미전기 조회 조건에 맞는 cursor가 필요합니다.');}
    return this.withScope(q.companyId,'erp:read',async c=>{
      const rows=(await c.query("SELECT t.*,occurred_on::text AS occurred_text,recognition_on::text AS recognition_text FROM public.business_transactions t WHERE t.company_id=$1 AND t.recognition_on BETWEEN $2::date AND $3::date AND ($4::text IS NULL OR t.kind=$4) AND ($5::date IS NULL OR (t.recognition_on,t.id)>($5::date,$6::uuid)) AND NOT EXISTS(SELECT 1 FROM public.journal_entries j WHERE j.company_id=t.company_id AND j.transaction_id=t.id AND j.entry_type='source' AND j.state='Posted') ORDER BY t.recognition_on,t.id LIMIT $7",[q.companyId,q.from,q.to,q.kind??null,cursor?.date??null,cursor?.id??null,q.limit+1])).rows;
      const items=rows.slice(0,q.limit).map(row=>transactionSchema.parse({id:row.id,companyId:row.company_id,periodId:row.period_id,sourceDocumentId:row.source_document_id,
        ...(row.counterparty_id?{counterpartyId:row.counterparty_id}:{}),externalRef:row.external_ref,kind:row.kind,occurredOn:row.occurred_text,recognitionOn:row.recognition_text,currency:row.currency,
        origin:row.origin,net:row.net_amount,tax:row.tax_amount,gross:row.gross_amount,status:row.status,idempotencyKey:row.idempotency_key}));
      const last=items.at(-1);
      return {items,nextCursor:rows.length>q.limit&&last?Buffer.from(JSON.stringify({v:'ledger-pending-v1',companyId:q.companyId,from:q.from,to:q.to,kind:q.kind??null,date:last.recognitionOn,id:last.id})).toString('base64url'):null};
    });
  }
  async recordResult(companyId:string,client:string,runId:string|undefined,result:unknown){
    return this.withScope(companyId,'erp:read',async c=>(await c.query('SELECT public.record_agent_result($1,$2,$3,$4::jsonb) AS result',[companyId,client,runId??null,JSON.stringify(result)])).rows[0]!.result);
  }
  async reconciliation(companyId:string,from:string,to:string){
    return this.withScope(companyId,'erp:read',async c=>({
      asOf:to,origin:'synthetic_erp',bank:(await c.query(
        "SELECT b.id,b.transaction_id AS \"transactionId\",b.booked_on::text AS date,b.direction,b.amount::text,j.id AS \"postedJournalId\",m.id AS \"matchId\",EXISTS(SELECT 1 FROM public.journal_entries r WHERE r.reversal_of=j.id AND r.state='Posted') AS reversed FROM public.bank_transactions b LEFT JOIN public.journal_entries j ON j.company_id=b.company_id AND j.transaction_id=b.transaction_id AND j.entry_type='source' AND j.state='Posted' LEFT JOIN public.reconciliation_matches m ON m.company_id=b.company_id AND m.bank_transaction_id=b.id AND m.journal_id=j.id WHERE b.company_id=$1 AND b.booked_on BETWEEN $2::date AND $3::date ORDER BY b.booked_on,b.id LIMIT 100",[companyId,from,to])).rows,
      cash:(await c.query(
        "SELECT (SELECT coalesce(sum(CASE WHEN direction='in' THEN amount ELSE -amount END),0)::text FROM public.bank_transactions WHERE company_id=$1 AND booked_on<=$2::date) AS \"bankNetMovement\",(SELECT coalesce(sum(l.debit-l.credit),0)::text FROM public.journal_lines l JOIN public.journal_entries j ON j.company_id=l.company_id AND j.id=l.journal_id JOIN public.accounts a ON a.company_id=l.company_id AND a.id=l.account_id WHERE j.company_id=$1 AND j.state='Posted' AND j.recognition_on<=$2::date AND a.code='1010') AS \"ledgerCashBalance\"",[companyId,to])).rows[0],
      invoiceBalances:(await c.query(
        "SELECT i.id,i.direction,i.gross_amount::text AS gross,coalesce(sum(s.amount),0)::text AS allocated,(i.gross_amount-coalesce(sum(s.amount),0))::text AS outstanding FROM public.invoices i LEFT JOIN public.settlement_allocations s ON s.company_id=i.company_id AND s.invoice_id=i.id AND EXISTS(SELECT 1 FROM public.bank_transactions b WHERE b.id=s.bank_transaction_id AND b.booked_on<=$2::date) WHERE i.company_id=$1 AND i.issue_date<=$2::date GROUP BY i.id ORDER BY i.issue_date,i.id LIMIT 100",[companyId,to])).rows,
      notes:['은행·세금계산서 ERP와 게시 장부를 별도 표시','미전기/역분개/기간 차이는 검토 대상','은행·세금계산서 각 최대 100건; cash는 전체 누적','단일 현금 계정 1010 가정; 실제 은행 명세서 외부 연동 없음'],
    }));
  }
  async matchBank(companyId:string,bankId:string,journalId:string){
    try{return await this.withScope(companyId,'erp:read',async c=>(await c.query('SELECT public.match_bank_journal($1,$2,$3) AS result',[companyId,bankId,journalId])).rows[0]!.result);}
    catch(error){if(error instanceof DomainError)throw error;throw new DomainError('RECONCILIATION_MISMATCH','게시 현금 전표와 은행 원천 거래를 확인하세요.');}
  }
  async archiveEvidence(companyId:string,documentId:string,sha256:string,bytes:number){
    return this.withScope(companyId,'erp:write',async c=>(await c.query('SELECT public.record_evidence_object($1,$2,$3,$4) AS result',[companyId,documentId,sha256,bytes])).rows[0]!.result);
  }
  async checkEvidenceWrite(companyId:string){return this.withScope(companyId,'erp:write',async()=>true);}
}
