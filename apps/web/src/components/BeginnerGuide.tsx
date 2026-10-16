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
전표 ID, 버전, hash와 차변·대변 합계를 알려주고 사용자 승인 대기에서 멈춰 줘.
도구가 연결되지 않았거나 증빙이 부족하면 그 상태를 알려줘.`;
const postRequest=`현재 프로젝트의 get_system_status와 get_company_context를 먼저 확인해 줘.
내가 사이트에서 승인한 전표 [전표 ID]의 승인 상태와 버전·hash를 다시 확인해 줘.
승인 조건이 맞으면 장부에 반영하고 DB 상태가 Posted인지 확인해 줘.
2026년 1월 시산표와 재무제표를 보여 주고 각 숫자가 무엇을 뜻하는지 쉽게 설명해 줘.
승인되지 않았거나 내용이 달라졌다면 이유를 알려주고 멈춰 줘.`;
const connectionRequest=`현재 프로젝트의 get_system_status와 get_company_context를 호출해서 연결 상태와 회사 이름을 알려줘.
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

export function GuideWelcome({onOpen}:{onOpen:()=>void}){
  return <section className="guide-welcome" aria-labelledby="guide-welcome-title">
    <div><span className="guide-kicker">처음 방문하셨나요?</span><h2 id="guide-welcome-title">회계를 몰라도, 거래 한 건부터 따라 해보세요.</h2>
      <p>앱에 말로 요청하고, 이 화면에서 확인한 뒤 승인합니다. 다른 PC의 설치·연결 방법과 이 사이트를 만든 이유도 함께 살펴보세요.</p></div>
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
      <details className="guide-details"><summary>거래는 있는데 재무 보고서는 ‘장부 반영 전’인 이유</summary><p>거래 목록은 연습할 원천 자료이고, 재무 보고서는 장부에 반영된 전표의 집계입니다. 장부 기록이 없으면 금액 대신 대기 상태를 표시합니다. 첫 거래의 초안·검증·승인·반영을 진행하고 새로고침하면 보고서가 표시됩니다.</p></details>
    </section>

    <section className="guide-demo-note" aria-labelledby="guide-demo-title"><h2 id="guide-demo-title">지금은 가상회사로 연습하는 시연판입니다.</h2>
      <p>화면의 가상 한국회사는 <strong>한빛유통 주식회사</strong>입니다. 처음부터 있는 거래 1,000건은 분개와 결산을 연습하도록 미리 준비한 샘플이며 실제 영업 내역이 아닙니다. 거래가 조회된다고 장부 반영까지 끝난 것은 아닙니다.</p>
      <p>기본 로컬 시연은 로그인 없이 사용하고, 서버를 종료하면 작업 데이터가 초기화됩니다. 공공 API는 기본적으로 샘플 응답을 사용하며 실제 공공자료를 조회해도 가상회사의 거래와 구분합니다. 실제 세금 신고나 완전한 회계기준 준수를 인증하는 서비스는 아닙니다.</p>
    </section>
  </div>;
}
