import {useId,useRef,useState} from 'react';
import '../styles/beginner-guide.css';

const repositoryUrl='https://github.com/osh3772-star/ledgerflow-ai';
const downloadCommands=`git clone https://github.com/osh3772-star/ledgerflow-ai.git
cd ledgerflow-ai`;
const startCommands=`pnpm install --frozen-lockfile
pnpm start`;
const roleRequest=`이 프로젝트의 docs/CLIENT_ROLES.md와 ledgerflow-sales 스킬을 확인하고 현재 대화에서 매출 역할을 사용해 줘.
현재 프로젝트의 get_system_status와 get_company_context를 실제 호출해 회사 이름과 연결 결과를 알려줘.
스킬이나 도구를 찾지 못하면 찾지 못했다고 알려줘.
거래 생성·승인·장부 반영과 병렬 에이전트 실행은 하지 마.`;
const roles=[
  ['총괄','할 일과 처리 순서를 정리합니다.','supervisor'],
  ['매출','판매 증빙을 확인하고 매출 기록을 준비합니다.','sales'],
  ['매입','매입 증빙·거래처·중복 후보를 확인합니다.','purchase'],
  ['자금','은행 내역과 받을 돈·줄 돈을 맞춰 봅니다.','treasury'],
  ['결산','월말 수정 기록과 보고서·마감을 검토합니다.','closing'],
  ['감사','중복·증빙 누락·기간 오류를 점검합니다. 전표를 생성하거나 반영하지 않습니다.','audit'],
] as const;
const firstRequest=`현재 프로젝트의 get_system_status와 get_company_context로 연결과 회사 정보를 먼저 확인해 줘.
매출 역할로 2026년 1월의 미처리 매출 거래 1건을 찾아 증빙을 확인해 줘.
어떤 거래인지, 어떤 계정에 왜 기록하는지 회계 초보자도 이해할 수 있게 설명해 줘.
분개 초안 생성 → 검증 → 사용자 승인 요청까지 진행해 줘.
전표에 첨부된 공공자료의 실제/샘플 구분, 시행일, 조회 실패·제외 사유도 설명해 줘.
전표 ID, 버전, hash와 차변·대변 합계를 알려주고 사용자 승인 대기에서 멈춰 줘.
도구가 연결되지 않았거나 증빙이 부족하면 그 상태를 알려줘.`;
const monthRequest=`현재 프로젝트의 get_system_status와 get_company_context로 MCP 연결과 회사를 먼저 확인해 줘.
기존 ERP에 있는 2026-01-01~2026-01-31 미처리 거래를 모든 페이지에서 조회해 줘.
docs/CLIENT_ROLES.md에 따라 필요한 역할의 스킬을 현재 대화에서 순서대로 적용해 줘.
증빙과 공공 참고자료를 확인하고 분개 초안 생성 → 검증 → 사용자 승인 요청까지 준비해 줘.
이미 장부에 반영한 거래는 제외하고, 기존 초안이 있으면 먼저 확인해 중복을 피해 줘.
자료가 부족한 건은 검토 필요로 남겨 줘. 처리 건수, 검토 필요 건수, 전표별 ID·버전·hash·차변/대변 합계를 정리해 줘.
사용자 승인 대기에서 멈춰 줘. 병렬 하위 에이전트 실행과 회계기간 마감은 하지 마.`;
const monthPostRequest=`현재 프로젝트의 get_system_status와 get_company_context를 먼저 확인해 줘.
방금 준비한 2026년 1월 처리 목록 중 내가 사이트에서 승인한 전표만 대상으로 해 줘.
각 전표의 승인 상태·버전·hash를 다시 확인한 뒤 조건을 충족하는 전표를 장부에 반영해 줘.
DB에서 Posted를 확인한 전표와 미승인·반려·실패한 전표를 나눠 알려줘.
2026년 1월 시산표와 재무제표를 작성하고 남은 미처리 거래·결산 검토 항목을 보여 줘.
회계기간 마감은 별도로 요청할 때 진행해 줘.`;
const postRequest=`현재 프로젝트의 get_system_status와 get_company_context를 먼저 확인해 줘.
내가 사이트에서 승인한 전표 [전표 ID]의 승인 상태와 버전·hash를 다시 확인해 줘.
승인 조건이 맞으면 장부에 반영하고 DB 상태가 Posted인지 확인해 줘.
2026년 1월 시산표와 재무제표를 보여 주고 각 숫자가 무엇을 뜻하는지 쉽게 설명해 줘.
승인되지 않았거나 내용이 달라졌다면 이유를 알려주고 멈춰 줘.`;
const connectionRequest=`현재 프로젝트의 get_system_status와 get_company_context를 호출해서 연결 상태와 회사 이름을 알려줘.
실제 도구가 보이지 않거나 호출이 실패하면 연결되었다고 추정하지 말고 알려줘.
거래 생성, 승인, 장부 반영은 하지 마.`;

type GuideTarget='approval'|'reports'|'references';
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

