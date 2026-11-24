package io.github.zetatools.preview;

import android.app.*;
import android.content.*;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;
import androidx.webkit.ScriptHandler;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;
import java.util.concurrent.*;
import org.json.*;

public class MainActivity extends Activity {
    private static final String HOME="https://zeta-ai.io/ko";
    private static final String RAW="https://raw.githubusercontent.com/e4493089-cmyk/zeta-userscripts/main/";
    private static final String RELEASES="https://api.github.com/repos/e4493089-cmyk/zeta-userscripts/releases?per_page=30";
    private static final String[] NAMES={"카카오톡 테마","캡처 이름 가리기","채팅방 관리","대화 검색"};
    private static final String[] FILES={"zeta-kakaotalk-theme.user.js","zeta-capture-user-mask.user.js","zeta-room-manager.user.js","zeta-chat-search.user.js"};
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final List<ScriptHandler> handlers=new ArrayList<>();
    private WebView web;
    private FrameLayout root;
    private TextView menu;
    private SharedPreferences prefs;
    private ValueCallback<Uri[]> chooser;
    private boolean supported, initialized;
    private int screenMode;
    private int dp(int value){ return (int)(value*getResources().getDisplayMetrics().density+0.5f); }
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        prefs=getSharedPreferences("settings",MODE_PRIVATE);
        screenMode=prefs.getInt("screen",2);
        root=new FrameLayout(this);
        web=new WebView(this);
        root.addView(web,new FrameLayout.LayoutParams(-1,-1));
        setContentView(root);
        getWindow().setStatusBarColor(Color.rgb(25,25,25));
        getWindow().setNavigationBarColor(Color.rgb(25,25,25));
        WebSettings s=web.getSettings();
        s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false); s.setAllowContentAccess(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(true);
        CookieManager.getInstance().setAcceptCookie(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web,true);
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView v,WebResourceRequest request){
                if(!request.isForMainFrame()) return false;
                Uri u=request.getUrl();
                if("https".equals(u.getScheme()) && "zeta-ai.io".equals(u.getHost())) return false;
                if("https".equals(u.getScheme())) openExternal(u);
                return true;
            }
            @Override public void onPageFinished(WebView v,String url){ CookieManager.getInstance().flush(); }
        });
        web.setWebChromeClient(new WebChromeClient(){
            @Override public boolean onShowFileChooser(WebView v,ValueCallback<Uri[]> cb,FileChooserParams p){
                if(chooser!=null) chooser.onReceiveValue(null);
                chooser=cb;
                try{ startActivityForResult(p.createIntent(),42); return true; }
                catch(ActivityNotFoundException ex){ chooser=null;cb.onReceiveValue(null);return false; }
            }
            @Override public boolean onCreateWindow(WebView v,boolean dialog,boolean gesture,Message resultMsg){
                if(!gesture) return false;
                WebView popup=new WebView(MainActivity.this);
                popup.setWebViewClient(new WebViewClient(){
                    @Override public boolean shouldOverrideUrlLoading(WebView w,WebResourceRequest r){
                        Uri u=r.getUrl();
                        if("https".equals(u.getScheme())){
                            if("zeta-ai.io".equals(u.getHost())) web.loadUrl(u.toString());
                            else openExternal(u);
                        }
                        popup.destroy();return true;
                    }
                });
                ((WebView.WebViewTransport)resultMsg.obj).setWebView(popup);resultMsg.sendToTarget();return true;
            }
        });
        menu=new TextView(this);
        menu.setText("⋮");menu.setTextSize(25);menu.setGravity(Gravity.CENTER);menu.setTextColor(Color.WHITE);
        menu.setBackgroundColor(0xB330302F);menu.setContentDescription("앱 설정");
        FrameLayout.LayoutParams m=new FrameLayout.LayoutParams(dp(36),dp(44),Gravity.TOP|Gravity.END);
        m.topMargin=dp(10);m.rightMargin=dp(4);root.addView(menu,m);
        menu.setOnClickListener(v->showSettings());
        web.setDownloadListener((url,ua,disposition,mime,length)->{
            Uri u=Uri.parse(url);
            if("https".equals(u.getScheme())) openExternal(u);
            else toast("이 파일 형식은 테스트 버전에서 저장을 지원하지 않습니다.");
        });
        supported=WebViewFeature.isFeatureSupported(WebViewFeature.DOCUMENT_START_SCRIPT);
        applyScreen();
        if(!supported) toast("Android System WebView를 업데이트하면 테마 기능을 사용할 수 있습니다.");
        // Local bundled scripts are used on the first launch, so no network script is required to start.
        installScripts();
        web.loadUrl(HOME);
        initialized=true;
        if(prefs.getBoolean("autoScripts",true)) refreshScripts(false);
        checkAppUpdate(false);
    }
    private boolean enabled(int i){return prefs.getBoolean("script"+i,i==0);}
    private File cached(int i){return new File(getFilesDir(),FILES[i]);}
    private String read(InputStream input,int max) throws IOException {
        try(InputStream in=input; ByteArrayOutputStream out=new ByteArrayOutputStream()){
            byte[] b=new byte[8192];int n,total=0;
            while((n=in.read(b))!=-1){total+=n;if(total>max)throw new IOException("file too large");out.write(b,0,n);}
            return new String(out.toByteArray(),StandardCharsets.UTF_8);
        }
    }
    private String getSource(int i) throws IOException {
        if(cached(i).isFile()) return read(new FileInputStream(cached(i)),5*1024*1024);
        return read(getAssets().open(FILES[i]),5*1024*1024);
    }
    private void installScripts(){
        if(!supported) return;
        for(ScriptHandler h:handlers)h.remove();handlers.clear();
        Set<String> origins=new HashSet<>(Arrays.asList("https://zeta-ai.io","https://frame.pingpong.ai"));
        for(int i=0;i<FILES.length;i++){
            if(!enabled(i))continue;
            try{
                String src=getSource(i);
                // Limit the cross-origin chat frame to the documented Zeta host and path.
                String guard="(function(){if(location.origin==='https://frame.pingpong.ai' && (location.pathname!=='/v1/index.html'||new URLSearchParams(location.hash.slice(1)).get('host')!=='https://zeta-ai.io'))return;";
                if(i==2) src="const boot=()=>{"+src+"};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',boot,{once:true});else boot();";
                handlers.add(WebViewCompat.addDocumentStartJavaScript(web,guard+src+"\n})();",origins));
            }catch(Exception e){toast(NAMES[i]+" 불러오기 실패");}
        }
    }
    private String httpsGet(String url,int max) throws Exception{
        HttpURLConnection c=(HttpURLConnection)new URL(url).openConnection();
        c.setConnectTimeout(12000);c.setReadTimeout(15000);c.setInstanceFollowRedirects(false);
        c.setRequestProperty("User-Agent","ZETA-Tools-Android-Preview");
        c.setRequestProperty("Accept","*/*");
        try{if(c.getResponseCode()!=200)throw new IOException("HTTP "+c.getResponseCode());return read(c.getInputStream(),max);}
        finally{c.disconnect();}
    }
    private void refreshScripts(boolean manual){
        worker.execute(()->{
            int changed=0,errors=0;
            for(int i=0;i<FILES.length;i++){
                if(!enabled(i))continue;
                try{
                    String latest=httpsGet(RAW+FILES[i],5*1024*1024);
                    if(!latest.startsWith("// ==UserScript==")||!latest.contains("// ==/UserScript==")||!latest.contains("@grant        none"))
                        throw new IOException("invalid script metadata");
                    String previous="";try{previous=getSource(i);}catch(IOException ignored){}
                    if(!latest.equals(previous)){
                        android.util.AtomicFile f=new android.util.AtomicFile(cached(i));
                        FileOutputStream out=f.startWrite();
                        try{out.write(latest.getBytes(StandardCharsets.UTF_8));f.finishWrite(out);}
                        catch(IOException e){f.failWrite(out);throw e;}
                        changed++;
                    }
                }catch(Exception ex){errors++;}
            }
            final int n=changed,bad=errors;
            runOnUiThread(()->{
                if(isDestroyed())return;
                if(n>0){
                    installScripts();
                    if(manual)new AlertDialog.Builder(this).setTitle("스크립트 업데이트").setMessage(n+"개 업데이트 완료. 작성 중인 대화가 있다면 나중에 새로고침하세요.").setPositiveButton("새로고침",(d,w)->web.reload()).setNegativeButton("나중에",null).show();
                    else toast("스크립트 업데이트 완료 · 다음 페이지 로딩부터 적용");
                } else if(manual)toast(bad>0?"업데이트 확인 실패 · 기존 버전 유지":"최신 스크립트입니다.");
            });
        });
    }
    private void checkAppUpdate(boolean manual){
        worker.execute(()->{
            try{
                JSONArray list=new JSONArray(httpsGet(RELEASES,1024*1024));
                String current="0.1.0",best=current,link=null;
                for(int i=0;i<list.length();i++){
                    JSONObject r=list.getJSONObject(i);String tag=r.optString("tag_name");
                    if(!tag.startsWith("android-v")||r.optBoolean("draft")||r.optBoolean("prerelease"))continue;
                    String ver=tag.substring(9);
                    if(!ver.matches("[0-9]+\\.[0-9]+\\.[0-9]+")||compareVersion(ver,best)<=0)continue;
                    JSONArray assets=r.optJSONArray("assets");boolean apk=false;
                    if(assets!=null)for(int j=0;j<assets.length();j++)if(assets.getJSONObject(j).optString("name").endsWith(".apk"))apk=true;
                    if(!apk)continue;
                    best=ver;link="https://github.com/e4493089-cmyk/zeta-userscripts/releases/tag/"+tag;
                }
                final String version=best,url=link;
                runOnUiThread(()->{if(isDestroyed())return;if(url!=null)new AlertDialog.Builder(this).setTitle("새 APK 업데이트").setMessage("v"+current+" → v"+version+"\n다운로드 페이지에서 새 APK를 설치하세요.").setPositiveButton("다운로드",(d,w)->openExternal(Uri.parse(url))).setNegativeButton("나중에",null).show();else if(manual)toast("배포된 새 APK가 없습니다.");});
            }catch(Exception e){if(manual)runOnUiThread(()->toast("APK 업데이트 확인 실패"));}
        });
    }
    private int compareVersion(String a,String b){
        String[] aa=a.split("\\."),bb=b.split("\\.");
        for(int i=0;i<3;i++){int c=Integer.compare(Integer.parseInt(aa[i]),Integer.parseInt(bb[i]));if(c!=0)return c;}return 0;
    }
    private void applyScreen(){
        int flags=0;
        if(screenMode==1)flags=View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION;
        if(screenMode==2)flags=View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_FULLSCREEN;
        getWindow().getDecorView().setSystemUiVisibility(flags);
    }
    private void showSettings(){
        String[] items={"화면 모드","스크립트 설정","스크립트 최신 버전 확인","APK 업데이트 확인","화면 꺼짐 방지: "+(prefs.getBoolean("awake",false)?"켜짐":"꺼짐"),"새로고침","제타 홈","외부 브라우저에서 열기","앱 정보"};
        new AlertDialog.Builder(this).setTitle("ZETA Tools · 설정").setItems(items,(d,w)->{
            switch(w){
                case 0: new AlertDialog.Builder(this).setTitle("화면 모드").setSingleChoiceItems(new String[]{"기본","확장 (하단 바 숨김)","전체화면"},screenMode,(a,b)->{screenMode=b;prefs.edit().putInt("screen",b).apply();a.dismiss();applyScreen();}).setNegativeButton("닫기",null).show();break;
                case 1: showScripts();break;
                case 2: refreshScripts(true);break;
                case 3: checkAppUpdate(true);break;
                case 4: boolean on=!prefs.getBoolean("awake",false);prefs.edit().putBoolean("awake",on).apply();applyAwake();toast(on?"화면 꺼짐 방지 켜짐":"화면 꺼짐 방지 꺼짐");break;
                case 5: web.reload();break;
                case 6: web.loadUrl(HOME);break;
                case 7: if(web.getUrl()!=null)openExternal(Uri.parse(web.getUrl()));break;
                case 8: new AlertDialog.Builder(this).setTitle("ZETA Tools Preview 0.1.0").setMessage("제타 공식 앱이 아닌 개인 웹뷰 도구입니다. 로그인과 대화는 제타 웹에서 처리됩니다. Google 로그인 및 파일 저장은 아직 검증되지 않았습니다. 자동 업데이트는 공개 GitHub 스크립트만 확인합니다.").setPositiveButton("확인",null).show();break;
            }
        }).setOnDismissListener(d->applyScreen()).show();
    }
    private void showScripts(){
        if(!supported){toast("현재 WebView에서 스크립트 주입을 지원하지 않습니다.");return;}
        String[] labels=Arrays.copyOf(NAMES,NAMES.length+1);labels[NAMES.length]="실행 시 스크립트 업데이트 확인";
        boolean[] choices=new boolean[labels.length];for(int i=0;i<NAMES.length;i++)choices[i]=enabled(i);choices[NAMES.length]=prefs.getBoolean("autoScripts",true);
        new AlertDialog.Builder(this).setTitle("스크립트 설정").setMultiChoiceItems(labels,choices,(d,w,on)->choices[w]=on).setPositiveButton("저장 및 새로고침",(d,w)->{
            SharedPreferences.Editor e=prefs.edit();for(int i=0;i<NAMES.length;i++)e.putBoolean("script"+i,choices[i]);e.putBoolean("autoScripts",choices[NAMES.length]);e.apply();installScripts();web.reload();
        }).setNegativeButton("취소",null).show();
    }
    private void applyAwake(){if(prefs.getBoolean("awake",false))getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);}
    private void openExternal(Uri u){try{if("https".equals(u.getScheme()))startActivity(new Intent(Intent.ACTION_VIEW,u));}catch(ActivityNotFoundException e){toast("외부 브라우저가 없습니다.");}}
    private void toast(String message){Toast.makeText(this,message,Toast.LENGTH_SHORT).show();}
    @Override protected void onResume(){super.onResume();if(prefs!=null){applyAwake();applyScreen();}}
    @Override public void onWindowFocusChanged(boolean hasFocus){super.onWindowFocusChanged(hasFocus);if(hasFocus)applyScreen();}
    @Override public void onBackPressed(){if(web.canGoBack())web.goBack();else new AlertDialog.Builder(this).setMessage("앱을 종료할까요?").setPositiveButton("종료",(d,w)->finish()).setNegativeButton("취소",null).show();}
    @Override protected void onActivityResult(int r,int c,Intent data){super.onActivityResult(r,c,data);if(r==42&&chooser!=null){chooser.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(c,data));chooser=null;}}
    @Override protected void onDestroy(){worker.shutdownNow();if(chooser!=null)chooser.onReceiveValue(null);root.removeView(web);web.destroy();super.onDestroy();}
}
