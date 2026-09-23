import {startPortable} from './launch.mjs';
import {spawn} from 'node:child_process';
startPortable({mode:'offline',worker:true,port:27196}).then(app=>{
  console.log(`DUST II OFFLINE 0.1.0\n${app.url}\nKeep this window open while playing. Close it to stop.\n游戏期间请保留此窗口，结束后关闭窗口。`);
  if(!process.argv.includes('--no-browser')){
    const child=spawn('rundll32.exe',['url.dll,FileProtocolHandler',app.url],{detached:true,stdio:'ignore',windowsHide:true});
    child.on('error',()=>console.log('Open the address above in Edge or Chrome.'));child.unref();
  }
  if(!app.reused){const close=()=>app.close().then(()=>process.exit());process.once('SIGINT',close);process.once('SIGTERM',close);}
}).catch(e=>{console.error(e.message);process.exitCode=1;});
