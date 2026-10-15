import { createMcpHandler } from '@modelcontextprotocol/server';
import { serve } from '@hono/node-server';
import {timingSafeEqual,createHash} from 'node:crypto';
import {readFile,realpath} from 'node:fs/promises';
import {resolve,sep} from 'node:path';
import { createLedgerFlowServer, SERVER_NAME, type ServerDependencies } from './server.js';

export async function startMcpHttp(dependencies: ServerDependencies, port = 8787) {
  const handler = createMcpHandler(() => createLedgerFlowServer(dependencies), {
    legacy: 'stateless', maxRequestBodySize: 64*1024, maxSubscriptions: 16,
    onerror: () => { /* Raw SDK errors may include client inputs; tool errors have their own safe audit. */ },
  });
  let actualPort = port;
  const allowedAuthority = (authority: string | null) => authority === '127.0.0.1:'+actualPort || authority === 'localhost:'+actualPort;
  const server = serve({
    hostname: '127.0.0.1', port, overrideGlobalObjects: false, fetch: async (request) => {
      const url = new URL(request.url);
      if (!allowedAuthority(request.headers.get('host'))) return new Response('Forbidden host', {status:403});
      const origin = request.headers.get('origin');
      if (origin && origin !== 'http://127.0.0.1:'+actualPort && origin !== 'http://localhost:'+actualPort)
        return new Response('Forbidden origin', {status:403});
      if (url.pathname === '/health' && request.method === 'GET')
        return Response.json({ server: SERVER_NAME, ready: true, readOnly: !dependencies.accounting });
      if(url.pathname.startsWith('/api/')&&dependencies.humanRouter){
        if(request.method!=='GET'&&(!origin||origin!=='http://127.0.0.1:'+actualPort&&origin!=='http://localhost:'+actualPort))
          return new Response('Same-origin human request required',{status:403});
        return dependencies.humanRouter(request);
      }
      if(request.method==='GET'&&(url.pathname==='/'||url.pathname.startsWith('/_astro/'))){
        const root=resolve('apps/web/dist'),target=resolve(root,url.pathname==='/'?'index.html':'.'+url.pathname);
        if(!target.startsWith(root+sep)||url.pathname.includes('..'))return new Response('Not found',{status:404});
        try{
          const actual=await realpath(target);if(!actual.startsWith(root+sep))return new Response('Not found',{status:404});
          const data=await readFile(actual),type=actual.endsWith('.js')?'text/javascript':actual.endsWith('.css')?'text/css':'text/html';
          return new Response(data,{headers:{'Content-Type':type+'; charset=utf-8','X-Content-Type-Options':'nosniff',
            'Content-Security-Policy':"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'"}});
        }catch{return new Response('Build the dashboard with pnpm web:build.',{status:503});}
      }
      if (url.pathname !== '/mcp' || url.search) return new Response('Not found', {status:404});
      if(dependencies.mcpToken){
        const supplied=request.headers.get('authorization')?.replace(/^Bearer /u,'')??'';
        const digest=(v:string)=>createHash('sha256').update(v).digest();
        if(!timingSafeEqual(digest(supplied),digest(dependencies.mcpToken)))return new Response('Unauthorized',{status:401});
      }
      try { return await handler.fetch(request); }
      catch { return new Response('MCP request failed', {status:500}); }
    },
  });
  try {
    await new Promise<void>((resolve,reject) => {
      server.once('error',reject);
      server.once('listening',()=>resolve());
    });
  } catch {
    await handler.close();
    throw new Error('MCP HTTP listener could not start.');
  }
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('MCP listener address is unavailable.');
  actualPort = address.port;
  return {
    url: 'http://127.0.0.1:'+actualPort+'/mcp',
    async close() {
      await handler.close();
      await new Promise<void>((resolve,reject)=>server.close((error)=>error?reject(error):resolve()));
    },
  };
}
