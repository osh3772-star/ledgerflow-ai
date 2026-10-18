// Local Workerd regression harness: no credentials, external requests or ledger DB.
import {Buffer} from 'node:buffer';
import {createHash} from 'node:crypto';
import type {Pool} from 'pg';
import {RemoteAuth,digest,sealSession,openSession} from '../../apps/mcp-server/src/remote-auth.js';
import {RemoteGoogleAuth,GOOGLE_FLOW_COOKIE} from '../../apps/mcp-server/src/remote-google-auth.js';

// Wrangler normally injects the Node-compatible Buffer global into its bundle.
Object.assign(globalThis,{Buffer});
const key=Buffer.alloc(32,17).toString('base64');
const identity={userId:'10000000-0000-4000-8000-000000000001',email:'한빛+로그인@example.test',
 accessToken:'fixture-access',refreshToken:'fixture-refresh',csrf:'fixture-csrf'};
const isRejected=(operation:()=>unknown)=>{try{operation();return false;}catch{return true;}};

export default {async fetch(request:Request){
 if(new URL(request.url).pathname==='/session'){
  const encrypted=sealSession(identity,key,'browser-a');
  return Response.json({roundTrip:openSession(encrypted,key,'browser-a'),
   wrongBrowserRejected:isRejected(()=>openSession(encrypted,key,'browser-b')),
   wrongKeyRejected:isRejected(()=>openSession(encrypted,Buffer.alloc(32,18).toString('base64'),'browser-a')),
   encrypted:!encrypted.includes('fixture-access')&&!encrypted.includes('한빛')});
 }
 const flows=new Map<string,string>(),sessions=new Map<string,string>();let expectedChallenge='',pkceVerified=false;
 const pool={async query(sql:string,values:unknown[]=[]){
  if(sql.startsWith('DELETE FROM private.remote_login_flows WHERE expires_at'))return {rows:[]};
  if(sql.startsWith('INSERT INTO private.remote_login_flows')){
   flows.set(String(values[0]),String(values[1]));return {rows:[]};
  }
  if(sql.startsWith('DELETE FROM private.remote_login_flows WHERE token_hash')){
   const value=flows.get(String(values[0]));flows.delete(String(values[0]));
   return {rows:value?[{encrypted_flow:value}]:[]};
  }
  if(sql.startsWith('INSERT INTO private.remote_browser_sessions')){
   sessions.set(String(values[0]),String(values[2]));return {rows:[]};
  }
  throw new Error('UNEXPECTED_TEST_QUERY');
 }} as unknown as Pool;
 const fetcher:typeof fetch=async(input,init)=>{
  const url=String(input);
  if(url==='https://auth.example/auth/v1/settings')return Response.json({external:{google:true}});
  if(url==='https://auth.example/auth/v1/token?grant_type=pkce'){
   const body=JSON.parse(String(init?.body));
   pkceVerified=body.auth_code==='fixture-code'&&createHash('sha256').update(body.code_verifier).digest('base64url')===expectedChallenge;
   if(!pkceVerified)return Response.json({error:'invalid_grant'},{status:400});
   return Response.json({access_token:identity.accessToken,refresh_token:identity.refreshToken});
  }
  if(url==='https://auth.example/auth/v1/user')return Response.json({id:identity.userId,email:identity.email,
   email_confirmed_at:'2026-10-18',identities:[{provider:'google'}]});
  throw new Error('EXTERNAL_REQUEST_FORBIDDEN');
 };
 const auth=new RemoteAuth(pool,{origin:'https://site.example',supabaseUrl:'https://auth.example',publishableKey:'fixture',encryptionKey:key},fetcher);
 const google=new RemoteGoogleAuth(auth),start=await google.begin({returnTo:'/'});
 expectedChallenge=new URL(start.redirect).searchParams.get('code_challenge')!;
 const storedFlow=flows.get(digest(start.token))!;
 const callback=new Request('https://site.example/api/remote/google/callback?code=fixture-code',
  {headers:{Cookie:GOOGLE_FLOW_COOKIE+'='+start.token}});
 const finished=await google.finish(callback);
 const storedSession=sessions.get(digest(finished.token))!;
 let replayRejected=false;try{await google.finish(callback);}catch{replayRejected=true;}
 return Response.json({pkceVerified,returnTo:finished.returnTo,email:finished.session.email,
  storedEmail:openSession(storedSession,key,digest(finished.token)).email,replayRejected,
  flowEncrypted:!storedFlow.includes('verifier'),sessionEncrypted:!storedSession.includes('fixture-access'),
  sessionsCreated:sessions.size,flowsRemaining:flows.size});
}};