function RequestBox({title,prompt,hint,destination='chat'}:{title:string;prompt:string;hint:string;destination?:'chat'|'terminal'}){
  const id=useId(),field=useRef<HTMLTextAreaElement>(null),[message,setMessage]=useState('');
  const isCommand=destination==='terminal';
  async function copy(){
    try{
      if(!navigator.clipboard?.writeText)throw new Error('CLIPBOARD_UNAVAILABLE');
      await navigator.clipboard.writeText(prompt);
      setMessage(isCommand?'복사했습니다. 터미널에 붙여 넣어 실행하세요.':'복사했습니다. 연결된 앱의 대화창에 붙여 넣으세요.');
    }catch{
      field.current?.focus();field.current?.select();
      setMessage('요청문을 선택했습니다. Ctrl+C 또는 기기의 복사 기능을 이용해 주세요.');
    }
  }
  return <div className={'guide-request-box'+(isCommand?' guide-command-box':'')}>
    <div className="guide-request-heading"><label htmlFor={id}>{title}</label><button type="button" className="guide-copy-button" onClick={()=>void copy()}>{isCommand?'명령어 복사':'요청문 복사'}</button></div>
    <textarea id={id} ref={field} readOnly rows={isCommand?prompt.split('\n').length+1:7} value={prompt} spellCheck={false} aria-describedby={id+'-hint'}/>
    <p id={id+'-hint'} className="guide-field-hint">{hint}</p>
    <p className="guide-copy-status" role="status">{message}</p>
  </div>;
}

function WorkflowGuideLinks(){
  return <section className="guide-workflow-entry" aria-labelledby="guide-workflow-title">
    <div><span className="guide-kicker">처음부터 끝까지 · 전체 안내서</span><h2 id="guide-workflow-title">내가 할 일과 AI가 할 일을 순서대로 확인하세요.</h2>
      <p>아래 빠른 시작에는 바로 보낼 요청문이 있습니다. 전체 안내서는 Google 로그인·앱 연결부터 전표 승인, 한 달 처리, 결산과 오류 복구까지 20단계로 설명합니다.</p></div>
    <a className="guide-workflow-primary" href="/workflow/">전체 워크플로우 읽기 →</a>
    <nav className="guide-workflow-topics" aria-label="전체 안내서의 주요 단계">
      <a href="/workflow/#section-6"><strong>01 · AI 앱 연결</strong><span>코덱스·클로드와 같은 계정 연결</span></a>
      <a href="/workflow/#section-8"><strong>02 · 첫 분개 요청</strong><span>기존 ERP 거래 한 건으로 시작</span></a>
      <a href="/workflow/#section-11"><strong>03 · 내가 직접 승인</strong><span>전표·증빙·금액을 보는 기준</span></a>
      <a href="/workflow/#section-15"><strong>04 · 보고서와 결산</strong><span>장부 반영 후 결과 확인</span></a>
    </nav>
  </section>;
}

function WorkflowCheckpoints(){
  const resumeRequest=`get_system_status와 get_company_context로 연결과 내 회사를 먼저 확인해 줘.
방금 작업한 거래 ID와 전표 ID를 기준으로 기존 초안·검증·승인·게시 상태를 조회해 줘.
새 초안을 곧바로 만들지 말고, 마지막으로 완료된 단계와 이어서 할 일부터 알려줘.
내가 사이트에서 승인하지 않은 전표는 게시하지 마. Posted는 DB 상태를 확인한 경우에만 보고해 줘.
기간·처리한 ID·남은 ID·실패 사유·다음 행동을 구조화 Result로 정리해 줘.`;
  return <section className="guide-section" aria-labelledby="guide-checkpoints-title">
    <span className="guide-kicker">진행 중 헷갈릴 때</span><h2 id="guide-checkpoints-title">거래가 있다고 장부에 반영된 것은 아닙니다.</h2>
    <p>시작할 자료는 미리 만든 가상 ERP 거래 1,000건입니다. 첫 요청은 이 중 1월 거래를 찾아 분개하는 일입니다. 새로운 거래를 먼저 만들 필요는 없습니다.</p>
    <ol className="guide-checkpoints">
      <li><strong>거래·증빙</strong><span>회사의 일을 설명하는 원천 자료</span></li>
      <li><strong>초안·검증</strong><span>어떤 계정에 기록할지 준비·검사</span></li>
      <li><strong>사용자 승인</strong><span>내가 사이트에서 내용 확인·결정</span></li>
      <li><strong>장부 반영 완료</strong><span lang="en">Posted</span><span>이 상태의 전표만 보고서에 집계</span></li>
    </ol>
    <details className="guide-details"><summary>승인 전에 무엇을 봐야 하나요?</summary>
      <ul><li>앱이 설명한 거래·전표 ID, 버전, 내용 hash가 같은지 봅니다.</li><li>거래일·귀속 월, 계정과 금액, 차변·대변 합계를 증빙과 대조합니다.</li><li>공공자료의 출처·적용일과 조회 실패·제외 사유, 회계 판단의 가정·불확실성을 확인합니다.</li><li>이해가 안 되면 먼저 설명을 요청합니다. 틀리면 반려하고, 맞으면 사이트에서 직접 승인합니다.</li></ul>
      <p>AI 앱의 ‘도구 실행 허용’은 전표 승인이 아닙니다. 승인 후에는 앱에 장부 반영을 따로 요청합니다.</p>
      <a href="/workflow/#section-11">전체 승인 체크리스트 →</a>
    </details>
    <details className="guide-details"><summary>반영했는데 보고서가 비어 있거나 숫자가 예상과 다르면?</summary>
      <p>앱에 전표의 DB 상태가 Posted인지 먼저 확인하게 하세요. 사이트에서 해당 월을 선택하고 새로고침합니다. 시산표는 계정별 기록, 재무상태표는 기준일까지 쌓인 자산·부채·자본, 손익계산서는 선택 기간의 수익·비용을 보여줍니다.</p>
      <p>승인 대기·미게시 전표는 보고서에 포함되지 않습니다. 실제 장부 전표와 연결된 거래를 확인한 뒤 차이를 설명하게 하세요.</p>
      <a href="/workflow/#section-13">숫자가 이어지는 매출 분개 예제 →</a>
    </details>
    <details className="guide-details"><summary>앱이 멈추거나 승인 내용이 바뀌었다면?</summary>
      <p>같은 작업을 처음부터 반복하기 전에 기존 전표와 승인 상태부터 확인합니다. 내용 hash가 달라졌으면 이전 승인을 재사용할 수 없습니다. 이미 게시한 전표의 정정은 역분개 절차를 검토하며, 게시 기록을 덮어쓰지 않습니다.</p>
      <RequestBox title="중단한 작업 상태 확인 · 안전하게 이어가기" prompt={resumeRequest} hint="기간이나 거래·전표 ID를 알고 있다면 함께 적어 주세요. 이 요청은 사용자의 승인을 대신하지 않습니다."/>
      <a href="/workflow/#section-18">오류별 해결·재개 방법 →</a>
    </details>
  </section>;
}

