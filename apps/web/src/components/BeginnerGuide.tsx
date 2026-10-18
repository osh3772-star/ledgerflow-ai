import LearningStart,{PromptBox} from './LearningStart.js';
import learning from '../../../../docs/learning-start.json' with {type:'json'};
import '../styles/beginner-guide.css';

type GuideTarget='approval'|'reports'|'references';
const features=[
 ['거래 읽기','상품을 팔고, 사고, 돈을 주고받은 연습 거래와 증빙을 살펴봅니다.'],
 ['분개 배우기','거래가 어떤 계정에 기록되는지 AI의 설명과 초안을 함께 봅니다.'],
 ['오류 검사 이해하기','양쪽 금액 불일치, 중복, 빠진 증빙, 잘못된 기간을 어떻게 막는지 확인합니다.'],
 ['승인과 장부 반영','내가 기록을 검토하고 승인하면, AI에게 실제 장부 반영을 요청합니다.'],
 ['보고서 읽기','장부 기록이 시산표·재무상태표·손익계산서의 숫자로 이어지는 모습을 봅니다.'],
 ['공공자료 확인하기','국세청·DART·법령·한국은행 자료가 판단의 참고 근거로 쓰이는 방식을 봅니다.'],
] as const;
const roles=[['총괄','어떤 순서로 공부하고 처리할지 정리합니다.'],['매출','상품을 판 거래와 받을 돈을 살펴봅니다.'],
 ['매입','상품을 산 거래, 줄 돈과 증빙을 살펴봅니다.'],['자금','입출금이 받을 돈·줄 돈과 맞는지 확인합니다.'],
 ['결산','월말에 필요한 수정과 보고서를 준비합니다.'],['감사','중복·빠진 증빙·잘못된 기간을 찾아봅니다.']] as const;
const glossary=[['ERP','회사의 판매·구매·재고·입출금을 모아 둔 업무 자료입니다. 여기서는 모두 연습용입니다.'],
 ['증빙','거래가 있었다는 사실을 확인하는 세금계산서·계약서·입출금 내역 같은 자료입니다.'],
 ['분개','거래를 매출·예금·받을 돈 같은 알맞은 계정으로 나눠 적는 일입니다.'],
 ['전표','한 거래를 어떤 계정과 금액으로 기록할지 정리한 문서입니다.'],
 ['차변·대변','회계 기록의 왼쪽과 오른쪽입니다. 단순히 입금·출금을 뜻하지 않으며 두 쪽 합계가 같아야 합니다.'],
 ['전기','승인한 전표를 장부에 반영하는 일입니다. 이 사이트에서는 ‘장부 반영’이라고 안내합니다.'],
 ['시산표','계정마다 기록된 차변·대변과 잔액을 모아 확인하는 표입니다.'],
 ['재무제표','회사에 무엇이 있고 얼마나 빚졌는지, 얼마를 벌고 썼는지를 보여 주는 보고서입니다.']] as const;

export function GuideWelcome({onOpen}:{onOpen:()=>void}){
 return <section className="guide-welcome" aria-labelledby="guide-welcome-title"><div><span className="guide-kicker">회계 자동화와 회계 흐름을 배우는 학습 공간</span>
  <h2 id="guide-welcome-title">거래 한 건이 재무제표가 되는 과정을 직접 배워보세요.</h2>
  <p>코딩을 몰라도 괜찮아요. 가상회사 한빛유통의 거래 1,000건으로 AI에게 분개를 요청하고, 직접 승인한 뒤 장부와 보고서가 어떻게 바뀌는지 확인합니다.</p></div>
  <button type="button" className="guide-primary-button" onClick={onOpen}>처음 시작하기 · 요청문 복사 →</button></section>;
}

