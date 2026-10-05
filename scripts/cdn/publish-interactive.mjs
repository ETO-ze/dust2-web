import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {publishRelease,PublishError} from './publish-release.mjs';
import {createR2Client,validateR2Endpoint,validateBucket,S3Error} from './s3-client.mjs';

/** The two values are entered on the local terminal; never echo or persist them. */
export function readMaskedCredentials(input=process.stdin,output=process.stdout){
 if(!input.isTTY||typeof input.setRawMode!=='function')throw Error('Use an interactive local terminal for protected credential input');
 return new Promise((resolve,reject)=>{
  const fields=['Access Key ID','Secret Access Key'];
  const values=['',''];let field=0,skipLF=false,done=false;
  const previousRaw=!!input.isRaw,previousPaused=input.isPaused?.()??false;
  function finish(error){
   if(done)return;done=true;
   input.removeListener('data',onData);input.removeListener('end',onEnd);input.removeListener('error',onError);
   input.setRawMode(previousRaw);if(previousPaused)input.pause();
   if(error){values.fill('');reject(error);}
   else{const credentials={accessKeyId:values[0],secretAccessKey:values[1]};values.fill('');resolve(credentials);}
  }
  const onEnd=()=>finish(Error('Credential input ended before completion'));
  const onError=()=>finish(Error('Credential input failed'));
  function onData(data){
   for(const character of data.toString('utf8')){
    if(done)return;
    if(character==='\x03'){output.write('\n');finish(Error('Upload cancelled'));return;}
    if(character==='\n'&&skipLF){skipLF=false;continue;}
    skipLF=false;
    if(character==='\r'||character==='\n'){
     if(!values[field]){output.write('\nValue is required; enter it again: ');continue;}
     output.write('\n');skipLF=character==='\r';field++;
     if(field===2){finish();return;}
     output.write(fields[field]+' (hidden): ');continue;
    }
    if(character==='\b'||character==='\x7f'){
     if(values[field]){values[field]=values[field].slice(0,-1);output.write('\b \b');}continue;
    }
    if(!/^[\x21-\x7e]$/.test(character)||values[field].length>=512){finish(Error('Invalid or oversized credential input'));return;}
    values[field]+=character;output.write('*');
   }
  }
  input.on('data',onData);input.once('end',onEnd);input.once('error',onError);
  input.setRawMode(true);output.write(fields[0]+' (hidden): ');input.resume();
 });
}

export function parseInteractiveArgs(argv){
 const options={};
 for(let i=0;i<argv.length;i++){
  const flag=argv[i];if(flag==='--help'){options.help=true;continue;}
  if(!['--manifest','--endpoint','--bucket','--ready'].includes(flag)||!argv[i+1]||argv[i+1].startsWith('--')||Object.hasOwn(options,flag.slice(2)))throw Error('Invalid upload options');
  options[flag.slice(2)]=argv[++i];
 }
 if(options.help)return options;
 if(!options.manifest||!options.endpoint||!options.bucket)throw Error('--manifest, --endpoint and --bucket are required');
 validateR2Endpoint(options.endpoint);validateBucket(options.bucket);
 options.manifest=path.resolve(options.manifest);
 options.ready=path.resolve(options.ready??path.join(path.dirname(options.manifest),'READY.json'));
 return options;
}

async function main(){
 const options=parseInteractiveArgs(process.argv.slice(2));
 if(options.help){console.log('Local protected upload: --manifest <local.json> --endpoint <R2 HTTPS endpoint> --bucket <name> [--ready <READY.json>]. Enter bucket-scoped Access Key ID and Secret Access Key at the hidden local prompts; do not send them in chat.');return;}
 const plan=JSON.parse(await readFile(options.manifest,'utf8'));
 const progress=event=>{if(event.phase!=='object-verified'||event.verified%50===0||event.verified===event.assets)console.log(JSON.stringify(event));};
 await publishRelease(plan,{dryRun:true,onProgress:progress});
 console.log('Source verification passed. Upload stays private; game configuration is not changed.');
 let credentials=await readMaskedCredentials();
 try{
  const client=createR2Client({endpoint:options.endpoint,bucket:options.bucket,credentials});
  credentials=null;
  const result=await publishRelease(plan,{client,dryRun:false,readyPath:options.ready,onProgress:progress});
  console.log(JSON.stringify(result,null,2));
 }finally{credentials=null;}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
 main().catch(error=>{console.error(error instanceof PublishError||error instanceof S3Error?error.message:'Protected upload stopped; no game configuration was changed');process.exitCode=1;});
}
