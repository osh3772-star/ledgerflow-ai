import {describe,expect,it} from 'vitest';
import {memoryHumanSessionStore,humanSessionCipher,sessionTokenHash,validateSessionEncryptionKey,HUMAN_SESSION_TTL_MS} from '../../apps/mcp-server/src/human-session-store.js';
const company='00000000-0000-4000-8000-000000000001',userId='00000000-0000-4000-8000-000000000002';
const key=Buffer.alloc(32,7).toString('base64'),token='a'.repeat(64);
const session=(now=Date.now())=>({userId,accessToken:'fixture-jwt-must-stay-encrypted',csrf:'c'.repeat(48),expires:now+HUMAN_SESSION_TTL_MS});
describe('bounded human sessions and authenticated encryption',()=>{
  it('expires and revokes in-memory sessions and never returns mutable stored references',async()=>{
    let now=Date.now();const store=memoryHumanSessionStore(()=>now),value=session(now);
    await store.put(token,value);const loaded=(await store.get(token))!;loaded.csrf='d'.repeat(48);
    expect((await store.get(token))?.csrf).toBe(value.csrf);
    await store.delete(token);expect(await store.get(token)).toBeUndefined();
    await store.put(token,value);now=value.expires;expect(await store.get(token)).toBeUndefined();
  });
  it('rejects malformed tokens, CSRF and overlong lifetimes without echoing inputs',async()=>{
    const store=memoryHumanSessionStore();
    for(const [t,value] of [['private-token',session()],[token,{...session(),csrf:'private-csrf'}],
      [token,{...session(),expires:Date.now()+HUMAN_SESSION_TTL_MS+60000}]] as const){
      await expect(store.put(t,value)).rejects.toMatchObject({code:'INVALID_SESSION'});
    }
    expect(await store.get('private-token')).toBeUndefined();
  });
  it('uses unique nonces and rejects tampering, wrong company/token and wrong keys',()=>{
    const cipher=humanSessionCipher(key,company),hash=sessionTokenHash(token),value=session();
    const sealed=cipher.seal(hash,value),other=cipher.seal(hash,value);
    expect(cipher.open(hash,sealed)).toEqual(value);
    expect(sealed.nonce.equals(other.nonce)).toBe(false);
    expect(sealed.ciphertext.includes(Buffer.from(value.accessToken))).toBe(false);
    expect(sealed.ciphertext.includes(Buffer.from(value.csrf))).toBe(false);
    const corrupt=Buffer.from(sealed.ciphertext);corrupt[0]=corrupt[0]!^1;
    expect(cipher.open(hash,{...sealed,ciphertext:corrupt})).toBeUndefined();
    expect(cipher.open(sessionTokenHash('b'.repeat(64)),sealed)).toBeUndefined();
    expect(humanSessionCipher(key,'00000000-0000-4000-8000-000000000003').open(hash,sealed)).toBeUndefined();
    expect(humanSessionCipher(Buffer.alloc(32,8).toString('base64'),company).open(hash,sealed)).toBeUndefined();
  });
  it('accepts only canonical 32-byte encryption keys and does not expose them through the cipher object',()=>{
    expect(()=>validateSessionEncryptionKey(key)).not.toThrow();
    for(const invalid of ['', 'private-key-fixture',Buffer.alloc(16).toString('base64'),key+'!']){
      expect(()=>validateSessionEncryptionKey(invalid)).toThrow('canonical base64');
    }
    expect(JSON.stringify(humanSessionCipher(key,company))).not.toContain(key);
  });
});
