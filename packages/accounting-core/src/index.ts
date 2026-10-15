import {ExactDecimal,DomainError,journalPayloadSchema,type JournalPayload,type BusinessTransaction} from '@ledgerflow/contracts';
export interface Account {code:string;kind:string;normalSide:string;active:boolean;validFrom:string;validTo:string|null}
export interface SourceSnapshot {
  transaction:BusinessTransaction;documentIds:string[];documentHashes:{documentId:string;sha256:string}[];document:Record<string,unknown>;
  period:{id:string;from:string;to:string;status:string};accounts:Account[];
  invoice?:{net:string;tax:string;gross:string};
  contract?:{deliveredOn:string;performanceObligations:number};
  inventory?:{quantity:string;unitCost:string};
  payroll?:{gross:string;withholding:string;netPay:string};
  asset?:{id:string;availableOn:string;cost:string;residual:string;usefulLifeMonths:number};
  prepayment?:{id:string;coverageStart:string;coverageEnd:string;cost:string;monthlyExpense:string};
  adjustment?:{type:string;assetId:string|null;prepaymentId:string|null;amount:string};
}
const d=(n:string)=>new ExactDecimal(n);
export function monthlyDepreciation(cost:string,residual:string,months:number):string{
  if(!Number.isSafeInteger(months)||months<=0||d(cost).lt(residual)||d(residual).lt(0))throw new DomainError('INVALID_INPUT','유효한 상각 조건이 필요합니다.');
  return d(cost).minus(residual).div(months).toDecimalPlaces(0).toFixed(0);
}
export function generateJournal(source:SourceSnapshot):JournalPayload{
  const t=source.transaction,lines:JournalPayload['lines']=[],standards=['K-IFRS 제1001호'];
  const assumptions=['가상회사 정수 KRW','부가세 금액·공제 가능 여부는 증빙 시나리오 가정이며 세법 판단 아님'];
  const line=(accountCode:string,debit:string,credit:string)=>{if(d(debit).plus(credit).gt(0))lines.push({accountCode,debit,credit});};
  const invoice=()=>{if(!source.invoice||!['net','tax','gross'].every(k=>source.invoice![k as 'net'|'tax'|'gross']===t[k as 'net'|'tax'|'gross']))
    throw new DomainError('EVIDENCE_MISSING','거래와 일치하는 세금계산서가 필요합니다.');};
  let calculation:JournalPayload['calculation'];
  switch(t.kind){
    case 'opening_capital':
      if(source.document.capitalPaidIn!==true)throw new DomainError('EVIDENCE_MISSING','납입 근거가 필요합니다.');
      line('1010',t.gross,'0');line('3010','0',t.gross);break;
    case 'sale':{
      invoice();standards.push('K-IFRS 제1115호','K-IFRS 제1002호');
      if(!source.contract||source.contract.deliveredOn!==t.recognitionOn||source.contract.performanceObligations!==1||!source.inventory)
        throw new DomainError('NEEDS_REVIEW','단일 수행의무·인도·원가 증빙을 확인해야 합니다.');
      assumptions.push('상품 인도일의 통제 이전·단일 수행의무','증빙 단위원가 일정; 변동 원가는 별도 검토');
      const cost=d(source.inventory.quantity).mul(source.inventory.unitCost).toFixed(0);
      line('1100',t.gross,'0');line('4010','0',t.net);line('2100','0',t.tax);
      line('5010',cost,'0');line('1200','0',cost);break;
    }
    case 'purchase':invoice();standards.push('K-IFRS 제1002호');line('1200',t.net,'0');line('1300',t.tax,'0');line('2010','0',t.gross);break;
    case 'receipt':if(!source.document.invoiceId)throw new DomainError('NEEDS_REVIEW','수금 참조가 필요합니다.');
      line('1010',t.gross,'0');line('1100','0',t.gross);break;
    case 'payment':if(!source.document.invoiceId)throw new DomainError('NEEDS_REVIEW','지급 참조가 필요합니다.');
      line('2010',t.gross,'0');line('1010','0',t.gross);break;
    case 'payroll':
      if(!source.payroll||d(source.payroll.netPay).plus(source.payroll.withholding).toFixed()!==t.gross)
        throw new DomainError('EVIDENCE_MISSING','급여·예수금 자료가 필요합니다.');
      assumptions.push('급여 원천공제는 가상 정액; 실제 세법 산출 아님');
      line('5020',source.payroll.gross,'0');line('1010','0',source.payroll.netPay);line('2030','0',source.payroll.withholding);break;
    case 'asset_acquisition':invoice();standards.push('K-IFRS 제1016호');line('1500',t.net,'0');line('1300',t.tax,'0');line('1010','0',t.gross);break;
    case 'prepayment':line('1400',t.gross,'0');line('1010','0',t.gross);break;
    case 'accrual':line('5050',t.gross,'0');line('2020','0',t.gross);break;
    case 'adjustment':{
      if(!source.adjustment)throw new DomainError('EVIDENCE_MISSING','결산 제안 근거가 필요합니다.');
      if(source.adjustment.type==='depreciation'&&source.asset){
        standards.push('K-IFRS 제1016호');
        const amount=monthlyDepreciation(source.asset.cost,source.asset.residual,source.asset.usefulLifeMonths);
        if(t.recognitionOn<source.asset.availableOn||amount!==t.gross)throw new DomainError('NEEDS_REVIEW','상각 시작일·금액을 확인해야 합니다.');
        assumptions.push('사용가능 월부터 정액 월 상각, 원 단위 반올림, 마지막 월 잔액 보정');
        calculation={type:'depreciation',referenceId:source.asset.id,periodId:t.periodId};
        line('5030',t.gross,'0');line('1590','0',t.gross);
      }else if(source.adjustment.type==='prepaid_expense'&&source.prepayment){
        if(t.recognitionOn<source.prepayment.coverageStart||t.recognitionOn>source.prepayment.coverageEnd||t.gross!==source.prepayment.monthlyExpense)
          throw new DomainError('NEEDS_REVIEW','선급비용 귀속·금액을 확인해야 합니다.');
        calculation={type:'prepaid_expense',referenceId:source.prepayment.id,periodId:t.periodId};
        line('5040',t.gross,'0');line('1400','0',t.gross);
      }else throw new DomainError('NEEDS_REVIEW','결산 처리 정책 검토가 필요합니다.');
      break;
    }
  }
  const payload=journalPayloadSchema.parse({transactionId:t.id,periodId:t.periodId,recognitionOn:t.recognitionOn,entryType:'source',
    description:t.externalRef+' '+t.kind,sourceDocumentIds:source.documentIds,evidenceHashes:source.documentHashes,lines,
    basis:{standards,assumptions,uncertainty:'K-IFRS 판단 가정에 대한 전문가 검토 미완료; 한국 세법 공제·신고 계산 미포함',expertReviewed:false},
    policyVersion:'lf-accounting-v1',...(calculation?{calculation}:{})});
  const findings=validateJournal(payload,source);
  if(findings.length)throw new DomainError('VALIDATION_FAILED',findings.join(','));
  return payload;
}
export function validateJournal(payload:JournalPayload,source:SourceSnapshot):string[]{
  const errors:string[]=[];
  if(payload.transactionId!==source.transaction.id)errors.push('TRANSACTION_MISMATCH');
  if(payload.periodId!==source.period.id||payload.recognitionOn<source.period.from||payload.recognitionOn>source.period.to)errors.push('PERIOD_MISMATCH');
  if(source.period.status!=='open')errors.push('PERIOD_CLOSED');
  if(payload.sourceDocumentIds.some(id=>!source.documentIds.includes(id)))errors.push('EVIDENCE_MISMATCH');
  if(JSON.stringify(payload.evidenceHashes)!==JSON.stringify(source.documentHashes))errors.push('EVIDENCE_CHANGED');
  let debit=d('0'),credit=d('0');
  for(const line of payload.lines){
    const account=source.accounts.find(a=>a.code===line.accountCode);
    if(!account||!account.active||account.validFrom>payload.recognitionOn||account.validTo&&account.validTo<payload.recognitionOn)errors.push('ACCOUNT_INVALID');
    if(d(line.debit).lt(0)||d(line.credit).lt(0)||d(line.debit).gt(0)===d(line.credit).gt(0))errors.push('LINE_INVALID');
    debit=debit.plus(line.debit);credit=credit.plus(line.credit);
  }
  if(debit.lte(0)||!debit.eq(credit))errors.push('UNBALANCED');
  return [...new Set(errors)];
}
export function trialBalance(lines:{accountCode:string;debit:string;credit:string}[]){
  const rows=new Map<string,{accountCode:string;debit:InstanceType<typeof ExactDecimal>;credit:InstanceType<typeof ExactDecimal>}>();
  for(const line of lines){const row=rows.get(line.accountCode)??{accountCode:line.accountCode,debit:d('0'),credit:d('0')};
    row.debit=row.debit.plus(line.debit);row.credit=row.credit.plus(line.credit);rows.set(line.accountCode,row);}
  const items=[...rows.values()].sort((a,b)=>a.accountCode.localeCompare(b.accountCode)).map(r=>({accountCode:r.accountCode,
    debit:r.debit.toFixed(0),credit:r.credit.toFixed(0),balance:r.debit.minus(r.credit).toFixed(0)}));
  return {items,totalDebit:items.reduce((s,r)=>s.plus(r.debit),d('0')).toFixed(0),
    totalCredit:items.reduce((s,r)=>s.plus(r.credit),d('0')).toFixed(0)};
}
