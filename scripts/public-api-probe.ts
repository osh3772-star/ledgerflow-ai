import { createHash } from 'node:crypto';

export const PROVIDERS = ['nts', 'dart', 'law', 'ecos'] as const;
export type Provider = typeof PROVIDERS[number];
type Json = Record<string, unknown>;
type FetchLike = typeof fetch;
export interface ProbeResult {
  provider: Provider;
  origin: 'public_api_live';
  endpoint: string;
  requestedCriteria: Record<string, string>;
  fetchedAt: string;
  attempts: number;
  httpStatus: number | null;
  success: boolean;
  code: string;
  responseSha256?: string;
  summary?: Record<string, string | number | boolean>;
}
const isObject = (value: unknown): value is Json => value !== null && typeof value === 'object' && !Array.isArray(value);
const asList = (value: unknown): Json[] => {
  const list = Array.isArray(value) ? value : isObject(value) ? [value] : [];
  return list.filter(isObject);
};
const sha = (value: string) => createHash('sha256').update(value).digest('hex');
export const credentialFingerprint = (key: string) => sha(key);

function buildRequest(provider: Provider, key: string) {
  if (!key.trim()) throw new Error('Missing credential.');
  switch (provider) {
    case 'nts': {
      const endpoint = 'https://api.odcloud.kr/api/nts-businessman/v1/status';
      // Accept the portal's Encoding or Decoding key; encode exactly once for the URL.
      const decoded = /%[\da-f]{2}/iu.test(key) ? decodeURIComponent(key) : key;
      const url = new URL(endpoint);
      url.search = new URLSearchParams({ serviceKey: decoded, returnType: 'JSON' }).toString();
      return { endpoint, url: url.toString(), criteria: { businessNumber: '0000000000', purpose: 'authentication/schema probe; intentionally unregistered' },
        init: { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ b_no: ['0000000000'] }) } };
    }
    case 'dart': {
      const endpoint = 'https://opendart.fss.or.kr/api/list.json';
      const criteria = { corp_code: '00126380', bgn_de: '20250101', end_de: '20251231', page_no: '1', page_count: '1' };
      const url = new URL(endpoint);
      url.search = new URLSearchParams({ crtfc_key: key, ...criteria }).toString();
      return { endpoint, url: url.toString(), criteria, init: {} };
    }
    case 'law': {
      const endpoint = 'https://www.law.go.kr/DRF/lawSearch.do';
      const criteria = { target: 'eflaw', type: 'JSON', query: '법인세법', nw: '3', page: '1', display: '1' };
      const url = new URL(endpoint);
      url.search = new URLSearchParams({ OC: key, ...criteria }).toString();
      return { endpoint, url: url.toString(), criteria, init: {} };
    }
    case 'ecos': {
      const endpoint = 'https://ecos.bok.or.kr/api/StatisticSearch';
      const criteria = { statCode: '200Y101', cycle: 'A', from: '2020', to: '2023', itemCode: '10101', start: '1', end: '3' };
      const url = endpoint + '/' + encodeURIComponent(key) + '/json/kr/1/3/200Y101/A/2020/2023/10101';
      return { endpoint, url, criteria, init: {} };
    }
  }
}

