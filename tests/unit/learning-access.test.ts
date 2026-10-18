import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {runInNewContext} from 'node:vm';
import {describe,it,expect} from 'vitest';
import LearningStart from '../../apps/web/src/components/LearningStart.js';
import {isPersonalSession,personalSetupPrompt,type LearningAccess} from '../../apps/web/src/components/PersonalSetup.js';

const appRequire=createRequire(resolve('apps/web/package.json'));
const {createElement}=appRequire('react');
const {renderToStaticMarkup}=appRequire('react-dom/server');
const render=(access:LearningAccess)=>renderToStaticMarkup(createElement(LearningStart,{access})) as string;
const guestText='나는 Google 로그인 없이 24시간 임시 장부로';
describe('learning setup belongs to the verified browser state',()=>{
 it('offers the guest request only to a confirmed signed-out browser',()=>{
  const html=render({mode:'anonymous'});
  expect(html).toContain(guestText);expect(html).toContain('비로그인 체험 요청문 복사');expect(html).not.toContain('claimCode:');
 });
 it('shows only the personal request when Google is signed in',()=>{
  const html=render({mode:'personal',setup:{personal:true,prompt:personalSetupPrompt('https://fixture.example','fixture-code'),companyId:'fixture-company',expiresAt:'2099-01-01T00:00:00Z'}});
  expect(html).toContain('claimCode: fixture-code');expect(html).toContain('내 장부 연결 요청문 복사');expect(html).not.toContain(guestText);expect(html).not.toContain('비로그인 체험 요청문 복사');
 });
 it('never falls back to a guest request while checking identity or preparing a personal ticket',()=>{
  for(const access of [{mode:'checking'},{mode:'error'},{mode:'unavailable'},{mode:'personal',setup:null}] as LearningAccess[]){
   const html=render(access);expect(html).not.toContain('<textarea');expect(html).not.toContain(guestText);
  }
 });
 it('keeps an existing guest book instead of offering another installation',()=>{
  const html=render({mode:'guest',companyId:'existing-company'});
  expect(html).toContain('existing-company');expect(html).toContain('이미 임시 장부가 연결');expect(html).not.toContain('<textarea');
 });
 it('recognizes verified signed-in sessions even when an older response omits mode',()=>{
  expect(isPersonalSession({signedIn:true})).toBe(true);expect(isPersonalSession({signedIn:true,mode:'personal'})).toBe(true);
  expect(isPersonalSession({signedIn:true,mode:'guest'})).toBe(false);expect(isPersonalSession({signedIn:false})).toBe(false);
 });
});

describe('the hosted workflow guide also separates login states',()=>{
 async function guide(session:unknown,sessionStatus=200){
  const {renderWorkflowGuide}=await import(pathToFileURL(resolve('docs/render-workflow-guide.mjs')).href);
  const {html}=await renderWorkflowGuide({website:true});
  const start={hidden:html.includes('data-guest-setup hidden')},notice={textContent:'',links:[] as any[],append(link:any){this.links.push(link);}};
  const strong={textContent:''},paragraph={textContent:''},status={querySelector:(selector:string)=>selector==='strong'?strong:paragraph};
  const document={querySelector:(selector:string)=>selector==='[data-server-status]'?status:selector==='[data-guest-setup]'?start:selector==='[data-start-session]'?notice:selector==='.print'?{addEventListener:()=>{}}:{textContent:''},querySelectorAll:()=>[],createElement:()=>({href:'',textContent:''})};
  const calls:string[]=[];
  runInNewContext(html.match(/<script>([\s\S]*)<\/script>/u)![1]!,{document,window:{},AbortSignal,
   fetch:async(path:string)=>{calls.push(path);return Response.json(path.endsWith('/config')?{available:true}:session,{status:path.endsWith('/config')?200:sessionStatus});}});
  await new Promise(setImmediate);
  return {start,notice,strong,calls};
 }
 it('hides the generic setup until identity is known and sends Google users to their personal request',async()=>{
  const result=await guide({signedIn:true,mode:'personal'});
  expect(result.start.hidden).toBe(true);expect(result.strong.textContent).toContain('Google 로그인 완료');
  expect(result.notice.links[0].href).toBe('/#learning-start');expect(result.calls).toEqual(['/api/remote/config','/api/remote/session']);
 });
 it('reveals the guest setup only after a signed-out response',async()=>{
  expect((await guide({signedIn:false})).start.hidden).toBe(false);
  expect((await guide({signedIn:true,mode:'guest'})).start.hidden).toBe(true);
  expect((await guide({error:'UNAUTHENTICATED'},401)).start.hidden).toBe(true);
 });
});