export function GuideWelcome({onOpen}:{onOpen:()=>void}){
  return <section className="guide-welcome" aria-labelledby="guide-welcome-title">
    <div><span className="guide-kicker">어디서 시작하나요?</span><h2 id="guide-welcome-title">ERP에 있는 1월 거래를 앱에 분개해 달라고 요청하세요.</h2>
      <p>연습용 거래 1,000건은 이미 준비되어 있습니다. 코덱스·클로드 코드에 초안 작성을 요청하고, 사이트에서 승인한 뒤 앱에 장부 반영을 요청합니다. 복사용 월별 요청문과 연결 안내를 확인하세요.</p></div>
    <button type="button" className="guide-primary-button" onClick={onOpen}>사용 방법과 제작 목적 보기 <span aria-hidden="true">→</span></button>
  </section>;
}

function HostedBeginnerGuide({onNavigate}:{onNavigate:(target:GuideTarget)=>void}){
  const remoteMonth=monthRequest.replace('현재 프로젝트의','연결된 MCP 서버의').replace('docs/CLIENT_ROLES.md에 따라 필요한 역할의 스킬을 현재 대화에서 순서대로 적용해 줘.','서버가 제공하는 총괄·매출·매입·자금·결산·감사 중 필요한 역할 지침을 현재 대화에서 순서대로 적용해 줘.');
  return <div className="beginner-guide">
    <WorkflowGuideLinks/>
    <section className="guide-intro"><span className="guide-kicker">설치 없는 원격 사용 안내</span><h2>사이트에서 내 장부를 열고, AI 앱에 연결하세요.</h2>
      <p>상단 ‘로그인·시작하기’를 열어 ‘Google로 계속하기’로 시작합니다. Google 버튼이 준비 중이면 운영자의 연결 설정이 필요합니다. ‘공개 샘플 조회 모드’에서는 공통 예시만 읽을 수 있습니다.</p>
      <ol className="guide-steps">
        <li><span className="guide-step-number">1</span><div><h3>Google로 내 장부 열기</h3><p>‘Google로 계속하기’를 누르고 사용할 Google 계정을 선택하세요. 처음 로그인하면 별도 가상회사와 원천 거래 1,000건이 준비됩니다. 별도 사이트 비밀번호나 가입 확인메일은 필요 없습니다.</p></div></li>
        <li><span className="guide-step-number">2</span><div><h3>내 AI 앱에 MCP 주소 추가</h3><p>상단 ‘AI 연결·계정 관리’의 주소를 Codex 또는 Claude Code의 원격 HTTP MCP 설정에 추가합니다. 브라우저가 열리면 이 사이트의 같은 계정으로 로그인하고 연결을 허용하세요. 서버·Node.js·DB·공공 API 키를 PC에 설치할 필요는 없습니다.</p></div></li>
        <li><span className="guide-step-number">3</span><div><h3>연결된 앱에서 분개 요청</h3><p>아래 요청문을 AI 앱에 보내세요. 사이트가 AI 추론을 실행하지는 않습니다. 이미 사용 중인 앱과 본인 이용 계정이 필요합니다.</p></div></li>
        <li><span className="guide-step-number">4</span><div><h3>이 사이트에서 직접 승인</h3><p>새로고침 → 사용자 승인 → 전표 보기에서 증빙·금액·근거를 확인하세요. AI에게 승인 버튼을 대신 누르게 하지 않습니다.</p><button className="guide-link-button" onClick={()=>onNavigate('approval')}>사용자 승인 열기 →</button></div></li>
        <li><span className="guide-step-number">5</span><div><h3>앱에 장부 반영 요청</h3><p>두 번째 요청문을 보내면 승인 상태와 hash를 다시 확인한 전표만 반영합니다. 이후 재무 보고서에서 결과를 확인하세요.</p><button className="guide-link-button" onClick={()=>onNavigate('reports')}>재무 보고서 열기 →</button></div></li>
      </ol>
    </section>
    <section className="guide-section"><h2>먼저 매출 한 건으로 연습하세요.</h2>
      <RequestBox title="첫 요청 · 분개 초안부터 승인 대기까지" prompt={firstRequest.replace('현재 프로젝트의','연결된 MCP 서버의')} hint="연결을 허용한 Codex·Claude의 대화창에 붙여 넣으세요. 웹에서 직접 승인하기 전에는 장부에 반영되지 않습니다."/>
      <RequestBox title="두 번째 요청 · 내가 직접 승인한 뒤" prompt={postRequest.replace('현재 프로젝트의','연결된 MCP 서버의')} hint="[전표 ID]는 앱이 알려준 ID로 바꾸세요. 웹과 AI 연결이 같은 계정인지 확인하세요."/>
    </section>
    <section className="guide-section"><h2>한 달 전체를 정리하려면</h2>
      <RequestBox title="2026년 1월 기존 ERP 거래 정리" prompt={remoteMonth} hint="한 건의 흐름을 확인한 뒤 사용하세요. 이미 게시한 거래는 다시 처리하지 않습니다."/>
      <RequestBox title="1월 중 내가 승인한 전표만 반영" prompt={monthPostRequest.replace('현재 프로젝트의','연결된 MCP 서버의')} hint="월말 수정분개·기간 마감은 별도 작업이며 사용자 승인이 필요합니다."/>
    </section>
    <WorkflowCheckpoints/>
    <section className="guide-section"><h2>회계 역할 여섯 개는 어떻게 쓰나요?</h2><p>서버가 여섯 역할의 지침과 MCP 프롬프트를 제공합니다. 필요한 역할을 현재 앱 대화에서 선택합니다. 서버 연결이 앱에 스킬 파일을 자동 설치하거나 독립 에이전트 여섯 개를 자동 실행하지는 않습니다.</p>
      <div className="guide-role-table"><table><thead><tr><th>역할</th><th>업무</th><th>서버 프롬프트</th></tr></thead><tbody>{roles.map(([label,work,role])=><tr key={role}><td>{label}</td><td>{work}</td><td><code>{'ledgerflow-'+role}</code></td></tr>)}</tbody></table></div>
      <p>역할 정의·SDK 테스트와 실제 앱 실행은 구분합니다. 실제 사용 결과는 역할별 Result와 도구 호출 기록으로 확인합니다. 역할 이름이 승인 권한을 주지는 않습니다.</p>
    </section>
    <section className="guide-section"><h2>공공 API와 다른 사람의 장부</h2><p>로그인한 원격 장부의 자료 조회·분개 요청은 서버에 보관된 운영자 키와 공통 캐시로 공공자료를 조회합니다. 방문자에게 키를 배포하지 않습니다. 국세청은 실제 사업자번호가 없는 합성 거래처를 제외하며, DART·거래일 법령·ECOS 자료는 참고 근거입니다. 실패·샘플 출처를 실제 성공으로 표시하지 않습니다.</p><p>개인 장부의 거래·초안·승인·게시 결과는 계정별 회사로 분리됩니다. 로그인 전의 공개 샘플은 모두에게 같은 읽기 전용 자료입니다. A의 분개나 승인은 B의 장부나 공개 샘플을 바꾸지 않습니다.</p></section>
    <section className="guide-section"><h2>왜 만들었나요?</h2><p>가상 도소매 회사의 거래가 증빙 확인·분개·검증·승인을 거쳐 장부와 재무제표로 이어지는 과정을 직접 연습하기 위한 취업 포트폴리오입니다. 반복 계산은 코드가, 자료 해석과 설명은 AI가, 최종 승인은 사람이 맡습니다.</p><dl className="guide-glossary">{glossary.map(([term,description])=><div key={term}><dt>{term}</dt><dd>{description}</dd></div>)}</dl></section>
    <section className="guide-demo-note"><h2>가상회사 연습용 서비스입니다.</h2><p>실제 은행·세금계산서 수집이나 법정 신고 서비스가 아닙니다. 공공자료는 합성 장부와 구분하며 완전한 K-IFRS 준수 인증을 주장하지 않습니다.</p><a href={repositoryUrl+'/blob/main/docs/GETTING_STARTED.md'} target="_blank" rel="noopener noreferrer">GitHub 사용 안내 ↗</a><p>개발·로컬 실행이 필요한 경우 저장소의 별도 로컬 설치 절차를 이용하세요.</p></section>
  </div>;
}

