import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {describe,it,expect} from 'vitest';
import {workspacePathSchema} from '../../apps/mcp-server/src/client-connection-setup.js';
import {CodexConnectionContent,type CodexConnectionView} from '../../apps/web/src/components/CodexConnection.js';
const require=createRequire(resolve('apps/web/package.json')),{createElement}=require('react'),{renderToStaticMarkup}=require('react-dom/server');
const view:CodexConnectionView={connectionId:'fixture',companyId:'fixture-company',server:'ledgerflow-accounting-mcp',mcpUrl:'https://example.test/mcp/g/fixture',settingsUrl:'codex://settings',resumeUrl:null,workspacePath:null,verificationPrompt:'get_system_status → get_company_context',clientName:null,checks:{get_system_status:null,get_company_context:null},verified:false,evidence:'fixture server receipt'};
describe('Codex learners receive a concrete native connection handoff',()=>{
 it('does not present generated settings or a single successful tool as a completed native connection',()=>{
  const html=renderToStaticMarkup(createElement(CodexConnectionContent,{view:{...view,checks:{...view.checks,get_system_status:'2026-10-18T00:00:00Z'}},copied:'',onCopy:()=>{}}));
  expect(html).toContain('Codex 연결 적용이 남았어요');expect(html).toContain('Restart');expect(html).toContain('Save');expect(html).toContain('codex://settings');expect(html).toContain('fixture-company');expect(html).toContain('아직 도착하지 않음');expect(html).not.toContain('두 확인 도구 호출이 도착했어요');
 });
 it('offers the same-folder continuation only when a folder is known, and escapes path text',()=>{
  const html=renderToStaticMarkup(createElement(CodexConnectionContent,{view:{...view,workspacePath:'/tmp/<book>',resumeUrl:'codex://threads/new?path=%2Ftmp%2Fbook',verified:true},copied:'',onCopy:()=>{}}));
  expect(html).toContain('같은 폴더에서 확인 대화 열기');expect(html).toContain('/tmp/&lt;book&gt;');expect(html).toContain('두 확인 도구 호출이 도착했어요');expect(html).toContain('보내기 버튼은 직접');
 });
 it('accepts absolute workspace locations without executing them and rejects relative/control paths',()=>{
  for(const p of ['C:\\Learning\\회계','/home/student/ledger'])expect(workspacePathSchema.safeParse(p).success).toBe(true);
  for(const p of ['../other','~/.codex','relative','/tmp/line\nother','//attacker/share'])expect(workspacePathSchema.safeParse(p).success).toBe(false);
 });
});
