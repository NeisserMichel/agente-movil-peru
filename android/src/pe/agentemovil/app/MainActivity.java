package pe.agentemovil.app;

import android.app.Activity;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.view.View;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

/** Agente Móvil Perú: abre la app web dentro de una app Android. */
public class MainActivity extends Activity {
    static final String HOST = "neissermichel.github.io";
    static final String BASE = "/agente-movil-peru";
    static final String HOME = "https://" + HOST + BASE + "/app/index.html";
    private WebView web;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setStatusBarColor(0xFFFDC202);
        getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
        web = new WebView(this);
        setContentView(web);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setDatabaseEnabled(true);
        s.setUserAgentString(s.getUserAgentString() + " AgenteMovilApp/1.0");
        web.setWebChromeClient(new WebChromeClient());
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView v, WebResourceRequest r) {
                Uri u = r.getUrl();
                String p = u.getPath();
                if ("https".equals(u.getScheme()) && HOST.equals(u.getHost()) && p != null && p.startsWith(BASE)) return false;
                try { startActivity(new Intent(Intent.ACTION_VIEW, u)); } catch (Exception e) { /* sin app para abrirlo */ }
                return true;
            }
            @Override
            public void onReceivedError(WebView v, WebResourceRequest r, WebResourceError e) {
                if (!r.isForMainFrame()) return;
                String html = "<html><head><meta name='viewport' content='width=device-width,initial-scale=1'></head>"
                    + "<body style='font-family:sans-serif;text-align:center;padding:25vh 24px 0;background:#fdc202;color:#17201a'>"
                    + "<h2>Sin conexi&oacute;n</h2><p>Revisa tu internet y vuelve a intentar.</p>"
                    + "<a href='" + HOME + "' style='display:inline-block;margin-top:16px;padding:14px 28px;border-radius:14px;"
                    + "background:#007a26;color:#fff;text-decoration:none;font-weight:bold'>Reintentar</a></body></html>";
                v.loadDataWithBaseURL(null, html, "text/html", "UTF-8", null);
            }
        });
        if (state != null) web.restoreState(state); else web.loadUrl(HOME);
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    public void onBackPressed() {
        if (web.canGoBack()) web.goBack(); else super.onBackPressed();
    }
}