export default function BeginnerGuide({onNavigate,hosted=false}:{onNavigate:(target:GuideTarget)=>void;hosted?:boolean}){
  if(hosted)return <HostedBeginnerGuide onNavigate={onNavigate}/>;
  return <div className="beginner-guide">
    <WorkflowGuideLinks/>
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

    <section className="guide-section" aria-labelledby="guide-month-title">
      <div className="guide-section-heading"><span className="guide-kicker">설치·MCP 연결을 마쳤다면 여기서 시작</span><h2 id="guide-month-title">기존 ERP의 2026년 1월 거래부터 분개를 요청하세요.</h2></div>
      <p>기본 시연의 한빛유통에는 1년치 <strong>가상 원천 거래 1,000건</strong>이 들어 있습니다. 새로 거래를 입력하지 않고 그중 1월분을 정리하면 됩니다. 원천 거래가 있다는 것과 회계 장부에 반영되었다는 것은 다른 상태입니다.</p>
      <div className="guide-role-table"><table><thead><tr><th>지금 있는 것</th><th>앱이 준비할 것</th><th>승인·장부 반영 후 생기는 것</th></tr></thead><tbody><tr><td>ERP의 매출·매입·입출금·급여 등 원천 거래와 증빙</td><td>거래별 분개 초안, 검증 결과, 승인 요청</td><td>장부에 반영된 전표와 그 금액을 집계한 원장·시산표·재무제표</td></tr></tbody></table></div>
      <ol className="guide-steps">
        <li><span className="guide-step-number" aria-hidden="true">1</span><div><h3>코덱스 또는 클로드 코드에 요청</h3><p>서버를 켜 둔 상태에서 이 프로젝트의 앱 대화창에 아래 첫 요청문을 보냅니다. ‘1월’은 샘플 자료의 연도인 2026년 1월입니다.</p></div></li>
        <li><span className="guide-step-number" aria-hidden="true">2</span><div><h3>사이트에서 전표를 직접 승인</h3><p>‘새로고침 → 사용자 승인 → 전표 보기’에서 증빙·금액·근거를 검토합니다. 맞는 전표는 승인하고 수정이 필요한 전표는 반려합니다.</p><button type="button" className="guide-link-button" onClick={()=>onNavigate('approval')}>사용자 승인 화면 열기 →</button></div></li>
        <li><span className="guide-step-number" aria-hidden="true">3</span><div><h3>앱에 승인한 전표의 장부 반영 요청</h3><p>검토를 마치면 같은 대화창에 두 번째 요청문을 보냅니다. 승인만 누른 상태에서는 장부에 반영되지 않습니다.</p></div></li>
        <li><span className="guide-step-number" aria-hidden="true">4</span><div><h3>1월 보고서 확인</h3><p>앱이 ‘장부 반영 완료’를 확인한 뒤 ‘재무 보고서’에서 2026-01을 선택하고 새로고침합니다. 반영한 전표만 금액에 포함됩니다.</p><button type="button" className="guide-link-button" onClick={()=>onNavigate('reports')}>재무 보고서 열기 →</button></div></li>
      </ol>
      <RequestBox title="첫 요청 · 기존 ERP의 1월 거래를 승인 대기까지" prompt={monthRequest} hint="이 문장은 사이트 입력란이 아닌 코덱스·클로드 코드의 프로젝트 대화창에 보냅니다. 월 전체 분개 초안을 준비하는 요청이며, 지금 이 설명 화면이 거래를 처리하는 것은 아닙니다."/>
      <RequestBox title="두 번째 요청 · 사이트에서 직접 승인한 뒤" prompt={monthPostRequest} hint="같은 대화에서 첫 요청의 처리 목록을 이어 사용합니다. 승인하지 않은 전표는 장부에 반영할 수 없습니다."/>
      <p><strong>1월 거래의 분개와 월말 결산·기간 마감은 별개입니다.</strong> 감가상각·선급비용 등 결산 수정분개도 검토와 사용자 승인이 필요합니다. 먼저 기존 거래를 처리하고 앱이 알려 주는 남은 결산 항목을 확인하세요. 처음에는 아래의 매출 1건 연습으로 흐름을 익혀도 됩니다.</p>
    </section>

    <section className="guide-section" aria-labelledby="guide-why-title">
      <div className="guide-section-heading"><span className="guide-kicker">이 사이트를 만든 이유</span><h2 id="guide-why-title">거래가 장부와 보고서가 되는 과정을 보여주기 위해서입니다.</h2></div>
      <p>회계는 거래를 입력하는 데서 끝나지 않습니다. 근거 자료를 확인하고, 기록이 맞는지 검증하고, 승인된 내용을 모아 회사의 상태를 이해해야 합니다. 이 과정을 가상회사의 거래로 직접 따라갈 수 있도록 만들었습니다.</p>
      <p>반복 계산과 검사는 코드가 맡고, 인공지능은 자료 정리와 설명을 돕고, 최종 결정은 사람이 합니다. <strong>회계 업무 이해와 인공지능 도구 연동·웹·데이터베이스 개발 역량을 함께 보여주기 위한 취업 포트폴리오</strong>입니다.</p>
      <div className="guide-principles"><span>가상 거래 1,000건으로 연습</span><span>계산·검증은 규칙 엔진</span><span>장부 반영 전 사용자 승인</span></div>
    </section>

    <section className="guide-section" aria-labelledby="guide-install-title">
      <div className="guide-section-heading"><span className="guide-kicker">다른 사람에게 공유하거나 새 PC에서 시작할 때</span><h2 id="guide-install-title">공개 저장소에서 받아, 내 PC에서 실행하세요.</h2></div>
      <p>다른 사람에게는 아래 <strong>GitHub 저장소 링크</strong>를 보내세요. 처음 설치하는 사람도 저장소의 설치 안내를 먼저 읽을 수 있습니다. <code>127.0.0.1</code>은 각자의 PC를 뜻하므로, 지금 사이트 주소를 보내는 것만으로 상대방이 접속할 수는 없습니다.</p>
      <div className="guide-share-links"><a href={repositoryUrl} target="_blank" rel="noopener noreferrer">공개 저장소 열기 ↗</a><a href={repositoryUrl+'/blob/main/docs/GETTING_STARTED.md'} target="_blank" rel="noopener noreferrer">처음 설치하는 사람의 안내서 ↗</a></div>
      <p className="guide-repository-url"><a href={repositoryUrl} target="_blank" rel="noopener noreferrer">{repositoryUrl}</a></p>
      <details className="guide-details"><summary>처음이라면 필요한 프로그램부터 준비하세요</summary>
        <ul className="guide-setup-list"><li><a href="https://nodejs.org/en/download" target="_blank" rel="noopener noreferrer">Node.js 공식 다운로드</a>에서 <strong>24.x</strong>를 설치합니다. 이 프로젝트의 실행 환경입니다.</li>
          <li><a href="https://git-scm.com/downloads" target="_blank" rel="noopener noreferrer">Git 공식 다운로드</a>에서 운영체제에 맞게 설치합니다. 아래 저장소 받기 명령에 사용합니다.</li>
          <li>설치 후 터미널을 새로 열고 아래 명령으로 <strong>pnpm 11.25.0</strong>을 준비합니다. 터미널은 명령어를 입력하는 창이며 Windows에서는 PowerShell을 사용할 수 있습니다.</li></ul>
        <RequestBox title="터미널 · 실행 도구 준비 및 버전 확인" prompt={'npm install --global pnpm@11.25.0\nnode --version\npnpm --version'} destination="terminal" hint="Node는 v24.x, pnpm은 11.25.0인지 확인하세요. 이미 맞는 버전이 있으면 재설치할 필요가 없습니다. 명령 복사만으로 설치되지 않습니다."/>
        <p>Claude Code 또는 Codex 중 하나를 설치하고 본인 계정으로 로그인합니다. 앱별 설치 도움말은 아래에 있습니다. 이 프로젝트는 별도 유료 모델 API 키를 요구하지 않으며, 앱의 이용 가능 여부와 사용 한도는 본인 계정에 따릅니다.</p>
      </details>
      <h3 className="guide-install-step">1. 프로젝트 전체 받기</h3>
      <RequestBox title="터미널 · 저장소 받기" prompt={downloadCommands} destination="terminal" hint="프로젝트를 저장할 폴더에서 실행하세요. 처음 받는 PC용입니다. 이미 받은 사람은 기존 폴더를 열면 됩니다. 숨김 폴더인 .codex·.claude·.agents도 함께 받아야 합니다."/>
      <h3 className="guide-install-step">2. 서버 한 번 실행하기</h3>
      <RequestBox title="터미널 · 설치 후 실행" prompt={startCommands} destination="terminal" hint="방금 받은 ledgerflow-ai 폴더에서 실행합니다. 처음에는 패키지 다운로드가 필요합니다. 서버가 준비되면 이 터미널을 켜 둔 채 브라우저와 앱을 사용하세요."/>
      <p>준비 완료 후 브라우저에서 <code>http://127.0.0.1:8787/</code>을 엽니다. 웹 화면과 두 앱은 <strong>같은 서버 한 개</strong>를 사용합니다. 종료할 때는 서버 터미널에 <code>stop</code>을 입력하고 Enter를 누르세요.</p>
      <div className="guide-install-note"><strong>기본 체험은 API 키·Supabase·Docker 준비 없이 가능합니다.</strong><p>가상 거래 1,000건과 샘플 공공자료로 시작합니다. PostgreSQL은 프로젝트가 임시로 실행합니다. 공유할 때 자신의 <code>.env.local</code>이나 API 키를 보내지 마세요. 실제 공공자료 조회와 장부 영구 보관은 별도 설정입니다.</p></div>
    </section>

    <section className="guide-section" aria-labelledby="guide-connect-title">
      <div className="guide-section-heading"><span className="guide-kicker">3. 앱 연결 · 서버를 켠 다음 진행하세요</span><h2 id="guide-connect-title">사용 중인 앱 하나에서 이 프로젝트를 여세요.</h2></div>
      <p>사이트가 열렸다면 웹 서버는 실행 중입니다. 다음으로 앱이 같은 회계 도구에 연결되어 있는지 확인합니다. 두 앱을 모두 사용할 필요는 없습니다.</p>
      <div className="guide-app-grid">
        <article><h3><AppName english="Claude Code" korean="클로드 코드"/></h3><p>서버와 다른 터미널에서 같은 프로젝트 폴더를 열고 <code>claude</code>로 시작합니다. 프로젝트 신뢰와 기존 <code>.mcp.json</code>의 연결을 허용한 뒤, 대화창에서 <code>/mcp</code>로 확인하세요.</p><div className="guide-app-links"><a href="https://code.claude.com/docs/en/setup" target="_blank" rel="noopener noreferrer">앱 설치 도움말 ↗</a><a href="https://code.claude.com/docs/en/mcp" target="_blank" rel="noopener noreferrer">회계 도구 연결 도움말 ↗</a></div><p className="guide-app-detail">일반 클로드 대화창이나 클로드 데스크톱의 설치만으로 이 프로젝트가 연결되는 것은 아닙니다. 여기서는 클로드 코드를 사용합니다.</p></article>
        <article><h3><AppName english="Codex" korean="코덱스"/></h3><p>로컬 Codex에서 받은 <code>ledgerflow-ai</code> 폴더를 프로젝트로 열고 신뢰합니다. 기존 <code>.codex/config.toml</code>의 서버를 확인하고, 도구가 보이지 않으면 설정에서 연결을 재시작한 뒤 새 대화에서 확인하세요.</p><div className="guide-app-links"><a href="https://learn.chatgpt.com/docs/quickstart?setup=app" target="_blank" rel="noopener noreferrer">앱 시작 도움말 ↗</a><a href="https://learn.chatgpt.com/docs/extend/mcp" target="_blank" rel="noopener noreferrer">회계 도구 연결 도움말 ↗</a></div><p className="guide-app-detail">프로젝트를 신뢰해야 해당 설정을 읽습니다. 일반 웹 대화창이 PC의 서버와 설정을 자동으로 읽는 것은 아닙니다.</p></article>
      </div>
      <details className="guide-details"><summary>앱 연결 확인용 문장과 서버 정보 보기</summary>
        <p>서버 이름은 <code>ledgerflow-accounting-mcp</code>, 주소는 <code>http://127.0.0.1:8787/mcp</code>입니다. 프로젝트에는 기존 연결 설정이 있습니다. 새 서버를 중복으로 만들지 않고 그 연결을 사용합니다.</p>
        <RequestBox title="앱에 연결 확인 요청하기" prompt={connectionRequest} hint="앱이 실제 도구를 호출한 결과로 확인합니다. 이 화면에서 연결 성공을 대신 판정하지 않습니다."/>
      </details>
    </section>

    <section className="guide-section" aria-labelledby="guide-agents-title">
      <div className="guide-section-heading"><span className="guide-kicker">4. 회계 역할 사용하기</span><h2 id="guide-agents-title">6개 역할은 프로젝트에 이미 들어 있습니다.</h2></div>
      <p>에이전트는 회계 담당 역할이고, 스킬은 그 역할이 따를 업무 지침입니다. 저장소에 앱별 파일이 포함되어 있으므로 별도의 에이전트 서버나 유료 모델 API를 설치하지 않습니다. 프로젝트를 열어 스킬이 표시되는지 확인하고 필요한 역할 하나부터 사용하세요.</p>
      <div className="guide-role-table"><table><thead><tr><th>역할</th><th>도와주는 일</th><th>스킬 이름</th></tr></thead><tbody>{roles.map(([label,work,role])=><tr key={role}><td>{label}</td><td>{work}</td><td><code>{'ledgerflow-'+role}</code></td></tr>)}</tbody></table></div>
      <div className="guide-app-grid"><article><h3>클로드 코드에서 선택</h3><p>대화창에 <code>/ledgerflow-sales</code>를 입력하면 매출 스킬을 요청할 수 있습니다. 스킬 목록에서 이름을 확인하세요.</p><a href="https://code.claude.com/docs/en/skills" target="_blank" rel="noopener noreferrer">공식 스킬 사용 안내 ↗</a></article>
        <article><h3>코덱스에서 선택</h3><p>대화창에서 <code>$ledgerflow-sales</code>로 매출 스킬을 지정하거나 스킬 선택 메뉴에서 고르세요. 보이지 않으면 프로젝트 폴더와 스킬 목록을 확인하고 앱을 다시 여세요.</p><a href="https://learn.chatgpt.com/docs/build-skills" target="_blank" rel="noopener noreferrer">공식 스킬 사용 안내 ↗</a></article></div>
      <RequestBox title="두 앱 공통 · 역할과 연결 확인하기" prompt={roleRequest} hint="매출 역할만 확인하는 요청입니다. 역할 파일이 포함됐다는 것과 앱에서 실제로 발견·호출됐다는 것은 구분해서 확인하세요."/>
      <details className="guide-details"><summary>포함된 설정 파일과 역할 파일 위치</summary><dl className="guide-glossary"><div><dt>클로드 코드</dt><dd><code>.mcp.json</code> · <code>.claude/skills/</code> · <code>.claude/agents/</code></dd></div><div><dt>코덱스</dt><dd><code>.codex/config.toml</code> · <code>.agents/skills/</code> · <code>.codex/agents/</code></dd></div></dl><p>기본 사용은 현재 대화에서 필요한 스킬을 적용하는 방식입니다. 별도 하위 에이전트에 위임하거나 병렬로 실행하는 것은 사용자가 명시적으로 요청할 때만 진행합니다. 역할 선택이 승인 권한을 주지는 않습니다.</p></details>
    </section>

    <section className="guide-section" aria-labelledby="guide-steps-title">
      <div className="guide-section-heading"><span className="guide-kicker">선택 · 처음이라면 매출 한 건으로 연습</span><h2 id="guide-steps-title">월 전체 요청 전에 한 건만 체험해도 됩니다.</h2></div>
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

    <WorkflowCheckpoints/>
    <section className="guide-section" aria-labelledby="guide-public-title">
      <div className="guide-section-heading"><span className="guide-kicker">공공자료는 어디에 쓰이나요?</span><h2 id="guide-public-title">분개할 때 확인할 참고 근거를 함께 가져옵니다.</h2></div>
      <p>‘공공자료’ 메뉴에서 거래를 골라 조회하거나 앱에 분개 초안을 요청하세요. DART 공시기업 재무정보, 거래일에 맞는 세법 조문, 한국은행 금리 자료를 모아 보여줍니다. 새 전표에는 그때 확인한 자료가 승인 내용에 포함됩니다. 조회에 실패하면 ‘확인 필요’, 샘플 모드이면 ‘샘플 자료’로 표시합니다.</p>
      <p>가상 거래처에는 실제 사업자번호가 없으므로 국세청 자동 검증은 생략합니다. 실제 사업자번호를 지정해 별도로 조회할 수 있습니다. 공시기업의 매출은 우리 회사 매출이 아니며, 법령·금리 조회만으로 세액이나 분개 금액을 확정하지 않습니다.</p>
      <button type="button" className="guide-link-button" onClick={()=>onNavigate('references')}>거래별 공공자료 확인 →</button>
      <details className="guide-details"><summary>다른 사람이 설치하면 공공 API도 바로 연결되나요?</summary><p>저장소에는 MCP·역할·스킬과 공공자료 연동 코드가 들어 있습니다. 기본 설치는 키가 필요 없는 샘플 모드입니다. 운영자가 공유 중계 서버를 배포한 경우, 전달받은 중계 주소와 전용 접속 토큰을 내 PC의 <code>.env.local</code>에 설정하고 서버를 다시 시작하면 운영자의 공공자료 연동을 이용합니다. 원본 공공 API 키 4개를 받을 필요는 없습니다.</p><p>공유 서버가 없거나 접속 설정을 받지 않았다면 자동 실조회가 되지 않습니다. 본인의 API 키 4개를 등록하고 <code>pnpm api:live</code>로 직접 조회 모드를 켤 수도 있습니다. 접속 토큰·API 키·DB 비밀번호는 GitHub에 올리지 마세요.</p><a href={repositoryUrl+'/blob/main/docs/PUBLIC_GATEWAY.md'} target="_blank" rel="noopener noreferrer">공유 공공자료 연결 안내 ↗</a></details>
    </section>

    <section className="guide-section" aria-labelledby="guide-terms-title">
      <div className="guide-section-heading"><span className="guide-kicker">어려운 말은 여기서 확인</span><h2 id="guide-terms-title">처음 만나는 회계 용어</h2></div>
      <dl className="guide-glossary">{glossary.map(([term,description])=><div key={term}><dt>{term}</dt><dd>{description}</dd></div>)}</dl>
      <details className="guide-details"><summary>거래는 있는데 재무 보고서는 ‘장부 반영 전’인 이유</summary><p>거래 목록은 연습할 원천 자료이고, 재무 보고서는 장부에 반영된 전표의 집계입니다. 장부 기록이 없으면 금액 대신 대기 상태를 표시합니다. 첫 거래의 초안·검증·승인·반영을 진행하고 새로고침하면 보고서가 표시됩니다.</p></details>
    </section>

    <section className="guide-demo-note" aria-labelledby="guide-demo-title"><h2 id="guide-demo-title">지금은 가상회사로 연습하는 시연판입니다.</h2>
      <p>화면의 가상 한국회사는 <strong>한빛유통 주식회사</strong>입니다. 처음부터 있는 거래 1,000건은 분개와 결산을 연습하도록 미리 준비한 샘플이며 실제 영업 내역이 아닙니다. 거래가 조회된다고 장부 반영까지 끝난 것은 아닙니다.</p>
      <p>기본 로컬 시연은 로그인 없이 사용하고, 서버를 종료하면 작업 데이터가 초기화됩니다. 공공자료 연결 모드는 개요·공공자료 메뉴에 표시됩니다. 처음 설치한 PC는 샘플 모드이며 실조회 또는 공유 중계 연결을 설정할 수 있습니다. 실제 공공자료도 가상회사의 거래와 구분합니다. 실제 세금 신고나 완전한 회계기준 준수를 인증하는 서비스는 아닙니다.</p>
    </section>
  </div>;
}
