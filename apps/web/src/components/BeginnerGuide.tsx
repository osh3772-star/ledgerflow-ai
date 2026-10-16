import {useId,useRef,useState} from 'react';
import '../styles/beginner-guide.css';

const firstRequest=`LedgerFlow의 get_system_status와 get_company_context로 연결과 회사 정보를 먼저 확인해 줘.
매출 역할로 2026년 1월의 미처리 매출 거래 1건을 찾아 증빙을 확인해 줘.
어떤 거래인지, 어떤 계정에 왜 기록하는지 회계 초보자도 이해할 수 있게 설명해 줘.
분개 초안 생성 → 검증 → 사용자 승인 요청까지 진행해 줘.
전표 ID, 버전, hash와 차변·대변 합계를 알려주고 사용자 승인 대기에서 멈춰 줘.
도구가 연결되지 않았거나 증빙이 부족하면 그 상태를 알려줘.`;
const postRequest=`LedgerFlow의 get_system_status와 get_company_context를 먼저 확인해 줘.
내가 사이트에서 승인한 전표 [전표 ID]의 승인 상태와 버전·hash를 다시 확인해 줘.
승인 조건이 맞으면 장부에 반영하고 DB 상태가 Posted인지 확인해 줘.
2026년 1월 시산표와 재무제표를 보여 주고 각 숫자가 무엇을 뜻하는지 쉽게 설명해 줘.
승인되지 않았거나 내용이 달라졌다면 이유를 알려주고 멈춰 줘.`;
const connectionRequest=`LedgerFlow의 get_system_status와 get_company_context를 호출해서 연결 상태와 회사 이름을 알려줘.
실제 도구가 보이지 않거나 호출이 실패하면 연결되었다고 추정하지 말고 알려줘.
거래 생성, 승인, 장부 반영은 하지 마.`;

type GuideTarget='approval'|'reports';
const glossary=[
  ['거래','상품 판매, 물건 매입, 급여 지급처럼 회사에서 일어난 일입니다.'],
  ['증빙','그 거래를 확인할 수 있는 세금계산서·계약서·입출금 내역 같은 자료입니다.'],
  ['분개','거래를 매출·예금·받을 돈 등 알맞은 계정으로 나누어 기록하는 일입니다.'],
  ['전표','한 거래를 어떻게 기록할지 정리한 회계 기록 묶음입니다. 초안과 장부 반영 완료 상태를 구분합니다.'],
  ['차변·대변','회계 기록의 두 쪽입니다. 단순히 입금·출금을 뜻하지 않으며, 시스템은 양쪽 금액의 합계가 같은지 검증합니다.'],
  ['승인','사람이 기록과 증빙을 검토해 맞는 내용인지 결정하는 단계입니다.'],
  ['전기·장부 반영','승인된 전표를 장부에 실제로 기록하는 일입니다. 승인 후 앱에 따로 요청합니다.'],
  ['시산표·재무제표','계정별 기록을 모아 확인하는 표와, 회사의 자산·빚·자본·손익을 보여 주는 보고서입니다.'],
] as const;

function AppName({english,korean}:{english:string;korean:string}){
  return <span className="guide-app-name"><span lang="en">{english}</span><small lang="ko">{korean}</small></span>;
}

function RequestBox({title,prompt,hint}:{title:string;prompt:string;hint:string}){
  const id=useId(),field=useRef<HTMLTextAreaElement>(null),[message,setMessage]=useState('');
  async function copy(){
    try{
      if(!navigator.clipboard?.writeText)throw new Error('CLIPBOARD_UNAVAILABLE');
      await navigator.clipboard.writeText(prompt);
      setMessage('복사했습니다. 연결된 앱의 대화창에 붙여 넣으세요.');
    }catch{
      field.current?.focus();field.current?.select();
      setMessage('요청문을 선택했습니다. Ctrl+C 또는 기기의 복사 기능을 이용해 주세요.');
    }
  }
  return <div className="guide-request-box">
    <div className="guide-request-heading"><label htmlFor={id}>{title}</label><button type="button" className="guide-copy-button" onClick={()=>void copy()}>요청문 복사</button></div>
    <textarea id={id} ref={field} readOnly rows={7} value={prompt} spellCheck={false} aria-describedby={id+'-hint'}/>
    <p id={id+'-hint'} className="guide-field-hint">{hint}</p>
    <p className="guide-copy-status" role="status">{message}</p>
  </div>;
}

