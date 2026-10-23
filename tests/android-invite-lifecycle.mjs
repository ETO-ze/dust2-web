import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';

const javaTool=name=>process.env.JAVA_HOME?join(process.env.JAVA_HOME,'bin',name+(process.platform==='win32'?'.exe':'')):name;
const java=javaTool('java'),javac=javaTool('javac');
const jdkAvailable=[java,javac].every(tool=>spawnSync(tool,['-version'],{encoding:'utf8',windowsHide:true}).status===0);

test('Android invitations navigate once, preserve the live renderer and recover a missing renderer',{
 skip:jdkAvailable?false:'A JDK is required for the Android host lifecycle regression.',
},async t=>{
 const source=await readFile(new URL('../android/app/src/main/java/cn/duskrain/dustii/MainActivity.java',import.meta.url),'utf8');
 const method=source.match(/@Override protected void onNewIntent\(Intent intent\) \{[\s\S]*?\n    \}/)?.[0];
 assert.ok(method,'Run the actual Android method, rather than a rewritten navigation implementation.');
 const dir=await mkdtemp(join(tmpdir(),'dustii-android-invite-'));
 t.after(()=>rm(dir,{recursive:true,force:true}));
 // Android collaborators are replaced at their boundaries; the production
 // onNewIntent body below is compiled and executed unchanged on the host JDK.
 const harness=`
import java.net.URI;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

class HostActivity {
    int parentIntents;
    protected void onNewIntent(Intent intent) { parentIntents++; }
    void setIntent(Intent intent) { }
}
class Intent {
    final Uri data;
    Intent(String url) { data=url==null?null:Uri.parse(url); }
    Uri getData() { return data; }
}
class Uri {
    final URI value;
    Uri(String url) { value=URI.create(url); }
    static Uri parse(String url) { return new Uri(url); }
    String getScheme() { return value.getScheme(); }
    String getHost() { return value.getHost(); }
    String getQueryParameter(String name) {
        String query=value.getRawQuery();
        if(query==null)return null;
        for(String pair:query.split("&")) {
            String[] parts=pair.split("=",2);
            if(parts[0].equals(name))return URLDecoder.decode(parts.length>1?parts[1]:"",StandardCharsets.UTF_8);
        }
        return null;
    }
}
// Keep the original duplicate-initialization path executable too, so the
// regression fails on a redundant createGame rather than a missing fixture.
class WebResourceResponse { }
interface WebResourceRequest { Uri getUrl(); }
abstract class ServiceWorkerClientCompat { public abstract WebResourceResponse shouldInterceptRequest(WebResourceRequest request); }
class WebViewFeature {
    static final String SERVICE_WORKER_BASIC_USAGE="service-worker";
    static boolean isFeatureSupported(String feature) { return true; }
}
class ServiceWorkerControllerCompat {
    static ServiceWorkerControllerCompat getInstance() { return new ServiceWorkerControllerCompat(); }
    void setServiceWorkerClient(ServiceWorkerClientCompat client) { }
}
class WebViewAssetLoader {
    WebResourceResponse shouldInterceptRequest(Uri uri) { return null; }
    static class AssetsPathHandler { AssetsPathHandler(Object activity) { } }
    static class Builder {
        Builder setDomain(String domain) { return this; }
        Builder addPathHandler(String path,AssetsPathHandler handler) { return this; }
        WebViewAssetLoader build() { return new WebViewAssetLoader(); }
    }
}
public class AndroidInviteLifecycleHarness extends HostActivity {
    static final String HOME="https://cs2.duskrain.cn/__installed__/index.html";
    String startUrl=HOME;
    int paused,created,immersed;
    final List<String> navigations=new ArrayList<>();
    WebViewAssetLoader assetLoader=new WebViewAssetLoader();
    final class Page { void loadUrl(String url) { navigations.add(url); } }
    Page game=new Page();
    void pauseInput() { paused++; }
    void createGame() { created++;game=new Page();game.loadUrl(startUrl); }
    void immersive() { immersed++; }
    ${method}
    static void check(boolean value,String message) { if(!value)throw new AssertionError(message); }
    public static void main(String[] args) {
        AndroidInviteLifecycleHarness live=new AndroidInviteLifecycleHarness();
        Object original=live.game,loader=live.assetLoader;
        live.onNewIntent(new Intent("https://cs2.duskrain.cn/?room=A9b"));
        check(live.game==original,"An invitation must preserve the live renderer");
        check(live.created==0,"A live renderer must not be recreated");
        check(live.navigations.equals(List.of(HOME+"?room=A9b")),"Navigate to the invitation exactly once");
        check(live.assetLoader==loader,"Keep the existing asset interception");
        check(live.paused==1&&live.immersed==1&&live.parentIntents==1,"Pause old input and restore immersive mode");
        live.onNewIntent(new Intent("https://cs2.duskrain.cn/?room=NEXT2"));
        check(live.game==original&&live.navigations.size()==2,"Successive invitations each navigate once");
        AndroidInviteLifecycleHarness exited=new AndroidInviteLifecycleHarness();
        exited.game=null;exited.onNewIntent(new Intent("https://cs2.duskrain.cn/?room=RECOVER"));
        check(exited.created==1&&exited.game!=null,"Recover a missing renderer once");
        check(exited.navigations.equals(List.of(HOME+"?room=RECOVER")),"Recovery loads the requested room once");
        check(exited.paused==1&&exited.immersed==1,"Recovery also suspends input and restores immersive mode");
        for(String url:new String[]{null,"https://cs2.duskrain.cn/","http://cs2.duskrain.cn/?room=A9b","https://example.org/?room=A9b","https://cs2.duskrain.cn/?room=","https://cs2.duskrain.cn/?room=TOOLONG1234567","https://cs2.duskrain.cn/?room=bad%2Froom"}) {
            AndroidInviteLifecycleHarness invalid=new AndroidInviteLifecycleHarness();
            Object existing=invalid.game;invalid.onNewIntent(new Intent(url));
            check(invalid.game==existing&&invalid.created==0&&invalid.navigations.isEmpty(),"Invalid invitation changed the renderer: "+url);
            check(invalid.paused==0&&invalid.startUrl.equals(HOME),"Invalid invitation disturbed the current game: "+url);
        }
        System.out.println("Live renderer reuse, repeated invites, renderer recovery and 7 rejected invitations passed");
    }
}
`;
 const file=join(dir,'AndroidInviteLifecycleHarness.java');await writeFile(file,harness);
 const compile=spawnSync(javac,['-encoding','UTF-8','-d',dir,file],{encoding:'utf8',windowsHide:true});
 assert.equal(compile.status,0,compile.stderr||compile.error?.message);
 const run=spawnSync(java,['-cp',dir,'AndroidInviteLifecycleHarness'],{encoding:'utf8',windowsHide:true});
 assert.equal(run.status,0,run.stderr||run.error?.message);
 assert.match(run.stdout,/renderer recovery and 7 rejected invitations passed/);
});
