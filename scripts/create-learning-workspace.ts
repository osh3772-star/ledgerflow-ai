import {dirname,resolve,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import type {installInPlace} from './learning-in-place.js';

const sourceRoot=resolve(dirname(fileURLToPath(import.meta.url)),'..');
type Options=Parameters<typeof installInPlace>[0];
export async function createLearningWorkspace(options:Omit<Options,'sourceDirectory'>&{sourceDirectory?:string}){
 // Node 24 strips types but does not remap sibling .js specifiers to .ts.
 // This dynamic URL keeps setup dependency-free, including on a fresh PC.
 const module=await import(pathToFileURL(join(sourceRoot,'scripts/learning-in-place.ts')).href) as {installInPlace:typeof installInPlace};
 return module.installInPlace({...options,sourceDirectory:options.sourceDirectory??sourceRoot});
}
export function setupArguments(args:string[]){
 const options:Record<string,string>={};
 for(let i=0;i<args.length;i++){
  if(args[i]==='--in-place')continue;
  if(!['--client','--directory'].includes(args[i]!)||!args[i+1]||args[i+1]!.startsWith('--')||options[args[i]!])throw new Error('INVALID_SETUP_ARGUMENTS');
  options[args[i]!]=args[++i]!;
 }
 if(!['codex','claude','antigravity'].includes(options['--client']??''))throw new Error('CURRENT_CLIENT_REQUIRED');
 return {directory:resolve(options['--directory']??process.cwd()),client:options['--client'] as Options['client']};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
 const args=process.argv.slice(2);
 if(args.length===1&&args[0]==='--help')console.log('node <source>/scripts/create-learning-workspace.ts --in-place --client codex|claude|antigravity (current folder, existing files preserved)');
 else try{console.log(JSON.stringify(await createLearningWorkspace(setupArguments(args))));}
 catch(error){console.error(JSON.stringify({prepared:false,error:error instanceof Error&&/^[A-Z][A-Z0-9_]+$/u.test(error.message)?error.message:'LEARNING_SETUP_FAILED',nativeClientVerified:false}));process.exitCode=1;}
}
