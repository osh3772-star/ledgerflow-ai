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
  <ol className="guide-setup-list"><li><strong>AI가 준비합니다.</strong> 학습 폴더, 회계 역할 6개, 이미 켜져 있는 회계 도구와의 연결 설정을 준비합니다.</li>
   <li><strong>본인이 확인합니다.</strong> AI가 안내하면 학습 폴더를 열고 앱 연결을 허용하세요. Google 로그인과 ‘내 장부 연결 허용’은 직접 눌러 주세요.</li>
   <li><strong>실제 연결을 확인합니다.</strong> AI가 내 회사와 연결 결과를 알려주면 준비 완료입니다. 설정 파일만 만들어졌거나 로그인을 기다리고 있으면 아직 연결 완료가 아닙니다.</li></ol>
  <p className="guide-install-note">MCP는 AI와 이 사이트의 회계 도구를 연결하는 통로입니다. 회계 서버·데이터베이스·공공 API 키는 이미 준비돼 있어 직접 설치하거나 발급받지 않습니다. 일반 웹 채팅에 요청문만 보내는 것으로 앱 설정이 바뀌지는 않습니다.</p>
 </section>;
}