export default function BeginnerGuide({onNavigate,hosted=false}:{onNavigate:(target:GuideTarget)=>void;hosted?:boolean}){
 return <div className="beginner-guide">
  <section className="guide-intro"><span className="guide-kicker">한빛유통 · 회계 자동화 학습실</span>
   <h1>회계가 처음이어도,<br/>거래부터 보고서까지 따라갈 수 있어요.</h1>
   <p>이곳은 <strong>회계 자동화 기술과 회계의 흐름을 공부하고 싶은 사람</strong>을 위한 공간입니다. 가상 한국 도소매 회사의 자료를 가지고 ‘왜 이 계정에 적는지’, ‘왜 승인이 필요한지’, ‘보고서 숫자는 어디서 오는지’를 직접 확인합니다.</p>
   <div className="guide-principles"><span>코딩 지식 없이 시작</span><span>연습 거래 1,000건</span><span>AI가 설명하고 내가 확인</span></div>
  </section>
  <LearningStart/>
  {!hosted&&<p className="guide-local-note">지금은 PC에서 실행한 연습 화면입니다. 위 시작 요청문은 공개 사이트의 개인 장부에 연결합니다. 이 PC의 임시 연습을 이어가려면 현재 앱 연결을 유지하세요. 두 장부의 데이터는 서로 다릅니다.</p>}
  <section className="guide-section" aria-labelledby="guide-features-title"><span className="guide-kicker">준비가 끝나면</span><h2 id="guide-features-title">이런 과정을 직접 해볼 수 있어요.</h2>
   <div className="guide-feature-grid">{features.map(([title,description],i)=><article key={title}><span className="guide-role-icon">{String(i+1).padStart(2,'0')}</span><h3>{title}</h3><p>{description}</p></article>)}</div>
  </section>
  <section className="guide-section" aria-labelledby="guide-steps-title"><span className="guide-kicker">첫 학습 · 매출 한 건</span><h2 id="guide-steps-title">AI 대화창과 이 사이트를 오가며 공부합니다.</h2>
   <ol className="guide-steps">
    <li><span className="guide-step-number">1</span><div><h3>AI에게 한 건을 설명해 달라고 요청</h3><p>아래 ‘첫 거래 연습’ 요청문을 코덱스·클로드 코드 대화창에 보내세요. AI가 자료를 읽고 분개 초안과 검사 결과를 설명합니다.</p></div></li>
    <li><span className="guide-step-number">2</span><div><h3>사이트에서 내용 확인 후 직접 승인</h3><p>이 사이트로 돌아와 새로고침 → 사용자 승인 → 전표 보기를 누르세요. 거래일·계정·금액·증빙을 확인합니다. 이해가 안 되면 AI에게 먼저 물어보세요.</p><button className="guide-link-button" onClick={()=>onNavigate('approval')}>사용자 승인 열기 →</button></div></li>
    <li><span className="guide-step-number">3</span><div><h3>AI에게 장부에 반영해 달라고 요청</h3><p>직접 승인한 뒤 ‘승인 후 장부 반영’ 요청문을 보내세요. AI가 승인 여부를 다시 확인하고 반영합니다. 앱에서 도구 실행을 허용하는 것과 전표 승인은 다릅니다.</p></div></li>
    <li><span className="guide-step-number">4</span><div><h3>보고서에서 달라진 숫자 확인</h3><p>사이트를 새로고침하고 2026년 1월을 선택하세요. AI에게 그 숫자가 어떤 거래에서 왔는지 설명해 달라고 요청할 수 있습니다.</p><button className="guide-link-button" onClick={()=>onNavigate('reports')}>재무 보고서 열기 →</button></div></li>
   </ol>
   <PromptBox title="첫 거래 연습 · 연결된 AI 대화창에 보내세요" prompt={learning.firstRequest} hint="이미 준비된 거래를 사용합니다. 새 거래를 입력할 필요가 없어요. 이 단계는 승인 대기에서 멈춥니다."/>
   <PromptBox title="승인 후 장부 반영 · 사이트에서 직접 승인한 다음 보내세요" prompt={learning.postRequest} hint="아직 승인하지 않았다면 먼저 사이트에서 내용을 확인하세요."/>
  </section>
  <section className="guide-section" aria-labelledby="guide-records-title"><span className="guide-kicker">많이 헷갈리는 부분</span><h2 id="guide-records-title">거래 1,000건과 장부는 서로 다른 단계예요.</h2>
   <p>1,000건은 연습을 위해 미리 만든 거래·증빙입니다. 실제 회사나 은행에서 가져온 내역이 아닙니다. 처음에는 이 자료를 회계 기록으로 바꾸는 것부터 배웁니다.</p>
   <ol className="guide-checkpoints"><li><strong>거래·증빙</strong><span>어떤 일이 있었는지</span></li><li><strong>분개 초안·검사</strong><span>어떻게 기록할지</span></li><li><strong>내가 직접 승인</strong><span>내용이 맞는지</span></li><li><strong>장부 반영·보고서</strong><span>회사 숫자가 어떻게 바뀌는지</span></li></ol>
   <p>초안 작성이나 승인만으로 보고서 숫자가 바뀌지는 않습니다. <strong>장부 반영이 완료된 전표</strong>만 집계됩니다. 아직 반영한 것이 없으면 ‘장부 반영 전’으로 표시합니다.</p>
  </section>
  <section className="guide-section" aria-labelledby="guide-month-title"><span className="guide-kicker">한 건을 이해했다면</span><h2 id="guide-month-title">다음에는 한 달 전체로 넓혀보세요.</h2>
   <p>판매·구매·수금·지급이 섞인 1월 거래를 함께 살펴보세요. AI가 준비한 내용을 승인한 뒤에는 앞의 장부 반영 요청문을 그 처리 목록에 맞춰 사용하면 됩니다. 월말 수정과 기간 마감은 별도로 요청합니다.</p>
   <details className="guide-details"><summary>한 달 연습 요청문 펼치기</summary><PromptBox title="2026년 1월 거래 정리" prompt={learning.monthRequest} hint="정상 거래와 증빙이 부족한 거래를 구분해 보세요. AI가 임의로 전부 승인하지 않습니다."/></details>
  </section>
  <section className="guide-section" aria-labelledby="guide-roles-title"><h2 id="guide-roles-title">AI는 여섯 회계 역할을 필요에 따라 사용해요.</h2>
   <p>회계 업무를 나눠 이해하기 위한 역할입니다. 시작 설정에서 역할 파일을 준비하고, 공부할 거래에 필요한 역할을 현재 대화에서 순서대로 사용합니다. 여섯 AI가 항상 동시에 실행되는 것은 아닙니다.</p>
   <div className="guide-role-table"><table><thead><tr><th>역할</th><th>도와주는 일</th></tr></thead><tbody>{roles.map(([role,description])=><tr key={role}><td>{role}</td><td>{description}</td></tr>)}</tbody></table></div>
   <p>어떤 역할을 썼는지 궁금하면 ‘이번 작업에서 실제 사용한 역할과 도구를 알려줘’라고 물어보세요. 역할 이름이 보이는 것과 실제로 작업한 것은 구분합니다.</p>
  </section>
  <section className="guide-section" aria-labelledby="guide-reference-title"><h2 id="guide-reference-title">공공자료는 회계 판단의 참고 근거예요.</h2>
   <p>연결 후에는 사이트에 준비된 공공자료 조회 기능을 사용합니다. 별도 API 키를 받거나 입력할 필요가 없습니다. 관련 있는 자료만 조회하며 매 거래마다 네 기관을 모두 호출하지 않습니다.</p>
   <ul className="guide-reference-list"><li><strong>국세청:</strong> 실제 사업자번호가 있을 때 거래처 상태를 확인합니다. 지금의 가상 거래처는 실제 번호가 없어 조회를 제외합니다.</li>
    <li><strong>DART · 금융감독원:</strong> 공시기업의 재무·공시를 비교 참고자료로 봅니다. 그 기업의 매출이 내 장부에 들어오지는 않습니다.</li>
    <li><strong>국가법령정보:</strong> 거래일과 관련된 법령·시행일을 확인합니다. 조문을 찾았다고 회계·세무 판단이 확정되는 것은 아닙니다.</li>
    <li><strong>ECOS · 한국은행:</strong> 환율·기준금리·경제통계를 참고합니다. 조회한 금리가 모든 전표 금액에 반영되는 것은 아닙니다.</li></ul>
   <button className="guide-link-button" onClick={()=>onNavigate('references')}>공공자료 살펴보기 →</button>
   <p>자료의 출처·조회 시각과 ‘실제 조회 / 샘플 / 확인 필요 / 조회 제외’ 표시를 함께 읽어보세요.</p>
  </section>
  <section className="guide-section"><h2>자주 묻는 질문</h2>
   <details className="guide-details"><summary>다른 사람이 연습하면 내 장부도 바뀌나요?</summary><p>Google 계정마다 개인 장부가 따로 저장됩니다. 로그인 전에는 모두 같은 읽기 전용 예시를 봅니다. 개인 장부에서 한 분개·승인은 다른 계정의 장부나 공통 예시를 바꾸지 않습니다.</p></details>
   <details className="guide-details"><summary>설정은 됐다는데 AI가 거래를 못 읽어요.</summary><p>앱이 새 연결을 읽도록 학습 폴더를 열거나 연결을 다시 시작해야 할 수 있습니다. AI에게 ‘실제 연결과 내 회사를 확인해 줘. 아직 분개하지 마’라고 요청하세요. Google 로그인과 연결 허용이 남아 있으면 먼저 마칩니다. 파일만 준비됐다는 답은 연결 성공이 아닙니다.</p></details>
   <details className="guide-details"><summary>승인했는데 보고서가 그대로예요.</summary><p>승인 후 장부 반영 요청까지 했는지 확인하세요. AI에게 전표가 실제 반영 완료 상태인지 물어보고 사이트에서 해당 월을 선택한 뒤 새로고침하세요. 이미 반영한 전표를 중복으로 만들지 않습니다.</p></details>
   <details className="guide-details"><summary>추가 유료 AI API를 신청해야 하나요?</summary><p>이 프로젝트를 위해 별도 OpenAI·Gemini API 키를 만들지 않습니다. 사용하는 코덱스·클로드 코드의 계정과 이용 한도는 필요합니다. 사이트와 AI 앱 모두 무제한 사용을 보장하지는 않습니다.</p></details>
  </section>
  <section className="guide-section"><h2>처음 보는 회계 용어</h2><dl className="guide-glossary">{glossary.map(([term,description])=><div key={term}><dt>{term}</dt><dd>{description}</dd></div>)}</dl></section>
  <section className="guide-demo-note"><h2>왜 이 사이트를 만들었나요?</h2><p>회계 책에서 본 분개가 실제로 어떻게 장부와 보고서로 이어지는지, AI가 어떤 부분을 돕고 사람이 무엇을 확인해야 하는지 직접 배우기 위해 만들었습니다. 반복 계산과 규칙 검사는 코드가 수행하고 AI는 자료 검토와 설명을 돕습니다.</p>
   <p>가상회사 학습용입니다. 실제 은행 연결·세금 신고를 대신하지 않으며 완전한 K-IFRS 준수를 인증한 서비스가 아닙니다.</p>
   <div className="guide-share-links"><a href="/workflow/">예제로 보는 전체 학습 순서 →</a><a href={learning.repositoryUrl} target="_blank" rel="noopener noreferrer">GitHub 사용법과 구현 기록 ↗</a></div></section>
 </div>;
}
