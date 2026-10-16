import type {Pool} from 'pg';
import {DomainError} from '@ledgerflow/contracts';

export const DATABASE_TABLES=['companies','fiscal_periods','accounts','principals','principal_scopes','company_memberships',
  'business_transactions','source_documents','transaction_documents','invoices','bank_transactions',
  'inventory_movements','journal_entries','journal_lines','approval_requests','agent_runs','agent_tasks',
  'mcp_tool_calls','external_api_cache','reconciliation_matches','evidence_objects'];
export const DATABASE_PROCEDURES=['public.accounting_command(uuid,text,jsonb)','public.record_agent_result(uuid,text,uuid,jsonb)',
  'public.match_bank_journal(uuid,uuid,uuid)','public.record_evidence_object(uuid,uuid,text,integer)'];

// Read-only startup gate. Never migrate, seed or grant privileges on an existing DB.
export async function assertDatabaseReady(pool:Pool){
  const result=await pool.query<{ready:boolean}>(
    "SELECT NOT EXISTS(SELECT 1 FROM unnest($1::text[]) name WHERE to_regclass('public.'||name) IS NULL) AND NOT EXISTS(SELECT 1 FROM unnest($2::text[]) signature WHERE to_regprocedure(signature) IS NULL) AND EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=to_regclass('public.journal_entries') AND attname='discarded_at' AND NOT attisdropped) AS ready",
    [DATABASE_TABLES,DATABASE_PROCEDURES]);
  if(!result.rows[0]?.ready)throw new DomainError('DATABASE_SCHEMA_INCOMPLETE','개발 DB에 LedgerFlow migration 001~005를 먼저 적용하세요. 서버는 기존 DB를 자동 변경하지 않습니다.');
}
