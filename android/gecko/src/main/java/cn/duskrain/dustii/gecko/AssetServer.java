package cn.duskrain.dustii.gecko;

import android.content.res.AssetManager;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

/** Read-only, manifest-bounded assets. Never a game server or a LAN listener. */
final class AssetServer implements AutoCloseable {
    static final int PORT=27186;
    private final AssetManager assets;
    private final Map<String,Long> files=new HashMap<>();
    private final ServerSocket socket;
    private final ThreadPoolExecutor pool=new ThreadPoolExecutor(4,4,10,TimeUnit.SECONDS,new ArrayBlockingQueue<>(64));
    AssetServer(AssetManager assets) throws Exception {
        this.assets=assets;
        byte[] metadata;
        try(InputStream input=assets.open("bundle-manifest.json");ByteArrayOutputStream output=new ByteArrayOutputStream()){byte[] buffer=new byte[8192];int n;while((n=input.read(buffer))!=-1){output.write(buffer,0,n);if(output.size()>2097152)throw new IOException("Manifest too large");}metadata=output.toByteArray();}
        JSONArray entries=new JSONObject(new String(metadata,StandardCharsets.UTF_8)).getJSONArray("files");
        for(int i=0;i<entries.length();i++){JSONObject f=entries.getJSONObject(i);files.put(f.getString("path"),f.getLong("bytes"));}
        files.put("bundle-manifest.json",(long)metadata.length);
        socket=new ServerSocket();socket.setReuseAddress(true);socket.bind(new InetSocketAddress(InetAddress.getByName("127.0.0.1"),PORT),32);
        new Thread(()->{while(!socket.isClosed())try{Socket client=socket.accept();try{pool.execute(()->serve(client));}catch(RejectedExecutionException e){client.close();}}catch(IOException ignored){ }},"DustII-assets").start();
    }
    private static String mime(String p){
        String extension=p.substring(p.lastIndexOf('.')+1).toLowerCase(Locale.ROOT);
        switch(extension){case "html":return "text/html; charset=utf-8";case "js":return "text/javascript";case "css":return "text/css";case "json":return "application/json";case "webmanifest":return "application/manifest+json";case "svg":return "image/svg+xml";case "png":return "image/png";case "jpg":case "jpeg":return "image/jpeg";case "webp":return "image/webp";case "mp3":return "audio/mpeg";case "ogg":return "audio/ogg";case "wav":return "audio/wav";default:return "application/octet-stream";}
    }
    private static void headers(OutputStream out,int code,String type,long length,String extra) throws IOException {
        out.write(("HTTP/1.1 "+code+" "+(code<400?"OK":"Error")+"\r\nConnection: close\r\nContent-Type: "+type+"\r\nContent-Length: "+length+"\r\nX-Content-Type-Options: nosniff\r\nCross-Origin-Resource-Policy: same-origin\r\n"+extra+"\r\n").getBytes(StandardCharsets.US_ASCII));
    }
    private void serve(Socket client){
        try(Socket connection=client){
            connection.setSoTimeout(5000);BufferedReader reader=new BufferedReader(new InputStreamReader(connection.getInputStream(),StandardCharsets.US_ASCII));OutputStream out=connection.getOutputStream();
            String first=reader.readLine();if(first==null||first.length()>4096)return;String[] parts=first.split(" ");if(parts.length!=3)return;
            String host="",range=null;int total=0;
            for(String line;(line=reader.readLine())!=null&&!line.isEmpty();){total+=line.length();if(total>16384)return;int c=line.indexOf(':');if(c<0)continue;String key=line.substring(0,c).toLowerCase(Locale.ROOT),value=line.substring(c+1).trim();if(key.equals("host"))host=value;if(key.equals("range"))range=value;}
            if(!host.equals("127.0.0.1:"+PORT)){headers(out,403,"text/plain",0,"");return;}
            if(!parts[0].equals("GET")&&!parts[0].equals("HEAD")){headers(out,405,"text/plain",0,"Allow: GET, HEAD\r\n");return;}
            String path=URLDecoder.decode(parts[1].split("\\?",2)[0],"UTF-8");if(!path.startsWith("/")||path.contains("..")||path.contains("\\")||path.indexOf('\0')>=0){headers(out,403,"text/plain",0,"");return;}
            path=path.substring(1);
            if(path.startsWith("__remote_assets__/assets/")){remote(out,path.substring("__remote_assets__/".length()),parts[0],range);return;}
            Long size=files.get(path);if(size==null){headers(out,404,"text/plain",0,"");return;}
            long start=0,end=size-1;int code=200;String extra="Cache-Control: no-cache\r\nAccept-Ranges: bytes\r\n";
            if(range!=null){java.util.regex.Matcher match=java.util.regex.Pattern.compile("bytes=(\\d+)-(\\d*)").matcher(range);if(!match.matches()){headers(out,416,"text/plain",0,"Content-Range: bytes */"+size+"\r\n");return;}start=Long.parseLong(match.group(1));if(!match.group(2).isEmpty())end=Math.min(end,Long.parseLong(match.group(2)));if(start>end){headers(out,416,"text/plain",0,"Content-Range: bytes */"+size+"\r\n");return;}code=206;extra+="Content-Range: bytes "+start+"-"+end+"/"+size+"\r\n";}
            long length=end-start+1;headers(out,code,mime(path),length,extra);if(parts[0].equals("HEAD"))return;
            try(InputStream input=assets.open(path,AssetManager.ACCESS_STREAMING)){long skipped=0;while(skipped<start){long n=input.skip(start-skipped);if(n<=0)throw new EOFException();skipped+=n;}byte[] buffer=new byte[65536];while(length>0){int n=input.read(buffer,0,(int)Math.min(buffer.length,length));if(n<0)break;out.write(buffer,0,n);length-=n;}}
        }catch(Exception ignored){ /* A closed tab may cancel any asset response. */ }
    }
    private void remote(OutputStream out,String path,String method,String range) throws Exception {
        // Optional skins/music use the same fixed HTTPS asset origin as WebView.
        // No arbitrary URLs, redirects, writes, server logic or secret headers.
        if(!path.matches("assets/[A-Za-z0-9_./() -]+\\.(json|glb|gltf|bin|u8|f32|png|webp|jpg|jpeg|svg|hdr|ogg|mp3|wav)")){headers(out,404,"text/plain",0,"");return;}
        HttpURLConnection remote=(HttpURLConnection)new URI("https","cs2.duskrain.cn","/"+path,null).toURL().openConnection();
        remote.setConnectTimeout(10000);remote.setReadTimeout(15000);remote.setInstanceFollowRedirects(false);remote.setRequestMethod(method);remote.setRequestProperty("Accept-Encoding","identity");
        if(range!=null&&range.matches("bytes=\\d+-\\d*"))remote.setRequestProperty("Range",range);
        try{
            int code=remote.getResponseCode();long size=remote.getContentLengthLong();
            if((code!=200&&code!=206)||size<0||size>64L*1024*1024){headers(out,502,"text/plain",0,"");return;}
            String extra="Cache-Control: no-cache\r\n";String contentRange=remote.getHeaderField("Content-Range");
            if(code==206&&contentRange!=null&&contentRange.matches("bytes \\d+-\\d+/\\d+"))extra+="Content-Range: "+contentRange+"\r\n";
            headers(out,code,mime(path),size,extra);if(method.equals("HEAD"))return;
            try(InputStream input=remote.getInputStream()){byte[] buffer=new byte[65536];long remaining=size;while(remaining>0){int n=input.read(buffer,0,(int)Math.min(buffer.length,remaining));if(n<0)throw new EOFException();out.write(buffer,0,n);remaining-=n;}}
        }finally{remote.disconnect();}
    }
    @Override public void close(){try{socket.close();}catch(IOException ignored){}pool.shutdownNow();}
}