function summarize(provider: Provider, json: Json): { success: boolean; code: string; summary?: Record<string, string | number | boolean> } {
  switch (provider) {
    case 'nts': {
      const rows = asList(json.data);
      if (json.status_code !== 'OK') return { success: false, code: 'PROVIDER_REJECTED' };
      if (rows.length !== 1 || rows[0]?.b_no !== '0000000000' || typeof rows[0]?.tax_type !== 'string')
        return { success: false, code: 'SCHEMA_MISMATCH' };
      return { success: true, code: 'OK', summary: { rows: 1, registeredTestBusiness: false, verificationScope: 'authenticated status endpoint only' } };
    }
    case 'dart': {
      // Provider messages are untrusted, potentially sensitive content; expose only known status codes.
      const status = typeof json.status === 'string' && /^\d{3}$/u.test(json.status) ? json.status : 'UNKNOWN';
      if (status !== '000') return { success: false, code: 'DART_' + status };
      const rows = asList(json.list);
      if (!rows.length || rows.some((row) => row.corp_code !== '00126380' || typeof row.rcept_no !== 'string'))
        return { success: false, code: 'SCHEMA_MISMATCH' };
      return { success: true, code: '000', summary: { rows: rows.length, totalCount: Number(json.total_count), verificationScope: 'disclosure search only' } };
    }
    case 'law': {
      const root = json.LawSearch;
      if (!isObject(root)) return { success: false, code: 'SCHEMA_MISMATCH' };
      const resultCode = String(root.resultCode ?? '');
      if (resultCode !== '00') return { success: false, code: 'PROVIDER_REJECTED' };
      const rows = asList(root.law);
      const row = rows[0];
      if (!row || typeof row['법령명한글'] !== 'string' || !/^\d{8}$/u.test(String(row['시행일자'])))
        return { success: false, code: 'SCHEMA_MISMATCH' };
      return { success: true, code: '00', summary: { rows: rows.length, totalCount: Number(root.totalCnt),
        effectiveDate: String(row['시행일자']), verificationScope: 'current-law search only; no transaction-date legal determination' } };
    }
    case 'ecos': {
      if (isObject(json.RESULT)) {
        const code = String(json.RESULT.CODE);
        return { success: false, code: /^(?:INFO|ERROR)-\d{3}$/u.test(code) ? 'ECOS_' + code : 'PROVIDER_REJECTED' };
      }
      const root = json.StatisticSearch;
      if (!isObject(root)) return { success: false, code: 'SCHEMA_MISMATCH' };
      const rows = asList(root.row);
      if (!rows.length || rows.some((row) => row.STAT_CODE !== '200Y101' || typeof row.TIME !== 'string'
        || typeof row.DATA_VALUE !== 'string' || !/^-?\d+(?:\.\d+)?$/u.test(row.DATA_VALUE)))
        return { success: false, code: 'SCHEMA_MISMATCH' };
      return { success: true, code: 'OK', summary: { rows: rows.length, totalCount: Number(root.list_total_count),
        observationFrom: String(rows[0]!.TIME), observationTo: String(rows.at(-1)!.TIME), verificationScope: 'GDP indicator only; exchange/base-rate registry not verified' } };
    }
  }
}

export async function probePublicApi(provider: Provider, key: string, options: {
  fetchImpl?: FetchLike; timeoutMs?: number; maxAttempts?: number; wait?: (ms: number) => Promise<void>;
} = {}): Promise<ProbeResult> {
  const base: ProbeResult = { provider, origin: 'public_api_live', endpoint: '', requestedCriteria: {},
    fetchedAt: new Date().toISOString(), attempts: 0, httpStatus: null, success: false, code: 'CONFIG_ERROR' };
  let request: ReturnType<typeof buildRequest>;
  try { request = buildRequest(provider, key); } catch { return base; }
  base.endpoint = request.endpoint;
  base.requestedCriteria = request.criteria;
  const fetchImpl = options.fetchImpl ?? fetch;
  const wait = options.wait ?? ((ms) => new Promise((done) => setTimeout(done, ms)));
  const maxAttempts = Math.max(1, Math.min(2, options.maxAttempts ?? 2));
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    base.attempts = attempt;
    try {
      const response = await fetchImpl(request.url, { ...request.init, redirect: 'error', signal: AbortSignal.timeout(options.timeoutMs ?? 12_000) });
      base.httpStatus = response.status;
      if (!response.ok) {
        base.code = 'HTTP_' + response.status;
        if ([429, 502, 503, 504].includes(response.status) && attempt < maxAttempts) {
          // A long provider Retry-After stays a recorded failure for a later explicit user retry.
          const seconds = Number(response.headers.get('retry-after') ?? '1');
          if (Number.isFinite(seconds) && seconds > 2) return base;
          await wait(1000); continue;
        }
        return base;
      }
      const body = await response.text();
      if (body.length > 2_000_000) { base.code = 'RESPONSE_TOO_LARGE'; return base; }
      base.responseSha256 = sha(body);
      let json: unknown;
      try { json = JSON.parse(body); } catch { base.code = 'NON_JSON_RESPONSE'; return base; }
      if (!isObject(json)) { base.code = 'SCHEMA_MISMATCH'; return base; }
      return { ...base, ...summarize(provider, json) };
    } catch {
      // Never surface fetch errors: they may contain the credential-bearing URL.
      base.code = 'NETWORK_OR_TIMEOUT';
      if (attempt < maxAttempts) await wait(1000);
    }
  }
  return base;
}
