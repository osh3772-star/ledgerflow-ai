import {describe,expect,it} from 'vitest';
import type {Pool} from 'pg';
import {RemoteAuth} from '../../apps/mcp-server/src/remote-auth.js';
import {RemoteGoogleAuth} from '../../apps/mcp-server/src/remote-google-auth.js';
describe('Web Standard Auth fetch receiver',()=>{
 it('calls provider fetch without binding the service instance, as required by Workerd',async()=>{
  const receivers:unknown[]=[];
  const fetcher:typeof fetch=async function(this:unknown,input){
   receivers.push(this);
   return String(input).endsWith('/settings')?Response.json({external:{google:true}}):
    Response.json({id:'10000000-0000-4000-8000-000000000001',email:'fixture@example.test',email_confirmed_at:'2026-10-17',identities:[{provider:'google'}]});
  };
  const auth=new RemoteAuth({} as Pool,{origin:'https://site.example',supabaseUrl:'https://auth.example',publishableKey:'fixture',encryptionKey:Buffer.alloc(32).toString('base64')},fetcher);
  expect(await new RemoteGoogleAuth(auth).configuration()).toEqual({enabled:true,checked:true});
  expect((await auth.verify('fixture-token',true)).email).toBe('fixture@example.test');
  expect(receivers).toEqual([undefined,undefined]);
 });
});
