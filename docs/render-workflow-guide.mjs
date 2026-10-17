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
let chapter=false,list=null;
function closeList(){if(list){parts.push('</'+list+'>');list=null;}}
const cells=line=>line.trim().replace(/^\|/,'').replace(/\|$/,'').split('|').map(v=>v.trim());
for(let i=0;i<lines.length;i++){
 const line=lines[i].trim();
 if(!line){closeList();continue;}
 if(line.startsWith('# '))continue;
 if(line.startsWith('~~~')){
  closeList();const language=line.slice(3).trim(),code=[];
  while(++i<lines.length&&!lines[i].trim().startsWith('~~~'))code.push(lines[i]);
  parts.push('<div class="code-block"><div class="code-toolbar"><span>'+(language==='text'?'흐름 / 복사용 요청문':'터미널 명령')+'</span><button class="copy" type="button">복사</button></div><pre><code>'+escape(code.join('\n'))+'</code></pre></div>');
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
 const notify=document.querySelector('[role=status]');
 if(website){
  const status=document.querySelector('[data-server-status]');
  fetch('/api/remote/config',{credentials:'omit',redirect:'error',signal:AbortSignal.timeout(8000)})
   .then(async response=>{if(!response.ok)throw new Error();return response.json();})
   .then(config=>{
    const ready=config.available&&config.googleLogin?.enabled;
    status.querySelector('strong').textContent=ready?'Google 로그인으로 내 장부를 열 수 있도록 연결되어 있습니다.':config.available?'원격 서버는 준비됐고 Google 로그인 설정을 확인 중입니다.':'현재 이 서버는 공개 샘플 조회 모드입니다.';
    status.querySelector('p').textContent=ready?'대시보드에서 Google 계정으로 로그인한 뒤 같은 계정으로 AI 앱을 연결하세요. 실제 로그인·앱 호출·장부 반영 성공은 각 단계에서 확인합니다.':config.available?'Google 버튼이 비활성이면 운영자가 Google 제공자와 돌아올 주소를 설정해야 합니다. 별도 이메일 회원가입은 사용하지 않습니다.':'개인 장부 처리는 운영 준비가 끝난 뒤 시작합니다. 아래에서 전체 사용 흐름과 샘플 안내를 먼저 읽을 수 있습니다.';
   }).catch(()=>{status.querySelector('strong').textContent='현재 서버 상태를 확인하지 못했습니다.';status.querySelector('p').textContent='대시보드 상단의 안내를 확인하세요. 이 문서의 절차만으로 서버 연결 성공을 판단하지 않습니다.';});
 }
 for(const button of document.querySelectorAll('.copy'))button.addEventListener('click',async()=>{
  const value=button.closest('.code-block').querySelector('code').textContent;
  try{if(!navigator.clipboard?.writeText)throw new Error('clipboard');await navigator.clipboard.writeText(value);}
  catch{
   const field=document.createElement('textarea');field.value=value;field.style.position='fixed';field.style.opacity='0';document.body.append(field);field.select();
   const success=document.execCommand('copy');field.remove();if(!success){notify.textContent='요청문을 직접 선택해 복사하세요.';return;}
  }
  button.textContent='복사 완료';notify.textContent='복사했습니다. 요청문은 AI 앱에, 명령어는 터미널에 붙여 넣으세요.';
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
'<meta name="description" content="한빛유통 회계 업무 전체 흐름: Google 로그인, MCP 연결, 거래 조회, 분개, 검증, 사용자 승인, 장부 반영, 결산과 보고서.">',
'<title>한빛유통 · 회계 업무 전체 워크플로우</title><style>'+css+'</style></head><body id="top">',
'<div class="topbar"><div class="topbar-inner"><div class="brand"><span>한</span>한빛유통 · 전체 사용 안내</div><div class="actions">'+siteLink+'<button class="print" type="button">인쇄 · PDF로 저장</button></div></div></div>',
'<header class="hero"><div class="hero-inner"><div class="kicker">ACCOUNTING WORKFLOW · 회계 업무 흐름</div><h1>거래를 확인하는 순간부터<br>재무 보고서가 완성되기까지.</h1>',
'<p class="lead">사용자는 무엇을 누르고, AI는 어떤 도구를 쓰며, 언제 장부에 반영될까요?<br>처음 접속하는 사람도 순서대로 따라갈 수 있도록 전체 과정을 정리했습니다.</p>',
'<div class="tags"><span>2026.10.17 기준</span><span>가상 한국회사 · 한빛유통</span><span>MCP 서버 1개</span><span>역할 6개 · 도구 41개</span><span>사용자가 요청하고 직접 승인</span></div></div></header>',
'<div class="layout"><nav class="sidebar" aria-label="문서 목차"><strong>전체 흐름 · 20단계와 참고 문서</strong>'+nav+'</nav><main class="main">',
status,
'<section class="readme" aria-label="핵심 사용 순서"><h2>가장 중요한 사용 순서</h2><div class="quickflow"><span>Google 로그인</span><b>→</b><span>AI 앱 MCP 연결</span><b>→</b><span>분개 요청</span><b>→</b><span>내가 웹에서 승인</span><b>→</b><span>앱에 장부 반영 요청</span><b>→</b><span>보고서 확인</span></div><p>원격 운영을 활성화한 뒤의 사용 흐름과, 그 전에 운영자가 준비해야 할 일을 함께 설명합니다.</p></section>',
parts.join('\n'),
'</main></div><footer class="footer">가상회사 회계 업무 체험 · 자료 검토와 최종 승인은 사람에게 있습니다.<br>이 안내 페이지에서 거래 생성·승인·장부 반영을 실행하지 않습니다.<a class="to-top" href="#top">문서 맨 위로 ↑</a></footer><div class="sr-status" role="status" aria-live="polite"></div>',
'<script>('+initialize.toString()+')('+JSON.stringify(website)+');</script></body></html>'
].join('\n');
const ids=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]));
const targets=[...html.matchAll(/href="#([^"]+)"/g)].map(match=>match[1]);
const missingAnchors=targets.filter(target=>!ids.has(target));
const copyBlocks=html.split('class="copy"').length-1;
if(toc.length!==21||copyBlocks!==12||missingAnchors.length||html.includes('~~~'))throw new Error('DOCUMENT_STRUCTURE_INVALID');
for(const tag of ['section','table','thead','tbody','pre'])
 if((html.match(new RegExp('<'+tag+'(?:\\s|>)','g'))??[]).length!==(html.match(new RegExp('</'+tag+'>','g'))??[]).length)throw new Error('DOCUMENT_TAGS_INVALID');
return {html,chapters:toc.length,copyBlocks,missingAnchors:missingAnchors.length,bytes:Buffer.byteLength(html),offline:!website};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const {html,...metadata}=await renderWorkflowGuide();
 await writeFile(new URL('./WORKFLOW_GUIDE.html',import.meta.url),html,'utf8');
 console.log(JSON.stringify({created:fileURLToPath(new URL('./WORKFLOW_GUIDE.html',import.meta.url)),...metadata}));
}
