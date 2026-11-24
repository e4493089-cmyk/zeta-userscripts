package io.github.zetatools.gecko;

import android.app.*;
import android.content.*;
import android.graphics.Color;
import android.net.Uri;
import android.os.*;
import android.view.*;
import android.widget.*;
import org.mozilla.geckoview.*;
import java.util.*;

public class MainActivity extends Activity {
    private static final String HOME="https://zeta-ai.io/ko";
    private static GeckoRuntime runtime;
    private GeckoView view;
    private GeckoSession main,current;
    private final ArrayList<GeckoSession> tabs=new ArrayList<>();
    private final IdentityHashMap<GeckoSession,String> locations=new IdentityHashMap<>();
    private final IdentityHashMap<GeckoSession,Boolean> backs=new IdentityHashMap<>();
    private final IdentityHashMap<GeckoSession,GeckoSession> parents=new IdentityHashMap<>();
    private TextView origin,menu,close;
    private LinearLayout bar;
    private FrameLayout frame;
    private SharedPreferences prefs;
    private int mode;
    private WebExtension theme;
    private boolean themeBusy=false,themeEnabled=false;
    private int dp(int n){return Math.round(n*getResources().getDisplayMetrics().density);}
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        prefs=getSharedPreferences("settings",MODE_PRIVATE);
        mode=prefs.getInt("screen",2);
        if(runtime==null)runtime=GeckoRuntime.create(getApplicationContext(),new GeckoRuntimeSettings.Builder().remoteDebuggingEnabled(false).build());
        LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);
        bar=new LinearLayout(this);bar.setGravity(Gravity.CENTER_VERTICAL);bar.setBackgroundColor(0xff252525);
        close=new TextView(this);close.setText("‹");close.setTextColor(Color.WHITE);close.setTextSize(28);close.setGravity(Gravity.CENTER);close.setContentDescription("로그인 창 닫기");bar.addView(close,new LinearLayout.LayoutParams(dp(42),dp(46)));close.setOnClickListener(v->back());
        origin=new TextView(this);origin.setTextColor(Color.WHITE);origin.setTextSize(14);origin.setPadding(dp(5),0,dp(5),0);bar.addView(origin,new LinearLayout.LayoutParams(0,dp(46),1));origin.setGravity(Gravity.CENTER_VERTICAL);
        layout.addView(bar,new LinearLayout.LayoutParams(-1,dp(46)));
        frame=new FrameLayout(this);view=new GeckoView(this);frame.addView(view,new FrameLayout.LayoutParams(-1,-1));
        menu=new TextView(this);menu.setText("⋮");menu.setTextColor(Color.WHITE);menu.setTextSize(25);menu.setGravity(Gravity.CENTER);menu.setBackgroundColor(0xb330302f);menu.setContentDescription("앱 설정");
        FrameLayout.LayoutParams p=new FrameLayout.LayoutParams(dp(36),dp(44),Gravity.TOP|Gravity.END);p.topMargin=dp(8);p.rightMargin=dp(4);frame.addView(menu,p);menu.setOnClickListener(v->settings());
        layout.addView(frame,new LinearLayout.LayoutParams(-1,0,1));setContentView(layout);
        getWindow().setStatusBarColor(0xff252525);getWindow().setNavigationBarColor(0xff252525);
        main=createSession();main.open(runtime);show(main);locations.put(main,HOME);main.loadUri(HOME);updateChrome();
        installTheme(false);
    }
    private GeckoSession createSession(){
        GeckoSession s=new GeckoSession();tabs.add(s);
        s.setNavigationDelegate(new GeckoSession.NavigationDelegate(){
            @Override public GeckoResult<AllowOrDeny> onLoadRequest(GeckoSession session,LoadRequest request){
                Uri u=Uri.parse(request.uri);
                String scheme=u.getScheme();
                if("https".equals(scheme)||"about".equals(scheme)||"blob".equals(scheme)||"data".equals(scheme))return GeckoResult.fromValue(AllowOrDeny.ALLOW);
                return GeckoResult.fromValue(AllowOrDeny.DENY);
            }
            @Override public GeckoResult<GeckoSession> onNewSession(GeckoSession parent,String uri){
                if(tabs.size()>=8)return null;
                GeckoSession child=createSession();parents.put(child,parent);locations.put(child,uri);
                // Gecko opens the child itself and preserves the opener relationship.
                new Handler(Looper.getMainLooper()).post(()->{if(!isDestroyed()&&tabs.contains(child))show(child);});
                return GeckoResult.fromValue(child);
            }
            @Override public void onCanGoBack(GeckoSession s,boolean can){backs.put(s,can);}
            @Override public void onLocationChange(GeckoSession s,String url,List<GeckoSession.PermissionDelegate.ContentPermission> permissions,Boolean hasUserGesture){
                locations.put(s,url);if(s==current)updateChrome();
            }
        });
        s.setContentDelegate(new GeckoSession.ContentDelegate(){
            @Override public void onCloseRequest(GeckoSession s){if(s!=main)closeTab(s);}
        });
        s.setPromptDelegate(new GeckoSession.PromptDelegate(){
            @Override public GeckoResult<PromptResponse> onPopupPrompt(GeckoSession s,PopupPrompt prompt){
                GeckoResult<PromptResponse> result=new GeckoResult<>();
                new AlertDialog.Builder(MainActivity.this).setTitle("새 창 열기").setMessage("웹사이트가 새 창을 열려고 합니다.").setPositiveButton("허용",(d,w)->result.complete(prompt.confirm(AllowOrDeny.ALLOW))).setNegativeButton("차단",(d,w)->result.complete(prompt.confirm(AllowOrDeny.DENY))).setOnCancelListener(d->result.complete(prompt.confirm(AllowOrDeny.DENY))).show();
                return result;
            }
        });
        return s;
    }
    private void show(GeckoSession s){
        if(current!=s){if(view.getSession()!=null)view.releaseSession();current=s;view.setSession(s);}
        updateChrome();
    }
    private void closeTab(GeckoSession s){
        GeckoSession parent=parents.get(s);if(parent==null||!tabs.contains(parent))parent=main;
        if(current==s)show(parent);
        tabs.remove(s);locations.remove(s);backs.remove(s);parents.remove(s);
        if(s.isOpen())s.close();
        updateChrome();
    }
    private boolean ownPage(){
        try{Uri u=Uri.parse(locations.getOrDefault(current,""));return "https".equals(u.getScheme())&&"zeta-ai.io".equals(u.getHost());}catch(Exception e){return false;}
    }
    private void updateChrome(){
        if(current==null)return;
        boolean showBar=current!=main||!ownPage();
        bar.setVisibility(showBar?View.VISIBLE:View.GONE);
        menu.setVisibility(showBar?View.GONE:View.VISIBLE);
        Uri u=Uri.parse(locations.getOrDefault(current,"about:blank"));
        // Show the actual origin, never the OAuth query or fragment.
        origin.setText(u.getHost()!=null?u.getScheme()+"://"+u.getHost()+(u.getPort()!=-1?":"+u.getPort():""):"새 창");
        applyScreen();
    }
    private void installTheme(boolean reload){
        if(themeBusy)return;themeBusy=true;
        runtime.getWebExtensionController().ensureBuiltIn("resource://android/assets/theme/","theme@zetatools.local").accept(ext->{
            runOnUiThread(()->{
                if(isDestroyed())return;
                theme=ext;
                boolean on=prefs.getBoolean("theme",false);
                setTheme(on,reload);
            });
        },err->runOnUiThread(()->{themeBusy=false;if(!isDestroyed())toast("테마 설치 실패 · 로그인 테스트는 가능");}));
    }
    private void setTheme(boolean on,boolean reload){
        if(theme==null){themeBusy=false;return;}
        WebExtensionController c=runtime.getWebExtensionController();
        GeckoResult<WebExtension> action=on?c.enable(theme,WebExtensionController.EnableSource.USER):c.disable(theme,WebExtensionController.EnableSource.USER);
        action.accept(ext->runOnUiThread(()->{if(isDestroyed())return;theme=ext;themeBusy=false;themeEnabled=on;prefs.edit().putBoolean("theme",on).apply();if(reload){main.reload();toast(on?"테마 켜짐":"테마 꺼짐");}}),err->runOnUiThread(()->{themeBusy=false;if(!isDestroyed())toast("테마 설정 실패");}));
    }
    private void applyScreen(){
        int flags=0;
        // Keep the native address/origin and system bars visible on authentication pages.
        if(current==main&&ownPage()){
            if(mode==1)flags=View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION;
            if(mode==2)flags=View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY|View.SYSTEM_UI_FLAG_HIDE_NAVIGATION|View.SYSTEM_UI_FLAG_FULLSCREEN;
        }
        getWindow().getDecorView().setSystemUiVisibility(flags);
        if(prefs.getBoolean("awake",false))getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);else getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }
    private void settings(){
        String[] options={"화면 모드","카카오톡 테마: "+(themeEnabled?"켜짐":"꺼짐"),"새로고침","제타 홈","화면 꺼짐 방지: "+(prefs.getBoolean("awake",false)?"켜짐":"꺼짐"),"앱 정보"};
        new AlertDialog.Builder(this).setTitle("ZETA Tools Gecko").setItems(options,(d,w)->{
            switch(w){
                case 0:new AlertDialog.Builder(this).setTitle("화면 모드").setSingleChoiceItems(new String[]{"기본","확장","전체화면"},mode,(a,b)->{mode=b;prefs.edit().putInt("screen",b).apply();a.dismiss();applyScreen();}).setNegativeButton("닫기",null).show();break;
                case 1:if(themeBusy||theme==null)toast("테마 준비 중");else{themeBusy=true;setTheme(!themeEnabled,true);}break;
                case 2:current.reload();break;
                case 3:main.loadUri(HOME);show(main);break;
                case 4:prefs.edit().putBoolean("awake",!prefs.getBoolean("awake",false)).apply();applyScreen();break;
                case 5:new AlertDialog.Builder(this).setTitle("Gecko Preview 0.2.0").setMessage("파이어폭스 엔진 기반 로그인 테스트 앱. 제타 공식 앱이 아닙니다. 계정 인증은 실제 웹사이트에서 진행하며, 쿠키를 외부로 복사하지 않습니다. 먼저 로그인한 뒤 테마를 켜세요.").setPositiveButton("확인",null).show();break;
            }
        }).setOnDismissListener(d->applyScreen()).show();
    }
    private void toast(String s){Toast.makeText(this,s,Toast.LENGTH_SHORT).show();}
    private void back(){if(current!=main){closeTab(current);return;}if(Boolean.TRUE.equals(backs.get(current)))current.goBack();else new AlertDialog.Builder(this).setMessage("앱을 종료할까요?").setPositiveButton("종료",(d,w)->finish()).setNegativeButton("취소",null).show();}
    @Override public void onBackPressed(){back();}
    @Override public void onWindowFocusChanged(boolean focus){super.onWindowFocusChanged(focus);if(focus&&prefs!=null)applyScreen();}
    @Override protected void onDestroy(){if(view!=null&&view.getSession()!=null)view.releaseSession();for(GeckoSession s:new ArrayList<>(tabs))if(s.isOpen())s.close();tabs.clear();super.onDestroy();}
}
