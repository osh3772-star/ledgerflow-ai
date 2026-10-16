import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {describe,expect,it} from 'vitest';
import {FinancialMetrics,BalanceSheetPanel,TrialBalancePanel} from '../../apps/web/src/components/FinancialReports.js';

// Resolve React from the web workspace, which owns the runtime dependency.
const appRequire=createRequire(resolve('apps/web/package.json'));
const {renderToStaticMarkup}=appRequire('react-dom/server') as {renderToStaticMarkup:(node:unknown)=>string};
const text=(node:unknown)=>renderToStaticMarkup(node).replace(/<[^>]*>/gu,' ').replace(/\s+/gu,' ').trim();
const row={accountCode:'1110',debit:'100',credit:'100',balance:'0'};
const emptyFinancial=()=>({balanceSheet:{assets:'0',liabilities:'0',equity:'0',balanced:true,accounts:[]},
  incomeStatement:{revenue:'0',profit:'0',accounts:[]}});
const loaded={loading:false,error:''};

describe('financial reports reflect posted ledger availability',()=>{
  it('hides empty zero totals instead of presenting unposted sample transactions as a zero financial statement',()=>{
    const financial=emptyFinancial();
    const metrics=text(FinancialMetrics({...loaded,financial,pendingCount:0,postedCount:0}));
    const balance=text(BalanceSheetPanel({...loaded,financial,asOf:'2026-01-31'}));
    const trial=text(TrialBalancePanel({...loaded,trial:{items:[],totalDebit:'0',totalCredit:'0'}}));
    expect(metrics).toContain('장부 반영 전');expect(balance).toContain('장부 반영 전');
    expect(trial).toContain('이 기간의 장부 기록 없음');
    expect(metrics+balance+trial).not.toMatch(/\b0\s*원/u);
    expect(trial).not.toContain('차변 합계');expect(balance).not.toContain('자산 = 부채 + 자본');
  });
  it('shows actual period amounts even when the capped journal list contains no posted rows',()=>{
    const financial={...emptyFinancial(),incomeStatement:{revenue:'12000',profit:'1000',accounts:[row]}};
    const metrics=text(FinancialMetrics({...loaded,financial,pendingCount:0,postedCount:0}));
    expect(metrics).toMatch(/12,000\s*원/u);expect(metrics).toMatch(/1,000\s*원/u);
    expect(metrics).not.toContain('장부 반영 전');
  });
  it('keeps the cumulative balance sheet when a later period has no movements',()=>{
    const financial={...emptyFinancial(),balanceSheet:{assets:'12000',liabilities:'0',equity:'12000',balanced:true,accounts:[row]}};
    expect(text(BalanceSheetPanel({...loaded,financial,asOf:'2026-02-28'}))).toMatch(/12,000\s*원/u);
    const metrics=text(FinancialMetrics({...loaded,financial,pendingCount:0,postedCount:0}));
    expect(metrics).toContain('이 기간의 장부 기록 없음');expect(metrics).not.toMatch(/\b0\s*원/u);
  });
  it('still displays a genuine zero balance after posted entries cancel each other',()=>{
    const financial={balanceSheet:{assets:'0',liabilities:'0',equity:'0',balanced:true,accounts:[row]},
      incomeStatement:{revenue:'0',profit:'0',accounts:[row]}};
    const metrics=text(FinancialMetrics({...loaded,financial,pendingCount:0,postedCount:2}));
    const balance=text(BalanceSheetPanel({...loaded,financial,asOf:'2026-01-31'}));
    expect(metrics).toMatch(/\b0\s*원/u);expect(balance).toMatch(/\b0\s*원/u);
    expect(balance).toContain('자산 = 부채 + 자본');expect(balance).not.toContain('장부 반영 전');
    expect(text(TrialBalancePanel({...loaded,trial:{items:[row],totalDebit:'100',totalCredit:'100'}}))).toContain('차변 합계');
  });
  it.each([{loading:true,error:'',status:'자료 확인 중'},{loading:false,error:'NETWORK_ERROR',status:'자료 조회 실패'}])(
    'does not show stale amounts or claim an empty ledger while $status',({loading,error,status})=>{
      const financial={balanceSheet:{assets:'12000',liabilities:'0',equity:'12000',balanced:true,accounts:[row]},
        incomeStatement:{revenue:'12000',profit:'1000',accounts:[row]}};
      const views=[FinancialMetrics({financial,loading,error,pendingCount:0,postedCount:1}),
        BalanceSheetPanel({financial,loading,error,asOf:'2026-01-31'}),
        TrialBalancePanel({loading,error,trial:{items:[row],totalDebit:'100',totalCredit:'100'}})].map(text);
      for(const view of views){expect(view).toContain(status);expect(view).not.toContain('12,000');expect(view).not.toContain('장부 반영 전');}
    });
});
