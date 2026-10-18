import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
// Offline renderer for the controlled workflow document. No external services.
export async function renderWorkflowGuide({website=false,source:providedSource,css:providedCss}={}){
const source=providedSource??await readFile(new URL('./WORKFLOW_GUIDE.md',import.meta.url),'utf8');
const css=providedCss??await readFile(new URL('./workflow-guide.css',import.meta.url),'utf8');
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function inline(value){
 let output='',cursor=0;
 const pattern=/\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)]+)\)/g;
 for(const match of value.matchAll(pattern)){
  output+=escape(value.slice(cursor,match.index));
  if(match[1])output+='<strong>'+escape(match[1])+'</strong>';
  else{
   const raw=match[3],href=/^https:\/\//.test(raw)?raw:/^[A-Z_]+\.md$/.test(raw)?'https://github.com/osh3772-star/ledgerflow-ai/blob/main/docs/'+raw:'#';
   output+='<a href="'+escape(href)+'" target="_blank" rel="noopener noreferrer">'+escape(match[2])+'</a>';
  }
  cursor=match.index+match[0].length;
 }
 return output+escape(value.slice(cursor));
}
const lines=source.split(/\r?\n/),parts=[],toc=[];
let chapter=false,list=null,codeIndex=0;
function closeList(){if(list){parts.push('</'+list+'>');list=null;}}
const cells=line=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(v=>v.trim());
for(let i=0;i<lines.length;i++){
 const line=lines[i].trim();
 if(!line){closeList();continue;}
 if(line.startsWith('# '))continue;
 if(line.startsWith('~~~')){
  closeList();const language=line.slice(3).trim(),code=[];
  while(++i<lines.length&&!lines[i].trim().startsWith('~~~'))code.push(lines[i]);
  const first=codeIndex++===0;
  if(first&&website)parts.push('<p data-start-session role="status">로그인 상태를 확인한 뒤 해당 연결 방법을 안내합니다.</p>');
  parts.push('<div class="code-block"'+(first?' data-guest-setup'+(website?' hidden':''):'')+'><div class="code-toolbar"><span>'+(first?'비로그인 전용 · 새 임시 장부 시작':language==='text'?'흐름 / 복사용 요청문':'터미널 명령')+'</span><button class="copy" type="button">복사</button></div><pre><code>'+escape(code.join('\n'))+'</code></pre></div>');
  continue;
 }
 const heading=line.match(/^(#{2,3}) (.+)$/);
 if(heading){
  closeList();const level=heading[1].length;
  if(level===2){
   if(chapter)parts.push('</section>');chapter=true;
   const id='section-'+(toc.length+1),label=heading[2];toc.push({id,label});
   parts.push('<section class="chapter" id="'+id+'"><h2>'+inline(label)+'</h2>');
  }else parts.push('<h3>'+inline(heading[2])+'</h3>');
  continue;
 }
 if(line.startsWith('|')){
  closeList();const rows=[];
  while(i<lines.length&&lines[i].trim().startsWith('|'))rows.push(cells(lines[i++]));
  i--;const header=rows.shift();if(rows.length&&rows[0].every(cell=>/^:?-+:?$/.test(cell)))rows.shift();
  parts.push('<div class="table-wrap"><table><thead><tr>'+header.map(v=>'<th scope="col">'+inline(v)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(v=>'<td>'+inline(v)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>');
  continue;
 }
 const item=line.match(/^(-|\d+\.) (.+)$/);
 if(item){
  const type=item[1]==='-'?'ul':'ol';if(list!==type){closeList();list=type;parts.push('<'+type+'>');}
  parts.push('<li>'+inline(item[2])+'</li>');continue;
 }
 closeList();const paragraph=[line];
 while(i+1<lines.length&&lines[i+1].trim()&&!/^(#{1,3} |~~~|\||- |\d+\. )/.test(lines[i+1].trim()))paragraph.push(lines[++i].trim());
 parts.push('<p>'+inline(paragraph.join(' '))+'</p>');
}
closeList();if(chapter)parts.push('</section>');
function initialize(website){
 const notify=document.querySelector('.sr-status');
 if(website){
  const status=document.querySelector('[data-server-status]');
  const start=document.querySelector('[data-guest-setup]'),startNotice=document.querySelector('[data-start-session]');
  const showLink=text=>{startNotice.textContent=text+' ';const link=document.createElement('a');link.href='/#learning-start';link.textContent='내 로그인 상태에 맞는 요청문 받기 →';startNotice.append(link);};
  fetch('/api/remote/config',{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(8000)})
   .then(async response=>{if(!response.ok)throw new Error();return response.json();})
   .then(async config=>{
    if(!config.available){status.querySelector('strong').textContent='지금은 예시 자료를 둘러볼 수 있어요.';status.querySelector('p').textContent='원격 연결이 준비되면 상태에 맞는 요청문을 제공합니다.';showLink('현재는 연결 요청문을 표시하지 않습니다.');return;}
    const response=await fetch('/api/remote/session',{credentials:'same-origin',redirect:'error',signal:AbortSignal.timeout(8000)});if(!response.ok)throw new Error();const session=await response.json();
    if(session.signedIn&&session.mode!=='guest'){
     status.querySelector('strong').textContent='Google 로그인 완료 · 내 장부 연결';status.querySelector('p').textContent='사이트의 내 장부 전용 요청문을 사용하세요. 비로그인 설치문은 표시하지 않습니다.';showLink('내 장부 연결은 일회용 코드가 필요한 개인 요청문으로 진행합니다.');
    }else if(session.mode==='guest'){
     status.querySelector('strong').textContent='임시 장부 연결됨 · 재설치 없이 계속 학습';status.querySelector('p').textContent='같은 AI 작업 폴더에서 첫 거래 요청문으로 이어가세요.';showLink('이미 연결된 임시 장부가 있어 새 설치문을 표시하지 않습니다.');
    }else{start.hidden=false;status.querySelector('strong').textContent='비로그인 · 새 임시 장부로 체험';status.querySelector('p').textContent='아래 비로그인 전용 요청문으로 24시간 체험을 시작합니다. Google 장부를 쓰려면 먼저 사이트에서 로그인하세요.';startNotice.textContent='현재 비로그인 상태입니다. 아래 요청문은 새 임시 장부를 만듭니다.';}
   }).catch(()=>{status.querySelector('strong').textContent='로그인 상태를 확인하지 못했습니다.';status.querySelector('p').textContent='잘못된 장부에 연결되지 않도록 설치문을 표시하지 않습니다.';showLink('사이트를 새로고침해 현재 로그인 상태를 확인해 주세요.');});
 }
 for(const button of document.querySelectorAll('.copy'))button.addEventListener('click',async()=>{
  if(button.closest('[hidden]'))return;
  const value=button.closest('.code-block').querySelector('code').textContent;
  try{if(!navigator.clipboard?.writeText)throw new Error('clipboard');await navigator.clipboard.writeText(value);}
  catch{
   const field=document.createElement('textarea');field.value=value;field.style.position='fixed';field.style.opacity='0';document.body.append(field);field.select();
   const success=document.execCommand('copy');field.remove();if(!success){notify.textContent='요청문을 직접 선택해 복사하세요.';return;}
  }
  button.textContent='복사 완료';notify.textContent='복사했어요. 코덱스 또는 클로드 코드 대화창에 붙여 넣으세요.';
  window.setTimeout(()=>{button.textContent='복사';notify.textContent='';},2200);
 });
 document.querySelector('.print').addEventListener('click',()=>window.print());
 if('IntersectionObserver' in window){
  const observer=new IntersectionObserver(entries=>{
   const first=entries.find(entry=>entry.isIntersecting);if(!first)return;
   for(const link of document.querySelectorAll('.sidebar a'))link.classList.toggle('active',link.hash==='#'+first.target.id);
  },{rootMargin:'-12% 0px -72% 0px'});
  for(const section of document.querySelectorAll('.chapter'))observer.observe(section);
 }
}
const nav=toc.map(({id,label})=>'<a href="#'+id+'">'+escape(label)+'</a>').join('');
const siteLink=website?'<a href="/">대시보드로 돌아가기</a>':'<a href="https://ledgerflow-public-reference-gateway.eric5833.workers.dev/" target="_blank" rel="noopener noreferrer">공개 사이트 ↗</a>';
const status=website?'<aside class="status" data-server-status aria-label="현재 서버 설정" aria-live="polite"><strong>현재 서버 상태를 확인하고 있습니다.</strong><p>문서의 작성 시점과 현재 운영 상태를 구분합니다. 실제 업무 성공은 각 단계에서 확인하세요.</p></aside>':'<aside class="status" aria-label="안내서 상태"><strong>이 파일은 작성 시점의 안내서입니다.</strong><p>현재 운영 상태는 공개 사이트 상단에서 확인하세요. 파일을 열거나 요청문을 복사하는 것만으로 회계 업무가 실행되지는 않습니다.</p></aside>';
const html=[
'<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
'<meta name="description" content="코딩을 몰라도 GitHub 주소와 시작 요청문 하나로 준비하고, AI와 함께 거래·분개·승인·장부·재무제표를 배우는 학습 안내.">',
'<title>한빛유통 · 거래에서 재무제표까지 배우기</title><style>'+css+'</style></head><body id="top">',
'<div class="topbar"><div class="topbar-inner"><div class="brand"><span>한</span>한빛유통 · 회계 자동화 학습 안내</div><div class="actions">'+siteLink+'<button class="print" type="button">인쇄 · PDF로 저장</button></div></div></div>',
'<header class="hero"><div class="hero-inner"><div class="kicker">ACCOUNTING WORKFLOW · 회계 흐름 배우기</div><h1>회계가 처음이어도,<br>거래부터 보고서까지 따라가 보세요.</h1>',
'<p class="lead">회계 자동화 기술과 회계의 흐름을 공부하고 싶은 사람을 위한 안내입니다.<br>GitHub 주소와 요청문 하나로 준비하고, 거래 한 건부터 직접 연습합니다.</p>',
'<div class="tags"><span>코딩 지식 없이 시작</span><span>가상 한국회사 · 한빛유통</span><span>연습 거래 1,000건</span><span>AI가 설명하고 내가 확인</span></div></div></header>',
'<div class="layout"><nav class="sidebar" aria-label="문서 목차"><strong>처음 연결부터 보고서까지</strong>'+nav+'</nav><main class="main">',
status,
'<section class="readme" aria-label="핵심 학습 순서"><h2>이 순서로 한 번 해보세요.</h2><div class="quickflow"><span>로그인 상태에 맞는 요청문</span><b>→</b><span>AI와 내 장부 연결</span><b>→</b><span>첫 분개 요청</span><b>→</b><span>내가 직접 승인</span><b>→</b><span>AI에게 장부 반영 요청</span><b>→</b><span>보고서 숫자 이해</span></div><p>비로그인 체험과 내 Google 장부 연결 중 현재 상태에 맞는 요청문을 사용하세요. 이후에는 AI 대화창과 승인 화면을 오가며 공부합니다.</p><a href="#section-2">로그인 상태별 시작 방법으로 이동 →</a></section>',
parts.join('\n'),
'</main></div><footer class="footer">가상회사 회계 업무 체험 · 자료 검토와 최종 승인은 사람에게 있습니다.<br>이 안내 페이지에서 거래 생성·승인·장부 반영을 실행하지 않습니다.<a class="to-top" href="#top">문서 맨 위로 ↑</a></footer><div class="sr-status" role="status" aria-live="polite"></div>',
'<script>('+initialize.toString()+')('+JSON.stringify(website)+');</script></body></html>'
].join('\n');
const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
const targets=[...html.matchAll(/href="#([^"]+)"/g)].map(match=>match[1]);
const missingAnchors=targets.filter(target=>!ids.has(target));
const copyBlocks=html.split('class="copy"').length-1;
if(toc.length!==12||copyBlocks!==4||missingAnchors.length||html.includes('~~~'))throw new Error('DOCUMENT_STRUCTURE_INVALID');
for(const tag of ['section','table','thead','tbody','pre'])
 if((html.match(new RegExp('<'+tag+'(?:\\s|>)','g'))??[]).length!==(html.match(new RegExp('</'+tag+'>','g'))??[]).length)throw new Error('DOCUMENT_TAGS_INVALID');
return {html,chapters:toc.length,copyBlocks,missingAnchors:missingAnchors.length,bytes:Buffer.byteLength(html),offline:!website};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {syncLearningDocs}=await import('./render-learning-docs.mjs');
 await syncLearningDocs();
 const {html,...metadata}=await renderWorkflowGuide();
 await writeFile(new URL('./WORKFLOW_GUIDE.html',import.meta.url),html,'utf8');
 console.log(JSON.stringify({created:fileURLToPath(new URL('./WORKFLOW_GUIDE.html',import.meta.url)),...metadata}));
}
