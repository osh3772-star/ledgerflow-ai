import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';

// Reuse Wrangler's pinned local runtime and bundler; no new dependency or server.
const gatewayRequire=createRequire(resolve('apps/public-api-gateway/package.json'));
const wranglerRequire=createRequire(gatewayRequire.resolve('wrangler/package.json'));
const {build}=wranglerRequire('esbuild') as {build:(options:Record<string,unknown>)=>Promise<{outputFiles:{text:string}[]}>};
type LocalWorker={dispatchFetch:(url:string)=>Promise<Response>;dispose:()=>Promise<void>};
const {Miniflare}=wranglerRequire('miniflare') as {Miniflare:new(options:Record<string,unknown>)=>LocalWorker};

describe('remote authentication on the Cloudflare Workerd runtime',()=>{
 let worker:LocalWorker|undefined;
 beforeAll(async()=>{
  const bundle=await build({entryPoints:['tests/fixtures/remote-auth-worker.ts'],bundle:true,write:false,
   format:'esm',platform:'neutral',mainFields:['module','main'],conditions:['workerd','worker'],external:['node:*']});
  worker=new Miniflare({telemetry:{enabled:false},workers:[{config:{name:'auth-regression',
   compatibilityDate:'2026-10-16',compatibilityFlags:['nodejs_compat'],
   manifest:{mainModule:'worker.js',modules:{'worker.js':{type:'esm',contents:bundle.outputFiles[0]!.text}}}},
   dev:{outboundService:{type:'fetcher',handler:()=>{throw new Error('EXTERNAL_REQUEST_FORBIDDEN');}}}}]});
 });
 afterAll(async()=>{await worker?.dispose();});
 it('round-trips UTF-8 browser sessions while retaining authenticated browser/key binding',async()=>{
  const response=await worker!.dispatchFetch('https://fixture.example/session');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({roundTrip:{userId:'10000000-0000-4000-8000-000000000001',
   email:'한빛+로그인@example.test',accessToken:'fixture-access',refreshToken:'fixture-refresh',csrf:'fixture-csrf'},
   wrongBrowserRejected:true,wrongKeyRejected:true,encrypted:true});
 });
 it('encrypts Google PKCE state, exchanges a bound code once and persists a UTF-8 browser session',async()=>{
  const response=await worker!.dispatchFetch('https://fixture.example/google');
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({pkceVerified:true,returnTo:'/',email:'한빛+로그인@example.test',
   storedEmail:'한빛+로그인@example.test',replayRejected:true,flowEncrypted:true,sessionEncrypted:true,
   sessionsCreated:1,flowsRemaining:0});
 });
});
