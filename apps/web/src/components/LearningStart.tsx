import {useId,useRef,useState} from 'react';
import learning from '../../../../docs/learning-start.json' with {type:'json'};
import '../styles/beginner-guide.css';
import {codexRepairPrompt,type LearningAccess} from './PersonalSetup.js';

export function PromptBox({title,prompt,hint,copyLabel='요청문 복사'}:{title:string;prompt:string;hint:string;copyLabel?:string}){
 const id=useId(),field=useRef<HTMLTextAreaElement>(null),[message,setMessage]=useState('');
 async function copy(){
  try{if(!navigator.clipboard?.writeText)throw new Error();await navigator.clipboard.writeText(prompt);setMessage('복사했어요. 현재 사용하는 AI 앱 대화창에 붙여 넣으세요.');}
  catch{field.current?.focus();field.current?.select();setMessage('글을 선택했어요. 복사 기능이나 Ctrl+C를 사용해 주세요.');}
 }
 return <div className="guide-request-box"><div className="guide-request-heading"><label htmlFor={id}>{title}</label>
  <button type="button" className="guide-copy-button" onClick={()=>void copy()}>{copyLabel}</button></div>
  <textarea id={id} ref={field} readOnly rows={prompt.split('\n').length+1} value={prompt} spellCheck={false} aria-describedby={id+'-hint'}/>
  <p id={id+'-hint'} className="guide-field-hint">{hint}</p><p className="guide-copy-status" role="status">{message}</p></div>;
}

