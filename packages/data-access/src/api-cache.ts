import type {Pool} from 'pg';
import type {ApiCache,CacheRecord} from '@ledgerflow/public-data';
export class PostgresApiCache implements ApiCache{
  constructor(private pool:Pool){}
  async get(key:string):Promise<CacheRecord|null>{
    const r=(await this.pool.query('SELECT response,origin,fetched_at,expires_at,source_url FROM public.external_api_cache WHERE cache_key=$1',[key])).rows[0];
    return r?{response:r.response,origin:r.origin,fetchedAt:r.fetched_at.toISOString(),expiresAt:r.expires_at.toISOString(),sourceUrl:r.source_url}:null;
  }
  async put(key:string,provider:Parameters<ApiCache['put']>[1],row:CacheRecord){
    await this.pool.query('INSERT INTO public.external_api_cache(cache_key,provider,origin,response,source_url,fetched_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(cache_key) DO UPDATE SET response=excluded.response,origin=excluded.origin,fetched_at=excluded.fetched_at,expires_at=excluded.expires_at,source_url=excluded.source_url',
      [key,provider,row.origin,JSON.stringify(row.response),row.sourceUrl,row.fetchedAt,row.expiresAt]);
  }
}
