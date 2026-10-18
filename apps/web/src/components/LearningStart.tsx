import {useId,useRef,useState} from 'react';
import learning from '../../../../docs/learning-start.json' with {type:'json'};
import '../styles/beginner-guide.css';

export function PromptBox({title,prompt,hint}:{title:string;prompt:string;hint:string}){
 const id=useId(),field=useRef<HTMLTextAreaElement>(null),[message,setMessage]=useState('');
 async function copy(){
  try{if(!navigator.clipboard?.writeText)throw new Error();await navigator.clipboard.writeText(prompt);setMessage('복사했어요. 코덱스 또는 클로드 코드 대화창에 붙여 넣으세요.');}
  catch{field.current?.focus();field.current?.select();setMessage('글을 선택했어요. 복사 기능이나 Ctrl+C를 사용해 주세요.');}
 }
 return <div className="guide-request-box"><div className="guide-request-heading"><label htmlFor={id}>{title}</label>
  <button type="button" className="guide-copy-button" onClick={()=>void copy()}>요청문 복사</button></div>
  <textarea id={id} ref={field} readOnly rows={prompt.split('\n').length+1} value={prompt} spellCheck={false} aria-describedby={id+'-hint'}/>
  <p id={id+'-hint'} className="guide-field-hint">{hint}</p><p className="guide-copy-status" role="status">{message}</p></div>;
}

export default function LearningStart(){
 return <section className="guide-section guide-start" id="learning-start" aria-labelledby="learning-start-title">
  <span className="guide-kicker">처음 연결할 때 · 이 요청문 하나</span><h2 id="learning-start-title">GitHub 주소와 요청문을 AI에게 보내세요.</h2>
  <p>평소 사용하는 <strong className="guide-app-name"><span lang="en">Codex</span><small lang="ko">코덱스</small></strong> 또는 <strong className="guide-app-name"><span lang="en">Claude Code</span><small lang="ko">클로드 코드</small></strong> 중 하나를 여세요. 파일과 앱 연결을 설정할 수 있는 앱이 필요합니다. 앱이 없다면 먼저 둘 중 하나를 설치하고 본인 계정으로 로그인하세요.</p>
  <div className="guide-share-links"><a href={learning.repositoryUrl} target="_blank" rel="noopener noreferrer">GitHub 저장소 열기 ↗</a></div>
  <p className="guide-repository-url">{learning.repositoryUrl}</p>
  <PromptBox title="처음 시작하기 · 그대로 복사하세요" prompt={learning.setupPrompt} hint="이 요청문 안에 GitHub 주소도 들어 있어요. 설치 명령어나 API 키를 따로 입력할 필요가 없습니다."/>
  <p>Antigravity · 안티그래비티에서도 같은 요청문을 사용할 수 있어요.</p>
  <ol className="guide-setup-list"><li><strong>AI가 현재 폴더에 준비합니다.</strong> 기존 파일을 보존하며 회계 역할 6개와 현재 앱 연결을 등록하고, 내 임시 회사와 연습 거래 1,000건을 자동 발급받습니다.</li>
   <li><strong>Google 로그인 없이 연결합니다.</strong> 폴더를 다시 열지 않고 임시 키로 연습합니다. 터미널과 홈 폴더 접근 없이 URL 읽기·현재 폴더 파일 쓰기로 준비하고, 현재 앱에서 도구를 직접 확인합니다.</li>
   <li><strong>첫 거래를 요청합니다.</strong> 상태 확인 → 회사 확인 → 통합 분개 준비의 정상 경로 3회 호출로 시작합니다. AI가 준 전용 링크에서 직접 승인합니다.</li></ol>
  <p className="guide-install-note">임시 장부 접근은 24시간입니다. 기록을 보관할 때만 Google을 연결하세요. 공유 학습 서버는 정원이 있어 새 발급이 제한될 수 있습니다. 앱 자체가 새 설정을 즉시 읽지 못하면 연결 새로고침이나 보안 확인이 필요할 수 있어요. AI는 그 결과를 성공과 구분해 알려줍니다.</p>
  <p className="guide-install-note">MCP는 AI와 이 사이트의 회계 도구를 연결하는 통로입니다. 회계 서버·데이터베이스·공공 API 키는 이미 준비돼 있어 직접 설치하거나 발급받지 않습니다. 일반 웹 채팅에 요청문만 보내는 것으로 앱 설정이 바뀌지는 않습니다.</p>
 </section>;
}
