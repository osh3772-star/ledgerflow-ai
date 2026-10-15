import {createCipheriv,createDecipheriv,createHash,randomBytes} from 'node:crypto';
import {z} from 'zod';
import {DomainError,uuidSchema} from '@ledgerflow/contracts';

export const HUMAN_SESSION_TTL_MS=30*60*1000;
const tokenSchema=z.string().regex(/^[a-f0-9]{64}$/u);
const sessionSchema=z.strictObject({userId:uuidSchema,accessToken:z.string().min(1).max(16384).optional(),
  expires:z.number().int().positive(),csrf:z.string().regex(/^[a-f0-9]{48}$/u)});
export type HumanSession=z.output<typeof sessionSchema>;
export interface HumanSessionStore{
  readonly kind:'memory'|'postgres';
  get:(token:string)=>Promise<HumanSession|undefined>;
  put:(token:string,session:HumanSession)=>Promise<void>;
  delete:(token:string)=>Promise<void>;
}
export const sessionTokenHash=(token:string)=>createHash('sha256').update(token).digest('hex');
export function validateHumanSession(token:string,value:HumanSession,now=Date.now()):HumanSession{
  if(!tokenSchema.safeParse(token).success)throw new DomainError('INVALID_SESSION','유효한 세션이 필요합니다.');
  const parsed=sessionSchema.safeParse(value);
  if(!parsed.success||parsed.data.expires<=now||parsed.data.expires>now+HUMAN_SESSION_TTL_MS)
    throw new DomainError('INVALID_SESSION','유효한 세션이 필요합니다.');
  return parsed.data;
}
export function memoryHumanSessionStore(now:()=>number=Date.now):HumanSessionStore{
  const sessions=new Map<string,HumanSession>();
  return {kind:'memory',async get(token){
    if(!tokenSchema.safeParse(token).success)return undefined;
    const hash=sessionTokenHash(token),value=sessions.get(hash);
    if(value&&value.expires<=now()){sessions.delete(hash);return undefined;}
    return value?{...value}:undefined;
  },async put(token,value){
    const parsed=validateHumanSession(token,value,now());
    for(const [hash,session] of sessions)if(session.expires<=now())sessions.delete(hash);
    sessions.set(sessionTokenHash(token),parsed);
  },async delete(token){sessions.delete(sessionTokenHash(token));}};
}
export interface SealedHumanSession{nonce:Buffer;ciphertext:Buffer;authTag:Buffer}
function encryptionKey(encoded:string){
  const key=Buffer.from(encoded,'base64');
  if(key.length!==32||key.toString('base64')!==encoded)
    throw new Error('LEDGERFLOW_SESSION_ENCRYPTION_KEY must be canonical base64 of 32 random bytes.');
  return key;
}
export function validateSessionEncryptionKey(encoded:string){encryptionKey(encoded);}
export function humanSessionCipher(encodedKey:string,companyId:string){
  const key=encryptionKey(encodedKey),company=uuidSchema.parse(companyId);
  const aad=(hash:string)=>Buffer.from('ledgerflow:human-session:v1:'+company+':'+hash,'utf8');
  return {
    seal(hash:string,value:HumanSession):SealedHumanSession{
      const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,nonce,{authTagLength:16});
      cipher.setAAD(aad(hash));
      const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);
      return {nonce,ciphertext,authTag:cipher.getAuthTag()};
    },
    open(hash:string,value:SealedHumanSession):HumanSession|undefined{
      try{
        if(value.nonce.length!==12||value.authTag.length!==16||value.ciphertext.length>32768)return undefined;
        const decipher=createDecipheriv('aes-256-gcm',key,value.nonce,{authTagLength:16});
        decipher.setAAD(aad(hash));decipher.setAuthTag(value.authTag);
        return sessionSchema.parse(JSON.parse(Buffer.concat([decipher.update(value.ciphertext),decipher.final()]).toString('utf8')));
      }catch{return undefined;}
    },
  };
}
