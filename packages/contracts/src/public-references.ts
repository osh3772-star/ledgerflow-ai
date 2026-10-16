import {z} from 'zod';
import {dateSchema} from './base.js';

export const publicReferenceItemSchema=z.strictObject({
  provider:z.enum(['nts','dart','law','ecos']),status:z.enum(['available','unavailable','not_applicable']),
  purpose:z.string().max(500),note:z.string().max(1500),tool:z.string().max(80).optional(),
  provenance:z.strictObject({origin:z.enum(['mock','public_api_live']),sourceUrl:z.url().refine(value=>{
    const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash&&
      ['api.odcloud.kr','opendart.fss.or.kr','www.law.go.kr','ecos.bok.or.kr'].includes(url.hostname);
  }),fetchedAt:z.iso.datetime(),
    effectiveDate:z.string().nullable(),referencePeriod:z.string().nullable(),rawSha256:z.string().regex(/^[a-f0-9]{64}$/u),cacheHit:z.boolean()}).optional(),
  facts:z.record(z.string(),z.json()).optional(),errorCode:z.string().regex(/^[A-Z0-9_]+$/u).max(100).optional(),
}).refine(item=>item.status!=='available'||Boolean(item.provenance),{message:'Available references require provenance.'});
export const publicReferenceReportSchema=z.strictObject({
  transactionDate:dateSchema,preparedAt:z.iso.datetime(),items:z.array(publicReferenceItemSchema).max(8),
  humanReviewRequired:z.literal(true),affectsAmounts:z.literal(false),
});
export type PublicReferenceItem=z.output<typeof publicReferenceItemSchema>;
export type PublicReferenceReport=z.output<typeof publicReferenceReportSchema>;
