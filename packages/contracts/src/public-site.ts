import type {BusinessTransaction} from './base.js';
import type {PublicReferenceReport} from './public-references.js';

// Allowlisted build artifact from a disposable fixture database, never a user DB.
export interface PublicSiteSnapshot{
  schemaVersion:1;generatedAt:string;origin:'synthetic_erp';
  company:{companyId:string;name:string;periods:{id:string;from:string;to:string;status:string}[]};
  transactions:BusinessTransaction[];
  periods:Record<string,{trialBalance:unknown;financialStatements:unknown;audit:unknown}>;
  referenceExample:{transactionId:string;externalRef:string;report:PublicReferenceReport};
}
