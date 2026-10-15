// Infrastructure liveness only. This does not run agents or prove DB readiness.
export async function checkContainerHealth(port:string,fetcher:typeof fetch=fetch):Promise<boolean>{
  if(!/^[1-9]\d{0,4}$/u.test(port)||Number(port)>65535)return false;
  try{
    const response=await fetcher('http://127.0.0.1:'+port+'/health',{
      redirect:'error',signal:AbortSignal.timeout(5000),headers:{Accept:'application/json'},
    });
    if(!response.ok)return false;
    const data:unknown=await response.json();
    return data!==null&&typeof data==='object'&&'server' in data&&data.server==='ledgerflow-accounting-mcp'
      &&'ready' in data&&data.ready===true;
  }catch{return false;}
}