export default function LearningStart({access={mode:'checking'}}:{access?:LearningAccess}){
 const personal=access.mode==='personal',setup=personal?access.setup:null,anonymous=access.mode==='anonymous',guest=access.mode==='guest';
 return <section className="guide-section guide-start" id="learning-start" aria-labelledby="learning-start-title">
  <span className="guide-kicker">로그인 상태에 맞게 연결하기</span><h2 id="learning-start-title">비로그인 체험과 내 Google 장부 연결은 달라요.</h2>
  <div className="guide-connection-choices" aria-label="비로그인과 Google 로그인 사용법 비교">
   <article className={anonymous||guest?'is-current':''} data-connection-mode="anonymous"><span className="guide-mode-label">{anonymous?'현재 상태 · 비로그인':guest?'현재 상태 · 임시 장부 연결됨':'비로그인으로 시작할 때'}</span><h3>비로그인 · 24시간 체험</h3><p>연습용 거래 1,000건이 있는 <strong>새 임시 장부</strong>를 만듭니다.</p><p>승인하는 곳: AI가 준 <strong>전표별 임시 승인 링크</strong></p><small>Google 계정의 장부와는 별도 공간입니다.</small></article>
   <article className={personal?'is-current':''} data-connection-mode="personal"><span className="guide-mode-label">{personal?'현재 상태 · Google 로그인 완료':'Google 로그인한 뒤 사용'}</span><h3>Google 로그인 · 내 장부 계속 사용</h3><p>이 사이트에서 보고 있는 <strong>내 회사 장부</strong>에 AI를 연결합니다.</p><p>승인하는 곳: 사이트의 <strong>사용자 승인 메뉴</strong></p><small>내 장부 전용 일회용 코드가 들어 있는 요청문을 사용합니다.</small>{anonymous&&<p><a href="#remote-access">위에서 Google 로그인하기 ↑</a></p>}</article>
  </div>
  <p>평소 사용하는 <strong className="guide-app-name"><span lang="en">Codex</span><small lang="ko">코덱스</small></strong> 또는 <strong className="guide-app-name"><span lang="en">Claude Code</span><small lang="ko">클로드 코드</small></strong> 중 하나를 여세요. 파일과 앱 연결을 설정할 수 있는 앱이 필요합니다. 앱이 없다면 먼저 둘 중 하나를 설치하고 본인 계정으로 로그인하세요.</p>
  <div className="guide-share-links"><a href={learning.repositoryUrl} target="_blank" rel="noopener noreferrer">GitHub 저장소 열기 ↗</a></div>
  <p className="guide-repository-url">{learning.repositoryUrl}</p>
  {personal&&(setup?<PromptBox title="Google 로그인 · 내 장부 연결 요청문" prompt={setup.prompt} copyLabel="내 장부 연결 요청문 복사" hint={'지금 보고 있는 회사 '+setup.companyId+' 전용입니다. 10분 안에 기존 AI 작업 폴더에서 사용하세요. 새 게스트 장부는 만들지 않습니다.'}/>:<p className="notice" role="status">Google 로그인은 확인했습니다. 내 장부 전용 요청문을 준비 중입니다. 실패했다면 상단 ‘AI 연결·장부 관리’에서 다시 발급하세요. 비로그인 요청문으로 대신 연결하지 않습니다.</p>)}
  {anonymous&&<PromptBox title="비로그인 · 새 임시 장부 시작 요청문" prompt={learning.setupPrompt} copyLabel="비로그인 체험 요청문 복사" hint="24시간짜리 새 임시 장부를 만듭니다. Google 계정 장부를 쓰려면 먼저 위에서 로그인하세요."/>}
  {guest&&<p className="notice" role="status">이미 임시 장부가 연결되어 있습니다. 회사 ID: <code>{access.companyId}</code>. 설치를 반복하지 말고 같은 AI 작업 폴더에서 아래 첫 거래 요청문으로 이어가세요. Google로 보관하려면 AI가 준 승인 링크 안에서 ‘Google로 이 장부 연결·보관하기’를 누르세요.</p>}
  {access.mode==='checking'&&<p className="notice" role="status">로그인 상태를 확인하고 있습니다. 확인이 끝나면 해당 요청문만 표시합니다.</p>}
  {access.mode==='error'&&<p className="notice error" role="alert">로그인 상태를 확인하지 못해 연결 요청문을 표시하지 않았습니다. 사이트를 새로고침하거나 위에서 Google로 다시 로그인해 주세요.</p>}
  {access.mode==='unavailable'&&<p className="notice" role="status">현재 원격 연결을 준비 중입니다. 서버가 준비되면 로그인 상태에 맞는 요청문을 표시합니다.</p>}
  <p>Antigravity · 안티그래비티에서도 같은 요청문을 사용할 수 있어요.</p>
  <div className="notice guide-codex-help" role="note"><strong>Codex가 “도구가 아직 없다”고 하면?</strong><p>아래 <strong>Codex 자동 연결 복구 요청문</strong>을 기존 AI 대화에 보내세요. AI가 현재 학습 폴더만 신뢰 등록하고 같은 장부의 연결을 자동 등록한 뒤 앱의 재읽기를 시도합니다. MCP 등록 메뉴를 찾거나 서버 주소를 직접 입력하지 않습니다. 기존 거래와 장부는 그대로 사용해요. 앱이 자동 재읽기를 지원하지 않으면 그 상태를 정확히 알려줍니다.</p></div>
  {(anonymous||guest||setup)&&<details id="codex-repair"><summary>이미 설치했는데 도구가 없다면 · 자동 연결 복구</summary><PromptBox title="이미 설치했다면 · Codex 자동 연결 복구" prompt={codexRepairPrompt(setup?.companyId??(guest?access.companyId:undefined))} copyLabel="Codex 자동 연결 복구 요청문 복사" hint="처음 설치할 때 쓰는 요청문이 아닙니다. 기존 폴더의 연결 키를 재사용하고 새 장부·게스트를 만들지 않아요. AI가 도우미를 한 번 실행하며, 앱 자체의 실행 허용은 앱 정책을 따릅니다."/></details>}
  {(personal||anonymous||guest)&&<ol className="guide-setup-list"><li><strong>{personal?'내 장부 전용 요청문을 보냅니다.':guest?'같은 AI 작업 폴더에서 계속합니다.':'비로그인 체험 요청문을 보냅니다.'}</strong> {personal?'기존 AI 작업 폴더에 보내면 이 사이트의 내 회사와 역할 6개를 연결합니다.':guest?'이미 연결되어 있으므로 다시 설치하지 않아도 됩니다.':'AI가 현재 폴더에 역할 6개와 연결을 준비하고, 거래 1,000건이 있는 내 임시 회사를 발급받습니다.'}</li>
   <li><strong>연결된 회사를 확인합니다.</strong> {personal||guest?'AI가 알려준 companyId와 사이트 상단 회사 ID가 같은지 확인하세요.':'AI가 도구를 실제로 호출해 내 임시 회사 ID를 알려줍니다. 임시 승인 링크를 열기 전까지 사이트에는 공개 예시가 보일 수 있어요.'}</li>
   <li><strong>첫 거래를 요청하고 직접 승인합니다.</strong> {personal?'AI가 분개와 검증을 준비하면 이 사이트의 사용자 승인 메뉴에서 검토하세요.':'AI가 분개와 검증을 준비하면 AI가 준 전표별 임시 승인 링크를 열어 검토하세요.'} 승인한 뒤 AI에게 장부 반영을 따로 요청합니다.</li></ol>}
  <p className="guide-install-note">{personal?'개인 연결 요청문의 코드는 10분, 발급받은 AI 연결은 7일입니다. 만료되면 상단 AI 연결·장부 관리에서 다시 발급하세요.':'비로그인 임시 장부 접근은 24시간입니다. 내 Google 장부를 쓰려면 로그인한 뒤 전용 요청문을 사용하세요.'} 공유 학습 서버는 정원이 있어 새 발급이 제한될 수 있습니다. 앱 자체가 새 설정을 즉시 읽지 못하면 연결 새로고침이나 보안 확인이 필요할 수 있어요.</p>
  <p className="guide-install-note">MCP는 AI와 이 사이트의 회계 도구를 연결하는 통로입니다. 회계 서버·데이터베이스·공공 API 키는 이미 준비돼 있어 직접 설치하거나 발급받지 않습니다. 일반 웹 채팅에 요청문만 보내는 것으로 앱 설정이 바뀌지는 않습니다.</p>
 </section>;
}
