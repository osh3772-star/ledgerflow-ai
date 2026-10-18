import {describe,expect,it} from 'vitest';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolve} from 'node:path';
import {setupArguments} from '../../scripts/create-learning-workspace.js';

const execute=promisify(execFile);
describe('one-prompt setup CLI keeps the open working folder',()=>{
 it('uses the current working directory without requiring Open Folder',()=>{
  expect(setupArguments(['--in-place','--client','codex'])).toEqual({directory:process.cwd(),client:'codex'});
 });
 it('supports an explicitly selected existing directory with no empty-folder check',()=>{
  expect(setupArguments(['--directory','.','--client','claude'])).toEqual({directory:resolve('.'),client:'claude'});
 });
 it('requires the current app rather than guessing or editing all app configurations',()=>{
  for(const args of [[],['--in-place'],['--client','unknown'],['--client','--in-place']])expect(()=>setupArguments(args)).toThrow();
  expect(setupArguments(['--client','antigravity']).client).toBe('antigravity');
 });
 it('rejects unsupported or duplicate arguments before installing anything',()=>{
  for(const args of [['--client','codex','--force'],['--client','codex','--client','claude'],['--directory']])expect(()=>setupArguments(args)).toThrow('INVALID_SETUP_ARGUMENTS');
 });
 it('runs with plain Node 24 without pnpm or runtime dependencies',async()=>{
  const {stdout,stderr}=await execute(process.execPath,['scripts/create-learning-workspace.ts','--help'],{cwd:process.cwd(),windowsHide:true});
  expect(stderr).toBe('');expect(stdout).toContain('current folder, existing files preserved');
 });
});
