import {checkContainerHealth} from './health-check.js';
const healthy=await checkContainerHealth(process.env.LEDGERFLOW_MCP_PORT??'8787');
console.log(JSON.stringify({healthy}));
if(!healthy)process.exitCode=1;
