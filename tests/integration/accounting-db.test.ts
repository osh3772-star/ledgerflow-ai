import {afterAll,beforeAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {generateFullErpSeed} from '@ledgerflow/test-data';
import {PostgresAccountingRepository} from '@ledgerflow/data-access';
import {AccountingService} from '@ledgerflow/application-services';
import {startLocalPostgres} from '../../scripts/local-postgres.js';
import {seedFullDatabase} from '../../scripts/seed-full-database.js';

describe('deterministic human approved ledger on actual PostgreSQL',()=>{
  const seed=generateFullErpSeed(),company=seed.companies[0]!.id,viewer=seed.identities.find(i=>i.companyId===company&&i.role==='viewer')!;
  const human=seed.identities.find(i=>i.companyId===company&&i.role==='preparer')!;
  let db:Awaited<ReturnType<typeof startLocalPostgres>>,service:AccountingService,approver:AccountingService;
  beforeAll(async()=>{
    db=await startLocalPostgres();await seedFullDatabase(db.pool,seed);
    await db.pool.query('INSERT INTO public.principal_scopes(company_id,principal_id,scope) VALUES($1,$2,$3),($1,$4,$5),($1,$4,$6)',[company,viewer.principalId,'accounting:write',human.principalId,'accounting:approve','accounting:close']);
    service=new AccountingService(new PostgresAccountingRepository(db.pool,viewer.userId));
    approver=new AccountingService(new PostgresAccountingRepository(db.pool,human.userId));
  });
  afterAll(async()=>{if(db)await db.stop();});
  const propose=async(ref:string,key=ref)=>{
    const transaction=seed.transactions.find(t=>t.externalRef===ref)!;
    return service.propose({companyId:company,transactionId:transaction.id,idempotencyKey:key});
  };
  const approveAndPost=async(j:Awaited<ReturnType<typeof propose>>)=>{
    await service.validate({companyId:company,journalId:j.id});
    await service.requestApproval({companyId:company,journalId:j.id});
    await approver.decide({companyId:company,journalId:j.id,expectedHash:j.hash,decision:'approved'});
    return service.post({companyId:company,journalId:j.id,expectedHash:j.hash});
  };
  it('creates gold sale Draft, validates, waits for independent human approval, posts and replays atomically',async()=>{
    const j=await propose('LF26-SAL-0101');
    expect(j.state).toBe('Draft');expect(j.payload.lines).toMatchObject([{accountCode:'1100',debit:'3080'}, {}, {},{accountCode:'5010',debit:'2000'}, {accountCode:'1200',credit:'2000'}]);
    await expect(service.post({companyId:company,journalId:j.id,expectedHash:j.hash})).rejects.toMatchObject({code:'APPROVAL_REQUIRED'});
    await service.validate({companyId:company,journalId:j.id});await service.requestApproval({companyId:company,journalId:j.id});
    await expect(service.decide({companyId:company,journalId:j.id,expectedHash:j.hash,decision:'approved'})).rejects.toMatchObject({code:'FORBIDDEN'});
    await expect(approver.decide({companyId:company,journalId:j.id,expectedHash:'0'.repeat(64),decision:'approved'})).rejects.toMatchObject({code:'APPROVAL_INVALID'});
    await approver.decide({companyId:company,journalId:j.id,expectedHash:j.hash,decision:'approved'});
    const results=await Promise.all([service.post({companyId:company,journalId:j.id,expectedHash:j.hash}),service.post({companyId:company,journalId:j.id,expectedHash:j.hash})]);
    expect(results.every(r=>r.state==='Posted')).toBe(true);
    expect((await propose('LF26-SAL-0101')).id).toBe(j.id);
    expect((await db.pool.query('SELECT count(*)::int AS n FROM public.journal_lines WHERE journal_id=$1',[j.id])).rows[0]!.n).toBe(5);
  });
  it('rejects duplicate posting, closed-period writes and posted mutations',async()=>{
    await expect(propose('LF26-SAL-0101','duplicate-'+randomUUID())).rejects.toMatchObject({code:'DUPLICATE_POSTING'});
    const posted=(await service.list({companyId:company,state:'Posted'}))[0]!;
    await expect(db.pool.query("UPDATE public.journal_entries SET payload=payload||'{\"fake\":true}' WHERE id=$1",[posted.id])).rejects.toThrow('POSTED_IMMUTABLE');
    await expect(db.pool.query('UPDATE public.journal_lines SET debit=1 WHERE journal_id=$1',[posted.id])).rejects.toThrow('POSTED_IMMUTABLE');
    const feb=seed.periods.find(p=>p.companyId===company&&p.start==='2026-02-01')!;
    await db.pool.query("UPDATE public.fiscal_periods SET status='closed' WHERE id=$1",[feb.id]);
    try{await expect(propose('LF26-SAL-0201')).rejects.toMatchObject({code:'VALIDATION_FAILED'});}
    finally{await db.pool.query("UPDATE public.fiscal_periods SET status='open' WHERE id=$1",[feb.id]);}
  });
  it('derives posted trial balance/statements and creates traceable approved reversal',async()=>{
    const tb=await service.trialBalance({companyId:company,from:'2026-01-01',to:'2026-01-31'});
    expect(tb.totalDebit).toBe('5080');expect(tb.totalCredit).toBe('5080');
    const fs=await service.financialStatements({companyId:company,from:'2026-01-01',to:'2026-01-31'});
    expect(fs.balanceSheet.balanced).toBe(true);expect(fs.incomeStatement.profit).toBe('800');
    const original=await propose('LF26-SAL-0101');
    const reversal=await service.reverse({companyId:company,journalId:original.id,recognitionOn:'2026-01-11',idempotencyKey:'reversal/1'});
    await approveAndPost(reversal);
    expect((await service.financialStatements({companyId:company,from:'2026-01-01',to:'2026-01-31'})).incomeStatement.profit).toBe('0');
  });
  it('handles ten source kinds with the standalone rules, including partial cash, payroll and adjustments',async()=>{
    for(const kind of ['opening_capital','purchase','receipt','payment','payroll','asset_acquisition','prepayment','accrual','adjustment'] as const){
      const transaction=seed.transactions.find(t=>t.companyId===company&&t.kind===kind)!;
      const j=await propose(transaction.externalRef);
      expect(j.state).toBe('Draft');expect(j.payload.lines.length).toBeGreaterThanOrEqual(2);
      await approveAndPost(j);
    }
  });
  it('enforces tenant isolation, human decision immutability and close completeness',async()=>{
    await expect(service.propose({companyId:seed.companies[1]!.id,transactionId:seed.transactions.at(-1)!.id,idempotencyKey:'foreign'})).rejects.toMatchObject({code:'FORBIDDEN'});
    const j=await propose('LF26-SAL-0102');await service.validate({companyId:company,journalId:j.id});
    await service.requestApproval({companyId:company,journalId:j.id});
    await approver.decide({companyId:company,journalId:j.id,expectedHash:j.hash,decision:'rejected'});
    await expect(approver.decide({companyId:company,journalId:j.id,expectedHash:j.hash,decision:'approved'})).rejects.toMatchObject({code:'DECISION_IMMUTABLE'});
    await expect(service.post({companyId:company,journalId:j.id,expectedHash:j.hash})).rejects.toMatchObject({code:'APPROVAL_REQUIRED'});
    const january=seed.periods.find(p=>p.companyId===company&&p.start==='2026-01-01')!;
    await expect(approver.close({companyId:company,periodId:january.id})).rejects.toMatchObject({code:'CLOSE_INCOMPLETE'});
  });
  it('computes remaining month-end adjustments, closes a fully approved period and rejects further postings',async()=>{
    const period=seed.periods.find(p=>p.companyId===company&&p.start==='2026-02-01')!;
    const transactions=seed.transactions.filter(t=>t.companyId===company&&t.periodId===period.id);
    for(const t of transactions)await approveAndPost(await propose(t.externalRef));
    const closing=await service.closingAdjustments({companyId:company,periodId:period.id});
    expect(closing.proposals.length).toBeGreaterThan(0);
    for(const j of closing.proposals)await approveAndPost(j);
    expect((await service.closingAdjustments({companyId:company,periodId:period.id})).proposals).toHaveLength(0);
    const postedTrial=await service.trialBalance({companyId:company,from:period.start,to:period.end});
    expect(postedTrial.totalDebit).toBe(postedTrial.totalCredit);
    expect(await approver.close({companyId:company,periodId:period.id})).toMatchObject({state:'closed'});
    await expect(service.reverse({companyId:company,journalId:closing.proposals[0]!.id,recognitionOn:period.end,idempotencyKey:'closed-reversal'})).rejects.toMatchObject({code:'PERIOD_CLOSED'});
  },60000);
  it('preserves rejected history, discards by immutable hash and permits a replacement draft',async()=>{
    const old=await propose('LF26-SAL-0102');
    expect((await service.discard({companyId:company,journalId:old.id,expectedHash:old.hash,reason:'인간 반려 후 재검토'})).discardedAt).not.toBeNull();
    await expect(service.post({companyId:company,journalId:old.id,expectedHash:old.hash})).rejects.toMatchObject({code:'JOURNAL_DISCARDED'});
    const next=await propose('LF26-SAL-0102','replacement/'+old.id);
    expect(next.id).not.toBe(old.id);expect((await approveAndPost(next)).state).toBe('Posted');
    expect((await service.approval({companyId:company,journalId:old.id})).status).toBe('rejected');
  });
  it('rechecks normalized ledger lines and approval revocation before posting',async()=>{
    const j=await propose('LF26-SAL-0103');
    await service.validate({companyId:company,journalId:j.id});await service.requestApproval({companyId:company,journalId:j.id});
    await approver.decide({companyId:company,journalId:j.id,expectedHash:j.hash,decision:'approved'});
    await db.pool.query("DELETE FROM public.principal_scopes WHERE company_id=$1 AND principal_id=$2 AND scope='accounting:approve'",[company,human.principalId]);
    try{await expect(service.post({companyId:company,journalId:j.id,expectedHash:j.hash})).rejects.toMatchObject({code:'APPROVAL_REQUIRED'});}
    finally{await db.pool.query("INSERT INTO public.principal_scopes(company_id,principal_id,scope) VALUES($1,$2,'accounting:approve')",[company,human.principalId]);}
    await db.pool.query('UPDATE public.journal_lines SET debit=debit+1 WHERE journal_id=$1 AND line_no=1',[j.id]);
    await expect(service.post({companyId:company,journalId:j.id,expectedHash:j.hash})).rejects.toMatchObject({code:'LINE_PAYLOAD_MISMATCH'});
    expect((await service.get({companyId:company,journalId:j.id})).state).toBe('Approval');
  });
  it('matches only the posted original cash source once and reports independent ERP balances',async()=>{
    const transaction=seed.transactions.find(t=>t.companyId===company&&t.kind==='receipt')!,bank=seed.bankTransactions.find(b=>b.transactionId===transaction.id)!;
    const journal=await propose(transaction.externalRef);
    const input={companyId:company,bankTransactionId:bank.id,journalId:journal.id};
    const match=await service.matchBank(input);
    expect(match.matched).toBe(true);expect((await service.matchBank(input)).id).toBe(match.id);
    await expect(service.matchBank({...input,journalId:(await propose('LF26-SAL-0101')).id})).rejects.toMatchObject({code:'RECONCILIATION_MISMATCH'});
    const report=await service.reconciliation({companyId:company,from:'2026-01-01',to:'2026-01-31'});
    expect(report.bank.some(row=>row.matchId===match.id)).toBe(true);
    expect(report.cash.bankNetMovement).toMatch(/^-?\d+$/u);
  });
  it('archives immutable evidence metadata only for an authorized writer and its existing digest',async()=>{
    const doc=seed.documents.find(d=>d.companyId===company)!;
    await expect(service.repository.archiveEvidence(company,doc.id,doc.sha256,100)).rejects.toMatchObject({code:'FORBIDDEN'});
    expect(await approver.repository.archiveEvidence(company,doc.id,doc.sha256,100)).toMatchObject({archived:true,sha256:doc.sha256});
    expect((await service.repository.sourceDocuments(company,seed.transactions.find(t=>t.sourceDocumentId===doc.id)!.id))[0]!.sha256).toBe(doc.sha256);
  });
  it('records structured client results without accepting a fictitious posting claim',async()=>{
    const unposted=seed.transactions.find(t=>t.externalRef==='LF26-SAL-0104')!;
    const result={taskId:'client-result-001',role:'sales',status:'completed',transactionIds:[unposted.id],toolTraceIds:[],findings:[],missingEvidence:[],riskFlags:[],blockedReasons:[],humanApprovalRequired:true,journalPosted:true};
    await expect(service.recordAgentResult({companyId:company,client:'codex',result})).rejects.toThrow('POSTING_CLAIM_INVALID');
    const record=await service.recordAgentResult({companyId:company,client:'codex',result:{...result,status:'blocked',journalPosted:false}});
    expect(record.recorded).toBe(true);
    expect(await service.recordAgentResult({companyId:company,client:'codex',runId:record.runId,result:{...result,status:'blocked',journalPosted:false}})).toEqual(record);
  });
});
