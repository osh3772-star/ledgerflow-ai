// Explicit disposable portfolio profile. Preserve .env.local and the persistent
// runtime's fail-closed guard; this selects demo before main loads that file.
process.env.LEDGERFLOW_MCP_MODE='demo';
process.env.LEDGERFLOW_DATABASE_URL='';
process.env.LEDGERFLOW_HUMAN_SESSION_STORE='memory';
console.error('LedgerFlow local portfolio demo: synthetic PostgreSQL data; Supabase settings preserved and unused.');
await import('../apps/mcp-server/src/main.js');
