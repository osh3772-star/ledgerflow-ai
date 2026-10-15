import {ExactDecimal,DomainError,proposeInput,journalInput,postInput,rangeInput,periodInput,reverseInput,listJournalInput,
  decisionInput,discardInput,reconciliationInput,documentInput,companyInput,uuidSchema,agentResultSchema,wonSchema,unprocessedQuerySchema,type Journal,type JournalPayload} from '@ledgerflow/contracts';
import {z} from 'zod';
import {generateJournal,validateJournal,trialBalance,monthlyDepreciation} from '@ledgerflow/accounting-core';
import type {PostgresAccountingRepository} from '@ledgerflow/data-access';
const decimal=(s:string)=>new ExactDecimal(s);
export class AccountingService{
  constructor(readonly repository:PostgresAccountingRepository){}
  async propose(input:unknown){const q=proposeInput.parse(input);
    const existing=await this.repository.byKey(q.companyId,q.idempotencyKey);
    if(existing){
      if(existing.transactionId!==q.transactionId)throw new DomainError('IDEMPOTENCY_CONFLICT','동일 키의 거래 참조가 다릅니다.');
      return this.repository.journal(q.companyId,existing.id);
    }
    const payload=generateJournal(await this.repository.source(q.companyId,q.transactionId));
    return this.repository.save(q.companyId,payload,q.idempotencyKey) as Promise<Journal>;}
  async documents(input:unknown){const q=documentInput.parse(input);return this.repository.sourceDocuments(q.companyId,q.transactionId);}
  async get(input:unknown){const q=journalInput.parse(input);return this.repository.journal(q.companyId,q.journalId);}
  async list(input:unknown){const q=listJournalInput.parse(input);return this.repository.list(q.companyId,q.state,q.limit,q.after);}
  async unprocessed(input:unknown){return this.repository.pending(unprocessedQuerySchema.parse(input));}
  async validate(input:unknown){
    const q=journalInput.parse(input),j=await this.repository.journal(q.companyId,q.journalId);
    if(j.payload.entryType==='source'){
      const errors=validateJournal(j.payload,await this.repository.source(q.companyId,j.payload.transactionId));
      if(errors.length)throw new DomainError('VALIDATION_FAILED',errors.join(','));
    }
    return this.repository.command(q.companyId,'validate',{journalId:q.journalId});
  }
  async requestApproval(input:unknown){const q=journalInput.parse(input);return this.repository.command(q.companyId,'request',{journalId:q.journalId});}
  async approval(input:unknown){const q=journalInput.parse(input);return this.repository.approval(q.companyId,q.journalId);}
  async decide(input:unknown){const q=decisionInput.parse(input);return this.repository.command(q.companyId,'decide',q);}
  async post(input:unknown){const q=postInput.parse(input);return this.repository.command(q.companyId,'post',q);}
  async discard(input:unknown){const q=discardInput.parse(input);return this.repository.command(q.companyId,'discard',q);}
  async reconciliation(input:unknown){const q=rangeInput.parse(input);return this.repository.reconciliation(q.companyId,q.from,q.to);}
  async matchBank(input:unknown){const q=reconciliationInput.parse(input);return this.repository.matchBank(q.companyId,q.bankTransactionId,q.journalId);}
  async ledger(input:unknown){const q=rangeInput.parse(input);return this.repository.ledger(q.companyId,q.from,q.to);}
  async trialBalance(input:unknown){return trialBalance(await this.ledger(input));}
  async financialStatements(input:unknown){
    const q=rangeInput.parse(input),periodLines=await this.repository.ledger(q.companyId,q.from,q.to);
    const cumulative=await this.repository.ledger(q.companyId,'2000-01-01',q.to),balance=trialBalance(cumulative),income=trialBalance(periodLines);
    const sum=(rows:typeof balance.items,kinds:string[],inverse=false)=>rows.reduce((s,r)=>{
      const kind=cumulative.find(l=>l.accountCode===r.accountCode)?.kind;
      return kinds.includes(kind??'')?s.plus(decimal(r.balance).mul(inverse?-1:1)):s;
    },decimal('0'));
    const assets=sum(balance.items,['asset']),liabilities=sum(balance.items,['liability'],true),capital=sum(balance.items,['equity'],true);
    const retained=sum(balance.items,['revenue'],true).minus(sum(balance.items,['expense']));
    const revenue=sum(income.items,['revenue'],true),expenses=sum(income.items,['expense']);
    return {asOf:q.to,from:q.from,origin:'synthetic_erp',basis:'portfolio_K_IFRS_assumptions_not_certified',
      balanceSheet:{assets:assets.toFixed(0),liabilities:liabilities.toFixed(0),equity:capital.plus(retained).toFixed(0),
        currentAndPriorProfit:retained.toFixed(0),balanced:assets.eq(liabilities.plus(capital).plus(retained)),accounts:balance.items},
      incomeStatement:{revenue:revenue.toFixed(0),expenses:expenses.toFixed(0),profit:revenue.minus(expenses).toFixed(0),accounts:income.items},
      limitations:['법인세·법정 신고·자본변동표·현금흐름표·주석 미포함','게시된 가상 전표에 한정','전문가 검토 미완료']};
  }
  async reverse(input:unknown){
    const q=reverseInput.parse(input),original=await this.repository.journal(q.companyId,q.journalId);
    if(original.state!=='Posted'||original.payload.entryType==='reversal')throw new DomainError('INVALID_STATE','게시된 원전표가 필요합니다.');
    const period=await this.repository.periodForDate(q.companyId,q.recognitionOn);
    if(!period||period.status!=='open')throw new DomainError('PERIOD_CLOSED','열린 역분개 기간이 필요합니다.');
    const payload:JournalPayload={...original.payload,entryType:'reversal',recognitionOn:q.recognitionOn,periodId:period.id,
      description:'역분개 '+original.id,reversalOf:original.id,
      lines:original.payload.lines.map(l=>({accountCode:l.accountCode,debit:l.credit,credit:l.debit}))};
    if(payload.calculation)payload.calculation={...payload.calculation,periodId:period.id};
    return this.repository.save(q.companyId,payload,q.idempotencyKey);
  }
  async closingAdjustments(input:unknown){
    const q=periodInput.parse(input),period=await this.repository.period(q.companyId,q.periodId);
    if(period.status!=='open')throw new DomainError('PERIOD_CLOSED','열린 기간이 필요합니다.');
    const schedules=await this.repository.schedules(q.companyId,period.to),proposals:Journal[]=[];
    for(const row of [...schedules.assets.map(a=>({...a,type:'depreciation' as const,expected:monthlyDepreciation(a.cost,a.residual,a.months),maximum:decimal(a.cost).minus(a.residual).toFixed(0)})),
      ...schedules.prepayments.map(p=>({...p,type:'prepaid_expense' as const,expected:p.amount,maximum:p.cost}))]){
      const prior=schedules.charges.filter(c=>c.reference===row.id&&c.date<period.from).reduce((s,c)=>s.plus(c.amount),decimal('0'));
      const remaining=decimal(row.maximum).minus(prior),expected=ExactDecimal.min(row.expected,ExactDecimal.max(remaining,0));
      const already=schedules.charges.filter(c=>c.reference===row.id&&c.date>=period.from).reduce((s,c)=>s.plus(c.amount),decimal('0'));
      const amount=expected.minus(already);
      if(amount.lt(0))throw new DomainError('OVER_AMORTIZED','과다 상각을 검토해야 합니다.');
      if(amount.eq(0))continue;
      const source=await this.repository.source(q.companyId,row.transactionId);
      const payload:JournalPayload={transactionId:row.transactionId,periodId:period.id,recognitionOn:period.to,entryType:'adjustment',
        description:period.to+' '+row.type+' '+row.id,sourceDocumentIds:source.documentIds,evidenceHashes:source.documentHashes,policyVersion:'lf-accounting-v1',
        lines:[{accountCode:row.type==='depreciation'?'5030':'5040',debit:amount.toFixed(0),credit:'0'},
          {accountCode:row.type==='depreciation'?'1590':'1400',debit:'0',credit:amount.toFixed(0)}],
        basis:{standards:[row.type==='depreciation'?'K-IFRS 제1016호':'K-IFRS 제1001호'],
          assumptions:['사용가능/보장 월부터 월 균등 인식','기게시 상각 차감·잔액 상한·마지막 월 보정'],uncertainty:'전문가 검토 미완료; 시나리오 월 규약',expertReviewed:false},
        calculation:{type:row.type,referenceId:row.id,periodId:period.id}};
      proposals.push(await this.repository.save(q.companyId,payload,'close/'+period.id+'/'+row.type+'/'+row.id) as Journal);
    }
    return {periodId:period.id,proposals,posted:false};
  }
  async close(input:unknown){const q=periodInput.parse(input);
    const period=await this.repository.period(q.companyId,q.periodId),schedules=await this.repository.schedules(q.companyId,period.to);
    for(const row of [...schedules.assets.map(a=>({...a,expected:monthlyDepreciation(a.cost,a.residual,a.months),maximum:decimal(a.cost).minus(a.residual).toFixed(0)})),
      ...schedules.prepayments.map(p=>({...p,expected:p.amount,maximum:p.cost}))]){
      const prior=schedules.charges.filter(c=>c.reference===row.id&&c.date<period.from).reduce((s,c)=>s.plus(c.amount),decimal('0'));
      const current=schedules.charges.filter(c=>c.reference===row.id&&c.date>=period.from).reduce((s,c)=>s.plus(c.amount),decimal('0'));
      const expected=ExactDecimal.min(row.expected,ExactDecimal.max(decimal(row.maximum).minus(prior),0));
      if(!current.eq(expected))throw new DomainError('CLOSE_INCOMPLETE','결산 수정분개 승인·전기가 필요합니다.');
    }
    return this.repository.command(q.companyId,'close',q);
  }
  async depreciation(input:unknown){const q=z.strictObject({cost:wonSchema,residual:wonSchema,months:z.number().int().min(1).max(1200)}).parse(input);
    return {monthly:monthlyDepreciation(q.cost,q.residual,q.months),currency:'KRW',method:'straight_line_monthly_rounded',requiresHumanReview:true};}
  async audit(input:unknown){const q=rangeInput.parse(input);return this.repository.audit(q.companyId,q.from,q.to);}
  async recordAgentResult(input:unknown){
    const q=companyInput.extend({client:z.enum(['codex','claude_code']),runId:uuidSchema.optional(),result:agentResultSchema}).parse(input);
    return this.repository.recordResult(q.companyId,q.client,q.runId,q.result);
  }
}