export function GuideWelcome({onOpen}:{onOpen:()=>void}){
  return <section className="guide-welcome" aria-labelledby="guide-welcome-title">
    <div><span className="guide-kicker">처음 방문하셨나요?</span><h2 id="guide-welcome-title">회계를 몰라도, 거래 한 건부터 따라 해보세요.</h2>
      <p>앱에 말로 요청하고, 이 화면에서 확인한 뒤 승인합니다. 사용 순서와 이 사이트를 만든 이유를 함께 살펴보세요.</p></div>
    <button type="button" className="guide-primary-button" onClick={onOpen}>사용 방법과 제작 목적 보기 <span aria-hidden="true">→</span></button>
  </section>;
}

export default function BeginnerGuide({onNavigate}:{onNavigate:(target:GuideTarget)=>void}){
  return <div className="beginner-guide">
    <section className="guide-intro" aria-labelledby="guide-intro-title">
      <span className="guide-kicker">회계 초보자를 위한 시작 안내</span>
      <h2 id="guide-intro-title">앱에 말하고, 사이트에서 확인하세요.</h2>
      <p>거래를 찾아 장부에 기록하는 과정을 연습하는 공간입니다. 업무 요청은 <strong>클로드 코드 또는 코덱스의 대화창</strong>에서 하고, 전표 검토와 승인은 <strong>이 사이트</strong>에서 합니다.</p>
      <div className="guide-role-grid">
        <div><span className="guide-role-icon" aria-hidden="true">01</span><h3>나는 할 일을 말합니다</h3><p>“1월 매출 한 건을 정리해 줘”처럼 기간과 대상을 알려줍니다.</p></div>
        <div><span className="guide-role-icon" aria-hidden="true">02</span><h3>앱과 엔진이 준비합니다</h3><p>앱이 자료를 확인하고, 회계 엔진이 금액을 계산해 기록을 검증합니다.</p></div>
        <div><span className="guide-role-icon" aria-hidden="true">03</span><h3>나는 보고 결정합니다</h3><p>전표와 증빙이 맞는지 확인하고 승인하거나 반려합니다.</p></div>
      </div>
    </section>

    <section className="guide-section" aria-labelledby="guide-why-title">
      <div className="guide-section-heading"><span className="guide-kicker">이 사이트를 만든 이유</span><h2 id="guide-why-title">거래가 장부와 보고서가 되는 과정을 보여주기 위해서입니다.</h2></div>
      <p>회계는 거래를 입력하는 데서 끝나지 않습니다. 근거 자료를 확인하고, 기록이 맞는지 검증하고, 승인된 내용을 모아 회사의 상태를 이해해야 합니다. 이 과정을 가상회사의 거래로 직접 따라갈 수 있도록 만들었습니다.</p>
      <p>반복 계산과 검사는 코드가 맡고, 인공지능은 자료 정리와 설명을 돕고, 최종 결정은 사람이 합니다. <strong>회계 업무 이해와 인공지능 도구 연동·웹·데이터베이스 개발 역량을 함께 보여주기 위한 취업 포트폴리오</strong>입니다.</p>
      <div className="guide-principles"><span>가상 거래 1,000건으로 연습</span><span>계산·검증은 규칙 엔진</span><span>장부 반영 전 사용자 승인</span></div>
    </section>

    <section className="guide-section" aria-labelledby="guide-connect-title">
      <div className="guide-section-heading"><span className="guide-kicker">시작 전 한 번만 확인</span><h2 id="guide-connect-title">사용 중인 앱 하나에서 이 프로젝트를 여세요.</h2></div>
      <p>사이트가 열렸다면 웹 서버는 실행 중입니다. 다음으로 앱이 같은 회계 도구에 연결되어 있는지 확인합니다. 두 앱을 모두 사용할 필요는 없습니다.</p>
      <div className="guide-app-grid">
        <article><h3><AppName english="Claude Code" korean="클로드 코드"/></h3><p>LedgerFlow 프로젝트 폴더에서 시작하고 프로젝트 신뢰와 회계 도구 연결을 허용합니다. 대화창에서 <code>/mcp</code>로 연결 상태를 확인하세요.</p><a href="https://code.claude.com/docs/en/mcp" target="_blank" rel="noopener noreferrer">클로드 코드 공식 연결 도움말 ↗</a></article>
        <article><h3><AppName english="Codex" korean="코덱스"/></h3><p>LedgerFlow 프로젝트를 열고 신뢰한 프로젝트의 기존 회계 도구 연결을 확인합니다. 설정의 도구 연결 목록에서 서버를 확인한 뒤 이 프로젝트의 대화창에 요청하세요.</p><a href="https://learn.chatgpt.com/docs/extend/mcp" target="_blank" rel="noopener noreferrer">OpenAI 공식 연결 도움말 ↗</a></article>
      </div>
      <details className="guide-details"><summary>앱 연결 확인용 문장과 서버 정보 보기</summary>
        <p>서버 이름은 <code>ledgerflow-accounting-mcp</code>, 주소는 <code>http://127.0.0.1:8787/mcp</code>입니다. 프로젝트에는 기존 연결 설정이 있습니다. 새 서버를 중복으로 만들지 않고 그 연결을 사용합니다.</p>
        <RequestBox title="앱에 연결 확인 요청하기" prompt={connectionRequest} hint="앱이 실제 도구를 호출한 결과로 확인합니다. 이 화면에서 연결 성공을 대신 판정하지 않습니다."/>
      </details>
    </section>

    <section className="guide-section" aria-labelledby="guide-steps-title">
      <div className="guide-section-heading"><span className="guide-kicker">거래 한 건으로 따라 하기</span><h2 id="guide-steps-title">요청 → 검토 → 승인 → 장부 확인</h2></div>
      <ol className="guide-steps">
        <li><span className="guide-step-number" aria-hidden="true">1</span><div><h3>앱에 정리를 요청하세요</h3><p>아래 첫 요청문을 앱에 붙여 넣습니다. 앱이 거래와 증빙을 찾아 전표 초안을 만들고 검증합니다.</p></div></li>
        <li><span className="guide-step-number" aria-hidden="true">2</span><div><h3>사이트에서 직접 검토하세요</h3><p>상단의 ‘새로고침’을 누른 뒤 ‘사용자 승인’에서 ‘전표 보기’를 누릅니다. 날짜·금액·증빙·기록 근거를 확인하고 맞으면 승인, 잘못되었으면 반려합니다.</p><button type="button" className="guide-link-button" onClick={()=>onNavigate('approval')}>승인 화면 열기 →</button></div></li>
        <li><span className="guide-step-number" aria-hidden="true">3</span><div><h3>승인한 전표의 반영을 요청하세요</h3><p>앱으로 돌아가 두 번째 요청문을 보냅니다. 승인 버튼만 누르면 자동으로 장부에 들어가는 것은 아닙니다.</p></div></li>
        <li><span className="guide-step-number" aria-hidden="true">4</span><div><h3>보고서에서 결과를 확인하세요</h3><p>앱이 장부 반영 완료를 확인한 뒤 ‘재무 보고서’를 엽니다. 상단 기간을 ‘2026-01’로 선택하고 ‘새로고침’을 누르세요. 모르는 숫자는 앱에 쉬운 설명을 요청하세요.</p><button type="button" className="guide-link-button" onClick={()=>onNavigate('reports')}>재무 보고서 열기 →</button></div></li>
      </ol>
      <RequestBox title="첫 번째 요청문 · 매출 한 건을 승인 대기까지" prompt={firstRequest} hint="요청문 복사는 업무를 실행하지 않습니다. 연결된 앱의 대화창에 붙여 넣어 보내세요."/>
      <div className="guide-human-note"><strong>승인은 내가 직접 합니다.</strong><p>앱에서 ‘도구 실행 허용’을 누르는 것과 장부 승인은 다른 일입니다. 이해되지 않는 전표는 먼저 설명을 요청하고, 이 사이트에서 내용을 확인한 뒤 결정하세요.</p></div>
      <RequestBox title="두 번째 요청문 · 내가 승인한 뒤 장부에 반영" prompt={postRequest} hint="[전표 ID]는 첫 번째 작업에서 앱이 알려준 전표 ID로 바꿔 주세요. 승인하지 않은 전표는 반영되지 않습니다."/>
    </section>

    <section className="guide-section" aria-labelledby="guide-terms-title">
      <div className="guide-section-heading"><span className="guide-kicker">어려운 말은 여기서 확인</span><h2 id="guide-terms-title">처음 만나는 회계 용어</h2></div>
      <dl className="guide-glossary">{glossary.map(([term,description])=><div key={term}><dt>{term}</dt><dd>{description}</dd></div>)}</dl>
      <details className="guide-details"><summary>처음에 재무 보고서가 0원으로 보이는 이유</summary><p>거래 자료가 있어도 아직 장부에 반영한 전표가 없으면 보고서가 0원일 수 있습니다. 이 화면은 장부 반영이 끝난 기록만 집계합니다. 첫 거래의 초안·검증·승인·반영까지 진행한 뒤 다시 확인하세요.</p></details>
    </section>

    <section className="guide-demo-note" aria-labelledby="guide-demo-title"><h2 id="guide-demo-title">지금은 가상회사로 연습하는 시연판입니다.</h2>
      <p>기본 로컬 시연은 로그인 없이 사용하고, 서버를 종료하면 작업 데이터가 초기화됩니다. 공공 API는 기본적으로 샘플 응답을 사용하며 실제 공공자료를 조회해도 가상회사의 거래와 구분합니다. 실제 세금 신고나 완전한 회계기준 준수를 인증하는 서비스는 아닙니다.</p>
    </section>
  </div>;
}
