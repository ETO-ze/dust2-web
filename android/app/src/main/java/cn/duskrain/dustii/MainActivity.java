package cn.duskrain.dustii;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.SslErrorHandler;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import org.json.JSONObject;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewAssetLoader;
import android.webkit.WebResourceResponse;
import java.io.ByteArrayInputStream;
import androidx.webkit.WebViewFeature;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.io.OutputStream;

/** Fullscreen host for the existing game. The server remains authoritative. */
public final class MainActivity extends Activity {
    private static final String HOME = "https://appassets.androidplatform.net/";
    private WebViewAssetLoader assetLoader;
    private static final int PICK_FILE = 20;
    private static final int SAVE_FILE = 21;
    private FrameLayout root;
    private WebView game;
    private View recovery, customView;
    private WebChromeClient.CustomViewCallback customCallback;
    private ValueCallback<Uri[]> fileCallback;
    private String startUrl = HOME;
    private boolean pageFailed;
    private String pendingBackup;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        if (Build.VERSION.SDK_INT >= 28) {
            WindowManager.LayoutParams params = getWindow().getAttributes();
            params.layoutInDisplayCutoutMode = WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            getWindow().setAttributes(params);
        }
        String qa = getIntent().getStringExtra("qaUrl");
        if (BuildConfig.DEBUG && qa != null && qa.matches("http://127\\.0\\.0\\.1:[0-9]{1,5}/")) startUrl = qa;
        Uri invite = getIntent().getData();
        if (invite != null && "https".equals(invite.getScheme()) && "cs2.duskrain.cn".equals(invite.getHost())) {
            String room = invite.getQueryParameter("room");
            if (room != null && room.matches("[A-Za-z0-9]{1,12}")) startUrl = HOME + "?room=" + room;
        }
        root = new FrameLayout(this);root.setBackgroundColor(Color.rgb(17,23,21));setContentView(root);
        root.setOnApplyWindowInsetsListener((view,insets) -> {
            int left=0,top=0,right=0,bottom=0;
            if (Build.VERSION.SDK_INT >= 28 && insets.getDisplayCutout() != null) {
                left=insets.getDisplayCutout().getSafeInsetLeft();top=insets.getDisplayCutout().getSafeInsetTop();
                right=insets.getDisplayCutout().getSafeInsetRight();bottom=insets.getDisplayCutout().getSafeInsetBottom();
            }
            if (Build.VERSION.SDK_INT >= 30) bottom=Math.max(bottom,insets.getInsets(WindowInsets.Type.ime()).bottom);
            view.setPadding(left,top,right,bottom);return insets;
        });
        assetLoader=new WebViewAssetLoader.Builder().addPathHandler("/",new WebViewAssetLoader.AssetsPathHandler(this)).build();
        createGame();immersive();
    }

    private boolean owned(Uri uri) {
        Uri base = Uri.parse(startUrl);
        return base.getScheme().equals(uri.getScheme()) && base.getHost().equals(uri.getHost()) && base.getPort() == uri.getPort();
    }

    @SuppressLint("SetJavaScriptEnabled") private void createGame() {
        if (game != null) { root.removeView(game);game.destroy(); }
        if (recovery != null) { root.removeView(recovery);recovery = null; }
        game = new WebView(this);game.setBackgroundColor(Color.rgb(17,23,21));
        game.setOverScrollMode(View.OVER_SCROLL_NEVER);
        game.setVerticalScrollBarEnabled(false);game.setHorizontalScrollBarEnabled(false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        WebSettings settings = game.getSettings();settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setUserAgentString(settings.getUserAgentString() + " DustIIAndroid/1.0");
        java.util.regex.Matcher engine=java.util.regex.Pattern.compile("Chrome/(\\d+)").matcher(settings.getUserAgentString());
        if (!engine.find() || Integer.parseInt(engine.group(1))<110) {
            game.destroy();game=null;
            showRecovery("请先更新 Android System WebView", "当前系统网页组件版本较旧。请在应用商店更新 Android System WebView，再重新进入游戏。");return;
        }
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(true);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setMediaPlaybackRequiresUserGesture(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(game, false);
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            Uri origin=Uri.parse(startUrl);
            String allowed=origin.getScheme()+"://"+origin.getAuthority();
            WebViewCompat.addWebMessageListener(game,"DustIIHost",Collections.singleton(allowed),(view,message,sourceOrigin,isMainFrame,reply) -> {
                if (!isMainFrame || !owned(sourceOrigin)) return;
                try {
                    String data=message.getData();if (data==null || data.length()>262144) return;
                    JSONObject request=new JSONObject(data);
                    if (!"exportPreferences".equals(request.optString("type")) || pendingBackup!=null) return;
                    JSONObject backup=request.getJSONObject("data");
                    if (backup.optInt("version")!=1 || !backup.has("preferences")) return;
                    pendingBackup=backup.toString(2);
                    Intent save=new Intent(Intent.ACTION_CREATE_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE).putExtra(Intent.EXTRA_TITLE,"DustII-游戏设置.json");
                    startActivityForResult(save,SAVE_FILE);
                } catch (Exception e) { pendingBackup=null;Toast.makeText(MainActivity.this,"无法导出设置，请重试",Toast.LENGTH_SHORT).show(); }
            });
        }
        game.setWebViewClient(new WebViewClient() {
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse resource=assetLoader.shouldInterceptRequest(request.getUrl());
                if(resource!=null)return resource;
                return new WebResourceResponse("text/plain","UTF-8",404,"Not Found",Collections.emptyMap(),new ByteArrayInputStream(new byte[0]));
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();if (owned(uri)) return false;
                if (request.isForMainFrame() && ("https".equals(uri.getScheme()) || "http".equals(uri.getScheme()))) {
                    try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception e) { Toast.makeText(MainActivity.this,"无法打开外部链接",Toast.LENGTH_SHORT).show(); }
                }
                return true;
            }
            @Override public void onPageStarted(WebView view, String url, Bitmap icon) { pageFailed = false; }
            @Override public void onPageFinished(WebView view, String url) {
                if (!pageFailed && recovery != null) { root.removeView(recovery);recovery = null; }
                immersive();
            }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) { pageFailed = true;showRecovery("本地游戏文件未能载入", "请重试，或重新安装完整离线包。已保存的设置会保留。"); }
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
                handler.cancel();pageFailed = true;showRecovery("安全连接未建立", "请检查手机日期和网络后重试。");
            }
            @Override public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                if (customView != null) hideCustom();
                root.removeView(view);view.destroy();game = null;
                showRecovery("游戏画面已停止", "渲染进程已退出，设置和资源缓存仍保留。重新进入后建议使用最低画质。");return true;
            }
        });
        game.setWebChromeClient(new WebChromeClient() {
            @Override public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) { callback.onCustomViewHidden();return; }
                customView = view;customCallback = callback;root.addView(view, new FrameLayout.LayoutParams(-1,-1));immersive();
            }
            @Override public void onHideCustomView() { hideCustom(); }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);fileCallback = callback;
                Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT).setType("application/json").addCategory(Intent.CATEGORY_OPENABLE);
                try { startActivityForResult(pick, PICK_FILE); } catch (Exception e) { fileCallback.onReceiveValue(null);fileCallback = null; }
                return true;
            }
        });
        root.addView(game, 0, new FrameLayout.LayoutParams(-1,-1));game.loadUrl(startUrl);
    }

    private void hideCustom() {
        if (customView != null) { root.removeView(customView);customView = null; }
        if (customCallback != null) { customCallback.onCustomViewHidden();customCallback = null; }immersive();
    }
    private void pauseInput() {
        if (game != null) game.evaluateJavascript("window.dispatchEvent(new Event('blur'))", null);
    }
    private void showRecovery(String title, String message) {
        if (isFinishing() || isDestroyed()) return;
        if (recovery != null) root.removeView(recovery);
        LinearLayout panel = new LinearLayout(this);panel.setOrientation(LinearLayout.VERTICAL);panel.setGravity(Gravity.CENTER);
        panel.setPadding(40,30,40,30);panel.setBackgroundColor(Color.rgb(17,23,21));
        TextView heading = new TextView(this);heading.setText(title);heading.setTextColor(Color.rgb(232,202,138));heading.setTextSize(23);panel.addView(heading);
        TextView text = new TextView(this);text.setText(message);text.setTextColor(Color.WHITE);text.setTextSize(15);text.setPadding(0,18,0,18);text.setGravity(Gravity.CENTER);panel.addView(text);
        Button retry = new Button(this);retry.setText("重新进入游戏");retry.setOnClickListener(v -> createGame());panel.addView(retry);
        recovery = panel;root.addView(panel, new FrameLayout.LayoutParams(-1,-1));immersive();
    }

    private void immersive() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            WindowInsetsController controller = getWindow().getInsetsController();
            if (controller != null) { controller.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);controller.hide(WindowInsets.Type.systemBars()); }
        } else {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        }
    }
    @Override public void onWindowFocusChanged(boolean focused) { super.onWindowFocusChanged(focused);if (focused) immersive();else pauseInput(); }
    @Override public void onBackPressed() {
        if (customView != null) { hideCustom();return; }
        pauseInput();new AlertDialog.Builder(this).setTitle("离开游戏？").setMessage("退出会结束当前离线对局。设置会保留，对局进度不会存档。")
            .setNegativeButton("继续游戏", (d,w) -> immersive()).setPositiveButton("退出", (d,w) -> finish()).show();
    }
    @Override protected void onPause() { pauseInput();if (game != null) game.onPause();super.onPause(); }
    @Override protected void onResume() { super.onResume();if (game != null) game.onResume();immersive(); }
    @Override protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode,resultCode,data);
        if (requestCode == PICK_FILE && fileCallback != null) { fileCallback.onReceiveValue(resultCode == RESULT_OK && data != null ? new Uri[]{data.getData()} : null);fileCallback = null; }
        if (requestCode == SAVE_FILE && pendingBackup != null) {
            if (resultCode == RESULT_OK && data != null && data.getData() != null) {
                try (OutputStream file=getContentResolver().openOutputStream(data.getData(),"wt")) {
                    if (file!=null) { file.write(pendingBackup.getBytes(StandardCharsets.UTF_8));Toast.makeText(this,"设置备份已保存",Toast.LENGTH_SHORT).show(); }
                } catch (Exception e) { Toast.makeText(this,"设置备份未保存，请重试",Toast.LENGTH_SHORT).show(); }
            }
            pendingBackup=null;
        }
    }
    @Override protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);setIntent(intent);Uri uri=intent.getData();
        if (uri==null || !"https".equals(uri.getScheme()) || !"cs2.duskrain.cn".equals(uri.getHost())) return;
        String room=uri.getQueryParameter("room");if (room==null || !room.matches("[A-Za-z0-9]{1,12}")) return;
        pauseInput();startUrl=HOME+"?room="+room;
        if(game!=null)game.loadUrl(startUrl);else createGame();immersive();
    }
    @Override protected void onDestroy() {
        if (fileCallback != null) { fileCallback.onReceiveValue(null);fileCallback = null; }
        if (game != null) { root.removeView(game);game.destroy();game = null; }super.onDestroy();
    }
}
