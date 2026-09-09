// Local-only network jitter fixture. No game state or input is rewritten.
import {createServer,request} from 'node:http';
import WebSocket,{WebSocketServer} from 'ws';
const server=createServer((req,res)=>{const upstream=request({hostname:'127.0.0.1',port:3003,path:req.url,method:req.method,headers:req.headers},response=>{res.writeHead(response.statusCode,response.headers);response.pipe(res);});upstream.on('error',()=>{res.writeHead(502);res.end();});req.pipe(upstream);});
const wss=new WebSocketServer({server,maxPayload:256*1024}),timers=new Set();let seed=731;
function delayed(target){
 const queue=[];let timer=null,lastAt=0;
 const pump=()=>{timer=null;while(queue.length&&queue[0].at<=Date.now()){const {raw}=queue.shift();if(target.readyState===WebSocket.OPEN)target.send(raw,{binary:false});}if(queue.length)schedule();};
 const schedule=()=>{timer=setTimeout(()=>{timers.delete(timer);pump();},Math.max(1,queue[0].at-Date.now()));timers.add(timer);};
 return raw=>{seed=(seed*1664525+1013904223)>>>0;const at=Math.max(lastAt,Date.now()+80+(seed%41)-20);lastAt=at;queue.push({at,raw});if(!timer)schedule();};
}
wss.on('connection',downstream=>{
 const upstream=new WebSocket('ws://127.0.0.1:3003/ws'),queue=[],toServer=delayed(upstream),toClient=delayed(downstream);
 downstream.on('message',raw=>upstream.readyState===WebSocket.OPEN?toServer(raw):queue.push(raw));
 upstream.on('open',()=>{for(const raw of queue)toServer(raw);queue.length=0;});upstream.on('message',toClient);
 upstream.on('error',()=>downstream.close(1011,'QA upstream error'));downstream.on('error',()=>upstream.terminate());
 downstream.on('close',()=>upstream.close());upstream.on('close',()=>downstream.close());
});
await new Promise(resolve=>server.listen(3006,'127.0.0.1',resolve));console.log('Local proxy :3006 → :3003, each direction 80 ± 20 ms, message order preserved');
const stop=()=>{for(const timer of timers)clearTimeout(timer);for(const socket of wss.clients)socket.terminate();server.close(()=>process.exit(0));};process.once('SIGINT',stop);process.once('SIGTERM',stop);
