package cn.duskrain.dustii.gecko;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.os.Build;
import android.view.*;
import android.widget.Toast;
import org.json.JSONObject;
import org.mozilla.geckoview.*;
import cn.duskrain.dustii.MotionBridge;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/** Separate evaluation app. Uses the same installed client and production WSS. */
public final class GeckoActivity extends Activity {
    private static final String HOME="http://127.0.0.1:27186/index.html";
    private static GeckoRuntime runtime;
    private GeckoSession session;
    private GeckoView view;
    private AssetServer assets;
    private MotionBridge motion;
    private WebExtension.Port port;
    private String pendingBackup;
    private GeckoSession.PromptDelegate.FilePrompt filePrompt;
    private GeckoResult<GeckoSession.PromptDelegate.PromptResponse> fileResult;
    @Override public void onCreate(Bundle state){
        super.onCreate(state);getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        try{
            assets=new AssetServer(getAssets());
            JSONObject engine=new JSONObject().put("name","GeckoView").put("version","157.0.20260924084938")
                .put("lastRendererExit",getPreferences(MODE_PRIVATE).getString("rendererExit","none"));
            motion=new MotionBridge(this,engine);
            if(runtime==null)runtime=GeckoRuntime.create(this,new GeckoRuntimeSettings.Builder().remoteDebuggingEnabled(BuildConfig.DEBUG).build());
            view=new GeckoView(this);setContentView(view);
            view.setOnApplyWindowInsetsListener((v,insets)->{
                int left=0,top=0,right=0,bottom=0;
                if(Build.VERSION.SDK_INT>=28&&insets.getDisplayCutout()!=null){left=insets.getDisplayCutout().getSafeInsetLeft();top=insets.getDisplayCutout().getSafeInsetTop();right=insets.getDisplayCutout().getSafeInsetRight();bottom=insets.getDisplayCutout().getSafeInsetBottom();}
                if(Build.VERSION.SDK_INT>=30)bottom=Math.max(bottom,insets.getInsets(WindowInsets.Type.ime()).bottom);
                v.setPadding(left,top,right,bottom);return insets;
            });
            session=new GeckoSession(new GeckoSessionSettings.Builder().userAgentOverride("Mozilla/5.0 (Android "+Build.VERSION.RELEASE+"; Mobile; rv:157.0) Gecko/157.0 Firefox/157.0 DustIIAndroid/1.2.0 GeckoTest/1.2.0").build());
            session.setNavigationDelegate(new GeckoSession.NavigationDelegate(){
                @Override public GeckoResult<AllowOrDeny> onLoadRequest(GeckoSession s,LoadRequest request){
                    Uri uri=Uri.parse(request.uri);
                    if("http".equals(uri.getScheme())&&"127.0.0.1".equals(uri.getHost())&&uri.getPort()==AssetServer.PORT&&"/index.html".equals(uri.getPath()))return GeckoResult.fromValue(AllowOrDeny.ALLOW);
                    if("https".equals(uri.getScheme()))try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception ignored){}
                    return GeckoResult.fromValue(AllowOrDeny.DENY);
                }
            });
            session.setContentDelegate(new GeckoSession.ContentDelegate(){
                @Override public void onCrash(GeckoSession s){rendererExit("crash");}
                @Override public void onKill(GeckoSession s){rendererExit("system-killed");}
            });
            session.setPromptDelegate(new GeckoSession.PromptDelegate(){
                @Override public GeckoResult<PromptResponse> onFilePrompt(GeckoSession s,FilePrompt prompt){
                    if(fileResult!=null)return GeckoResult.fromValue(prompt.dismiss());
                    filePrompt=prompt;fileResult=new GeckoResult<>();
                    try{startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE),20);}
                    catch(Exception e){fileResult.complete(prompt.dismiss());fileResult=null;filePrompt=null;}
                    return fileResult;
                }
            });
            session.open(runtime);view.setSession(session);
            runtime.getWebExtensionController().ensureBuiltIn("resource://android/assets/motion-extension/","motion@duskrain.cn").accept(extension->runOnUiThread(()->{
                session.getWebExtensionController().setMessageDelegate(extension,new WebExtension.MessageDelegate(){
                    @Override public void onConnect(WebExtension.Port incoming){
                        if(incoming.sender.session!=session||!incoming.sender.isTopLevel()||!validPage(incoming.sender.url)){incoming.disconnect();return;}
                        if(port!=null)port.disconnect();port=incoming;
                        port.setDelegate(new WebExtension.PortDelegate(){
                            @Override public void onPortMessage(Object value,WebExtension.Port source){
                                if(source!=port||!(value instanceof JSONObject))return;
                                try{
                                    JSONObject request=(JSONObject)value;if(request.toString().length()>262144)return;
                                    if(motion.handle(request,response->{if(port==source)source.postMessage(response);}))return;
                                    boolean diagnostic="exportDiagnostics".equals(request.optString("type"));
                                    if((diagnostic||"exportPreferences".equals(request.optString("type")))&&pendingBackup==null){
                                        JSONObject data=request.getJSONObject("data");if(data.optInt("version")!=1||(!diagnostic&&!data.has("preferences")))return;
                                        pendingBackup=data.toString(2);startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,diagnostic?"dust2-runtime-diagnostics.json":"DustII-游戏设置.json"),21);
                                        source.postMessage(new JSONObject().put("requestId",request.opt("requestId")).put("type","exportPreferences"));
                                    }
                                }catch(Exception e){Toast.makeText(GeckoActivity.this,"原生接口未完成，请重试",Toast.LENGTH_SHORT).show();}
                            }
                            @Override public void onDisconnect(WebExtension.Port source){if(port==source){motion.stop();port=null;}}
                        });
                    }
                },"dustii");
                session.loadUri(HOME);
            }),error->runOnUiThread(()->failure("内置接口加载失败，请重新进入。")));
            immersive();
        }catch(Exception error){failure("本地素材服务未启动："+error.getClass().getSimpleName());}
    }
    private boolean validPage(String url){try{Uri u=Uri.parse(url);return "http".equals(u.getScheme())&&"127.0.0.1".equals(u.getHost())&&u.getPort()==AssetServer.PORT&&"/index.html".equals(u.getPath());}catch(Exception e){return false;}}
    private void rendererExit(String reason){if(motion!=null)motion.stop();getPreferences(MODE_PRIVATE).edit().putString("rendererExit",reason+" time="+System.currentTimeMillis()).apply();failure("测试内核画面已退出。设置保留，可重新进入；正式包不受影响。");}
    private void failure(String message){if(isFinishing())return;new AlertDialog.Builder(this).setTitle("GeckoView 测试包").setMessage(message).setPositiveButton("重新进入",(d,w)->recreate()).setNegativeButton("退出",(d,w)->finish()).show();}
    private void pauseInput(){if(motion!=null)motion.stop();if(port!=null)try{port.postMessage(new JSONObject().put("type","hostBlur"));}catch(Exception ignored){}}
    private void immersive(){
        if(Build.VERSION.SDK_INT>=30){getWindow().setDecorFitsSystemWindows(false);WindowInsetsController c=getWindow().getInsetsController();if(c!=null){c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);c.hide(WindowInsets.Type.systemBars());}}
        else getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_FULLSCREEN|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN|View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
    }
    @Override public void onWindowFocusChanged(boolean focus){super.onWindowFocusChanged(focus);if(focus)immersive();else pauseInput();}
    @Override protected void onPause(){pauseInput();if(session!=null)session.setActive(false);super.onPause();}
    @Override protected void onResume(){super.onResume();if(session!=null)session.setActive(true);immersive();}
    @Override public void onBackPressed(){pauseInput();new AlertDialog.Builder(this).setTitle("离开游戏？").setMessage("退出会断开对局，已保存的设置保留。").setNegativeButton("继续游戏",(d,w)->immersive()).setPositiveButton("退出",(d,w)->finish()).show();}
    @Override protected void onActivityResult(int code,int result,Intent data){
        super.onActivityResult(code,result,data);
        if(code==20&&fileResult!=null){fileResult.complete(result==RESULT_OK&&data!=null&&data.getData()!=null?filePrompt.confirm(this,data.getData()):filePrompt.dismiss());fileResult=null;filePrompt=null;}
        if(code==21&&pendingBackup!=null){if(result==RESULT_OK&&data!=null)try(OutputStream out=getContentResolver().openOutputStream(data.getData(),"wt")){if(out!=null)out.write(pendingBackup.getBytes(StandardCharsets.UTF_8));}catch(Exception e){Toast.makeText(this,"备份未保存，请重试",Toast.LENGTH_SHORT).show();}pendingBackup=null;}
    }
    @Override protected void onDestroy(){if(fileResult!=null)fileResult.complete(filePrompt.dismiss());if(motion!=null)motion.close();if(port!=null)port.disconnect();if(view!=null)view.releaseSession();if(session!=null)session.close();if(assets!=null)assets.close();super.onDestroy();}
}
