import {createClient} from '@supabase/supabase-js';
import {DomainError,uuidSchema} from '@ledgerflow/contracts';
import type {HumanAuthentication} from './human-routes.js';
export function supabaseHumanAuthentication(url:string,publishableKey:string):HumanAuthentication{
  const target=new URL(url);
  if(target.protocol!=='https:'&&!(target.protocol==='http:'&&['127.0.0.1','localhost'].includes(target.hostname)))
    throw new Error('Supabase Auth requires HTTPS or a local development endpoint.');
  const client=createClient(target.href,publishableKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},
    global:{fetch:async(url,init)=>fetch(url,{...init,redirect:'error',signal:AbortSignal.timeout(8000)})}});
  return {
    async verify(token){
      const {data,error}=await client.auth.getUser(token);
      if(error||!data.user)throw new DomainError('UNAUTHENTICATED','세션을 다시 인증하세요.');
      return uuidSchema.parse(data.user.id);
    },
  };
}
