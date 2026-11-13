// Aula en Android: la interfaz de la Aula del estudiante (en su Mac o en su servidor), por su red privada de Tailscale.
// Mientras no hay conexión, una hoja de papel dice qué falta y ofrece el único botón que toca (como la app del iPhone):
// iniciar sesión en Tailscale, elegir Aula si hay varias, esperar a que responda. Con conexión, la interfaz entera en una
// vista web que se siente app: sin zoom, sin menús de mantener pulsado, los enlaces de fuera en el navegador.
package com.luumlabs.aula;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.res.Configuration;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.ScrollView;
import android.widget.TextView;
import android.widget.Toast;
import android.window.OnBackInvokedCallback;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.ConnectException;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Calendar;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {

    /** Por dónde va la conexión: cada caso es una pantalla. */
    private enum Stage { STARTING, SIGN_IN, APPROVAL, LOOKING, CHOOSING, UNREACHABLE, READY, FAILED }

    private static final String PREFS = "aula";
    private static final String CHOSEN = "aula.host";
    private static final String GATE_COOKIE = "aula_gate";
    private static final String GATE_HEADER = "X-Aula-Gate";
    private static final String DOWNLOAD = "https://github.com/luumlabs/aula/releases/latest";
    private static final int PICK_FILES = 7;

    /** Que se sienta una app y no una página (lo mismo que la app del iPhone). */
    private static final String SOLID = "(() => {"
        + "const meta = document.querySelector('meta[name=\"viewport\"]') || document.head.appendChild(Object.assign(document.createElement('meta'), { name: 'viewport' }));"
        + "meta.setAttribute('content', 'width=device-width, initial-scale=1, minimum-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover');"
        + "if (document.getElementById('aula-solid')) return;"
        + "const style = document.createElement('style'); style.id = 'aula-solid';"
        + "style.textContent = 'html { -webkit-text-size-adjust: 100%; touch-action: manipulation; overscroll-behavior: none; }"
        + " body { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }"
        + " * { -webkit-tap-highlight-color: transparent; }"
        + " a, img, svg { -webkit-user-drag: none; }"
        + " input, textarea, [contenteditable], p, li, td, th, pre, code, blockquote, .katex { -webkit-user-select: text; user-select: text; }';"
        + "document.head.appendChild(style);"
        + "})();";

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService io = Executors.newSingleThreadExecutor();
    private final Tailnet.Listener events = this::onTailnet;
    /** «No responde»: se vuelve a intentar cada pocos segundos (uno solo a la vez, aunque se pida varias veces). */
    private final Runnable retry = this::retryNow;
    private Tailnet tailnet;
    private SharedPreferences prefs;

    private Stage stage = Stage.STARTING;
    private String authURL;
    private String failure;
    private final List<String[]> aulas = new ArrayList<>(); // {host, "1" si está en línea}
    private boolean tailnetRunning;
    private String host;
    /** El túnel de ahora (0: ninguno) y su llave. */
    private int port;
    private String secret;
    /** El puerto del túnel cuya interfaz carga la vista web (0: ninguno); lo único que se abre dentro. */
    private int shownPort;
    /** Al cargar la interfaz en un túnel nuevo se olvida el historial: «atrás» nunca vuelve a un puerto que ya no es suyo. */
    private boolean forgetHistory;
    private String restoreURL;
    private boolean opening;
    private PageBack pageBack; // Android 13 o posterior

    private FrameLayout root;
    private WebView web;
    private ScrollView sheet;
    private ImageView art;
    private TextView title, body, foot, steps;
    private LinearLayout actions;
    private TextView bottomLink;
    private ValueCallback<Uri[]> pendingFiles;

    // MARK: Ciclo de vida

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (saved != null) restoreURL = saved.getString("url");
        buildViews();
        tailnet = Tailnet.get(this);
        tailnet.listen(events);
        tailnet.start();
        render();
    }

    @Override
    protected void onResume() {
        super.onResume();
        tailnet.listen(events);
        if (!tailnet.running()) tailnet.start();
        else tailnet.refresh();
        // al volver, si la conexión se cortó mientras la app estaba en segundo plano, se vuelve a abrir
        if (stage == Stage.READY && port > 0) checkTunnel();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        String url = restoreURL != null ? restoreURL : web != null ? web.getUrl() : null;
        if (url != null) out.putString("url", url);
    }

    @Override
    protected void onDestroy() {
        // nada de lo pendiente (el reintento de «no responde», la respuesta de una comprobación) toca ya esta actividad
        main.removeCallbacksAndMessages(null);
        // al cerrar la app de verdad (no al girar ni al cambiar de tema), el proceso de Tailscale se va con ella; pero si
        // otra actividad ya escucha (se abrió la app antes de que esta terminara de cerrarse), sigue para ella
        if (tailnet.unlisten(events) && isFinishing()) tailnet.stop();
        if (web != null) web.destroy();
        io.shutdownNow();
        super.onDestroy();
    }

    /** Hasta Android 12, «atrás» vuelve por el historial de la interfaz aquí; desde Android 13, por updateBack. */
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (stage == Stage.READY && web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int request, int result, Intent data) {
        if (request == PICK_FILES && pendingFiles != null) {
            pendingFiles.onReceiveValue(pickedFiles(result, data));
            pendingFiles = null;
            return;
        }
        super.onActivityResult(request, result, data);
    }

    /**
     * Los archivos elegidos. Con varios, el selector los da en ClipData (y getData() viene vacío), y parseResult de la
     * vista web solo lee getData(): sin esto, elegir más de uno no subía ninguno.
     */
    private static Uri[] pickedFiles(int result, Intent data) {
        ClipData clip = result == RESULT_OK && data != null ? data.getClipData() : null;
        if (clip != null) {
            List<Uri> uris = new ArrayList<>();
            for (int i = 0; i < clip.getItemCount(); i++) {
                Uri u = clip.getItemAt(i).getUri();
                if (u != null) uris.add(u);
            }
            if (!uris.isEmpty()) return uris.toArray(new Uri[0]);
        }
        return WebChromeClient.FileChooserParams.parseResult(result, data);
    }

    /**
     * «Atrás» en Android 13 o posterior: llega por el despachador del sistema (en Android 16, con la app hecha para
     * Android 16, onBackPressed ya no se llama). Solo se registra mientras la interfaz tenga adónde volver; si no, el
     * gesto es el del sistema (salir, con su animación).
     */
    private void updateBack() {
        if (Build.VERSION.SDK_INT < 33 || web == null) return;
        boolean want = !isDestroyed() && stage == Stage.READY && web.canGoBack();
        if (pageBack == null) {
            if (!want) return;
            pageBack = new PageBack(web);
        }
        pageBack.set(this, want);
    }

    /** OnBackInvokedCallback solo existe desde Android 13: esta clase solo se carga allí. */
    private static final class PageBack {
        private final OnBackInvokedCallback callback;
        private boolean on;

        PageBack(WebView web) {
            callback = () -> { if (web.canGoBack()) web.goBack(); };
        }

        void set(Activity activity, boolean want) {
            if (want == on) return;
            on = want;
            OnBackInvokedDispatcher d = activity.getOnBackInvokedDispatcher();
            if (want) d.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, callback);
            else d.unregisterOnBackInvokedCallback(callback);
        }
    }

    // MARK: La red privada

    private void onTailnet(JSONObject e) {
        if (isDestroyed()) return;
        switch (e.optString("type")) {
            case "starting":
                // un proceso nuevo (el de antes se cayó o se reinició): su túnel, si había uno, ya no existe
                lostTunnel();
                setStage(Stage.STARTING);
                break;
            case "exited":
                // el proceso se cayó y Tailnet lo vuelve a arrancar: mientras, «preparando», no la interfaz de un túnel muerto
                lostTunnel();
                if (stage != Stage.FAILED) setStage(Stage.STARTING);
                break;
            case "needs_login": {
                String url = e.optString("authURL");
                Uri u = Uri.parse(url);
                tailnetRunning = false;
                if ("https".equals(u.getScheme()) && "login.tailscale.com".equals(u.getHost())) {
                    authURL = url;
                    setStage(Stage.SIGN_IN);
                }
                break;
            }
            case "needs_machine_auth":
                tailnetRunning = false;
                setStage(Stage.APPROVAL);
                break;
            case "running":
                tailnetRunning = true;
                aulas.clear();
                JSONArray list = e.optJSONArray("aulas");
                for (int i = 0; list != null && i < list.length(); i++) {
                    JSONObject a = list.optJSONObject(i);
                    if (a != null) aulas.add(new String[] { a.optString("host"), a.optBoolean("online") ? "1" : "0" });
                }
                if (stage == Stage.CHOOSING) { render(); break; }
                if (stage != Stage.READY) openAula(false);
                break;
            case "forwarding":
                onForwarding(e.optString("host"), e.optInt("port"), e.optString("secret"));
                break;
            case "error":
                // un túnel que no se pudo abrir ya no llega: se deja de esperarlo
                opening = false;
                if (stage == Stage.STARTING) { failure = e.optString("message"); setStage(Stage.FAILED); }
                else if (stage == Stage.UNREACHABLE) retrySoon();
                break;
            default:
                break;
        }
    }

    /** La Aula que toca abrir: la elegida si sigue en la red; si solo hay una, esa; si hay varias sin elegir, ninguna. */
    private String target() {
        String chosen = prefs.getString(CHOSEN, null);
        for (String[] a : aulas) if (a[0].equals(chosen)) return chosen;
        return aulas.size() == 1 ? aulas.get(0)[0] : null;
    }

    /**
     * Busca la Aula y le pide al proceso de Tailscale un túnel hasta ella; sin `force`, sigue con el que ya tenga abierto
     * (la actividad se recreó). Devuelve si hay un túnel en camino.
     */
    private boolean openAula(boolean force) {
        if (!tailnetRunning) return false;
        if (opening) return true;
        if (!force && stage == Stage.READY) return false;
        String t = target();
        if (t == null) {
            setStage(aulas.size() > 1 ? Stage.CHOOSING : Stage.LOOKING);
            return false;
        }
        host = t;
        JSONObject open = force ? null : tailnet.forwardingTo(t);
        if (open != null) {
            onForwarding(t, open.optInt("port"), open.optString("secret"));
            return true;
        }
        // el proceso cierra el túnel de antes al abrir el nuevo: la página deja de llamar a ese puerto
        leaveTunnel();
        port = 0;
        secret = null;
        opening = tailnet.connect(t);
        return opening;
    }

    private void onForwarding(String h, int p, String s) {
        opening = false;
        if (h == null || p <= 0 || TextUtils.isEmpty(s)) return;
        if (!h.equals(target())) {
            // llegó el túnel pedido antes de elegir otra Aula: se pide el de la elegida
            if (stage != Stage.READY) openAula(true);
            return;
        }
        host = h;
        port = p;
        secret = s;
        checkTunnel();
    }

    /** ¿Al otro lado del túnel responde Aula? Si sí, se abre su interfaz (con la llave del túnel en una cookie). */
    private void checkTunnel() {
        if (isDestroyed() || io.isShutdown() || port <= 0) return;
        final int p = port;
        final String s = secret;
        io.execute(() -> {
            Tunnel.Probe answer = probe(p, s);
            main.post(() -> {
                // la actividad ya se cerró, o entretanto llegó otro túnel
                if (isDestroyed() || p != port) return;
                if (answer == Tunnel.Probe.AULA) {
                    showAula();
                    return;
                }
                if (answer == Tunnel.Probe.NEW_TUNNEL) {
                    // ese puerto ya no es nuestro: la página deja de llamarlo y el reintento pide un túnel nuevo
                    leaveTunnel();
                    port = 0;
                    secret = null;
                }
                setStage(Stage.UNREACHABLE);
                retrySoon();
            });
        });
    }

    /** Otra vez: por el mismo túnel si sigue siendo nuestro (el Mac despierta); si no, uno nuevo. */
    private void retryNow() {
        main.removeCallbacks(retry);
        if (isDestroyed() || stage != Stage.UNREACHABLE) return;
        if (port > 0) checkTunnel();
        else if (!openAula(true)) retrySoon();
    }

    private void retrySoon() {
        main.removeCallbacks(retry);
        main.postDelayed(retry, 6000);
    }

    private static Tunnel.Probe probe(int port, String secret) {
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL("http://127.0.0.1:" + port + "/health").openConnection();
            c.setConnectTimeout(5000);
            c.setReadTimeout(12000);
            c.setUseCaches(false);
            c.setInstanceFollowRedirects(false);
            c.setRequestProperty(GATE_HEADER, secret);
            int status = c.getResponseCode();
            String app = null;
            if (status == 200) {
                try (InputStream in = c.getInputStream()) {
                    app = new JSONObject(readSome(in, 16 * 1024)).optString("app");
                } catch (org.json.JSONException e) {
                    app = null;
                }
            }
            return Tunnel.probe(false, status, app);
        } catch (ConnectException e) {
            return Tunnel.probe(true, -1, null);
        } catch (IOException e) {
            return Tunnel.probe(false, -1, null);
        } finally {
            if (c != null) c.disconnect();
        }
    }

    private static String readSome(InputStream in, int max) throws IOException {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[4096];
        int n;
        while (out.size() < max && (n = in.read(buf, 0, Math.min(buf.length, max - out.size()))) > 0) out.write(buf, 0, n);
        return new String(out.toByteArray(), StandardCharsets.UTF_8);
    }

    private void showAula() {
        String base = "http://127.0.0.1:" + port;
        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);
        cookies.setCookie(base, GATE_COOKIE + "=" + secret + "; Path=/; HttpOnly; SameSite=Strict");
        cookies.flush();
        if (port != shownPort) {
            // en el túnel nuevo, en la misma pantalla en la que estaba (la interfaz la apunta en el fragmento «#…»)
            String fragment = "";
            String from = restoreURL != null ? restoreURL : web.getUrl();
            if (from != null && from.contains("#")) fragment = from.substring(from.indexOf('#'));
            restoreURL = null;
            shownPort = port;
            forgetHistory = true;
            web.loadUrl(base + "/" + fragment);
        }
        setStage(Stage.READY);
    }

    /** ¿Es `u` la interfaz del túnel que se enseña? */
    private boolean isShown(Uri u) {
        return Tunnel.isTunnel(u.getScheme(), u.getHost(), u.getPort(), shownPort);
    }

    /**
     * La página deja el túnel que se cierra: apunta en qué pantalla estaba (para volver a ella en el nuevo) y deja de
     * llamar a su puerto, que ya no es nuestro: otra app podría ocuparlo y recibiría las cookies de 127.0.0.1.
     */
    private void leaveTunnel() {
        if (shownPort == 0) return;
        String url = web.getUrl();
        if (restoreURL == null && url != null && isShown(Uri.parse(url))) restoreURL = url;
        shownPort = 0;
        web.stopLoading();
        web.loadUrl("about:blank");
    }

    /** El proceso de Tailscale se cayó o es otro: su túnel ya no existe, ni la orden que se le mandó. */
    private void lostTunnel() {
        tailnetRunning = false;
        opening = false;
        port = 0;
        secret = null;
        main.removeCallbacks(retry);
        leaveTunnel();
    }

    /** La interfaz no cargó (su túnel se cerró): se pide otro. */
    private void webFailed() {
        setStage(Stage.UNREACHABLE);
        leaveTunnel();
        port = 0;
        secret = null;
        if (!openAula(true)) retrySoon();
    }

    /** «Abrir otra Aula» (desde Ajustes de la interfaz o desde una pantalla de espera). */
    private void chooseAnother() {
        if (!tailnetRunning) return;
        setStage(aulas.isEmpty() ? Stage.LOOKING : Stage.CHOOSING);
    }

    private void choose(String h) {
        prefs.edit().putString(CHOSEN, h).apply();
        setStage(Stage.STARTING);
        openAula(true);
    }

    private void signOut() {
        new AlertDialog.Builder(this)
            .setTitle(R.string.sign_out)
            .setMessage(R.string.sign_out_confirm)
            .setNegativeButton(R.string.cancel, null)
            .setPositiveButton(R.string.sign_out, (d, w) -> {
                tailnet.logout();
                lostTunnel();
                restoreURL = null;
                CookieManager.getInstance().removeAllCookies(null);
                web.clearCache(true);
                web.loadUrl("about:blank");
                setStage(Stage.STARTING);
            })
            .show();
    }

    // MARK: Lo que se ve

    private void setStage(Stage next) {
        stage = next;
        render();
        updateBack();
    }

    private void buildViews() {
        root = new FrameLayout(this);
        root.setBackgroundColor(color(R.color.paper));

        web = new WebView(this);
        web.setBackgroundColor(Color.TRANSPARENT);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        s.setTextZoom(100);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setSupportMultipleWindows(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        web.setLongClickable(false);
        web.setHapticFeedbackEnabled(false);
        web.addJavascriptInterface(new AppBridge(), "aulaApp");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                Tunnel.Open where = Tunnel.open(u.getScheme(), u.getHost(), u.getPort(), request.isForMainFrame(), shownPort);
                if (where == Tunnel.Open.INSIDE) return false;
                // los enlaces de fuera (una fuente, la página de una clave de IA) en el navegador; otro puerto de
                // 127.0.0.1 también, donde no van las cookies de la app
                if (where == Tunnel.Open.OUTSIDE) openOutside(u);
                return true;
            }

            @Override
            public void doUpdateVisitedHistory(WebView view, String url, boolean isReload) {
                // ya está la interfaz del túnel nuevo: lo de antes (otro puerto, about:blank) sale del historial
                if (forgetHistory && url != null && isShown(Uri.parse(url))) {
                    forgetHistory = false;
                    view.clearHistory();
                }
                updateBack();
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                view.evaluateJavascript(SOLID, null);
                updateBack();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && stage == Stage.READY && isShown(request.getUrl())) webFailed();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = callback;
                try {
                    Intent pick = params.createIntent();
                    pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                    startActivityForResult(pick, PICK_FILES);
                    return true;
                } catch (ActivityNotFoundException e) {
                    pendingFiles = null;
                    return false;
                }
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                // ni cámara ni micrófono: la app no los pide
                request.deny();
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        sheet = new ScrollView(this);
        sheet.setFillViewport(true);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        col.setPadding(dp(28), dp(24), dp(28), dp(18));

        View top = new View(this);
        col.addView(top, new LinearLayout.LayoutParams(1, 0, 1f));
        art = new ImageView(this);
        art.setAdjustViewBounds(true);
        art.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        col.addView(art, new LinearLayout.LayoutParams(Math.min(dp(300), (int) (getResources().getDisplayMetrics().widthPixels * 0.72)), ViewGroup.LayoutParams.WRAP_CONTENT));

        title = text(30, color(R.color.ink));
        title.setTypeface(Typeface.create(Typeface.SERIF, Typeface.NORMAL));
        title.setPadding(0, dp(8), 0, dp(10));
        col.addView(title, wrap());
        body = text(16, color(R.color.soft));
        body.setLineSpacing(0, 1.15f);
        col.addView(body, wrap());
        actions = new LinearLayout(this);
        actions.setOrientation(LinearLayout.VERTICAL);
        actions.setGravity(Gravity.CENTER_HORIZONTAL);
        actions.setPadding(0, dp(18), 0, 0);
        col.addView(actions, wrap());
        foot = text(13, color(R.color.soft));
        foot.setPadding(0, dp(10), 0, 0);
        col.addView(foot, wrap());

        View bottom = new View(this);
        col.addView(bottom, new LinearLayout.LayoutParams(1, 0, 1f));
        steps = text(13, color(R.color.soft));
        steps.setPadding(0, dp(16), 0, dp(10));
        col.addView(steps, wrap());
        bottomLink = text(13, color(R.color.brick));
        bottomLink.setPadding(dp(12), dp(8), dp(12), dp(8));
        col.addView(bottomLink, wrap());

        sheet.addView(col, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(sheet, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        setContentView(root);
        fitSystemBars();
    }

    /** De borde a borde: la interfaz y la hoja de espera dejan sitio a las barras del sistema, la muesca y el teclado. */
    private void fitSystemBars() {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                Insets i = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                v.setPadding(i.left, i.top, i.right, i.bottom);
                return WindowInsets.CONSUMED;
            });
            boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                c.setSystemBarsAppearance(night ? 0 : light, light);
            }
        } else {
            root.setFitsSystemWindows(true);
        }
    }

    private void render() {
        if (root == null) return;
        boolean ready = stage == Stage.READY;
        web.setVisibility(ready ? View.VISIBLE : View.INVISIBLE);
        sheet.setVisibility(ready ? View.GONE : View.VISIBLE);
        if (ready) return;

        boolean lamp = stage == Stage.LOOKING || stage == Stage.UNREACHABLE || stage == Stage.FAILED;
        art.setImageResource(lamp ? R.drawable.spot_lamp : archForHour());
        actions.removeAllViews();
        foot.setVisibility(View.GONE);
        title.setVisibility(View.VISIBLE);
        body.setVisibility(View.VISIBLE);
        int step = 1;
        switch (stage) {
            case STARTING:
                title.setVisibility(View.GONE);
                body.setText(R.string.starting);
                actions.addView(new ProgressBar(this));
                break;
            case SIGN_IN:
                title.setText(R.string.sign_in_title);
                body.setText(R.string.sign_in_body);
                actions.addView(primary(R.string.sign_in_action, v -> openOutside(Uri.parse(authURL))));
                foot.setText(R.string.sign_in_after);
                foot.setVisibility(View.VISIBLE);
                break;
            case APPROVAL:
                title.setText(R.string.approval_title);
                body.setText(R.string.approval_body);
                actions.addView(new ProgressBar(this));
                break;
            case LOOKING:
                step = 2;
                title.setText(R.string.looking_title);
                body.setText(R.string.looking_body);
                actions.addView(primary(R.string.retry, v -> { tailnet.refresh(); openAula(true); }));
                break;
            case CHOOSING:
                step = 2;
                title.setText(R.string.choose_title);
                body.setText(R.string.choose_body);
                for (String[] a : aulas) actions.addView(aulaRow(a[0], "1".equals(a[1])));
                break;
            case UNREACHABLE:
                step = 2;
                title.setText(R.string.unreachable_title);
                body.setText(getString(R.string.unreachable_body, host == null ? "aula-mac" : host));
                actions.addView(primary(R.string.retry, v -> retryNow()));
                if (aulas.size() > 1) actions.addView(quiet(R.string.choose_another, v -> chooseAnother()));
                break;
            case FAILED:
                title.setText(R.string.failed_title);
                body.setText(failure == null ? "Tailscale" : failure);
                actions.addView(primary(R.string.retry, v -> { failure = null; tailnet.stop(); tailnet.start(); setStage(Stage.STARTING); }));
                break;
            default:
                break;
        }
        String[] names = { getString(R.string.step_1), getString(R.string.step_2), getString(R.string.step_3) };
        steps.setText(getString(R.string.step_label, step, names[step - 1]));
        boolean signedIn = stage == Stage.LOOKING || stage == Stage.UNREACHABLE || stage == Stage.CHOOSING || stage == Stage.APPROVAL;
        bottomLink.setText(signedIn ? R.string.sign_out : R.string.get_aula);
        bottomLink.setOnClickListener(signedIn ? v -> signOut() : v -> openOutside(Uri.parse(DOWNLOAD)));
    }

    private int archForHour() {
        int h = Calendar.getInstance().get(Calendar.HOUR_OF_DAY);
        if (h >= 6 && h < 11) return R.drawable.arch_dawn;
        if (h >= 11 && h < 17) return R.drawable.arch_noon;
        if (h >= 17 && h < 21) return R.drawable.arch_dusk;
        return R.drawable.arch_night;
    }

    private View aulaRow(String name, boolean online) {
        LinearLayout row = new LinearLayout(this);
        row.setOrientation(LinearLayout.HORIZONTAL);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(16), 0, dp(16), 0);
        row.setMinimumHeight(dp(52));
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(14));
        bg.setColor(color(R.color.field));
        row.setBackground(bg);
        View dot = new View(this);
        GradientDrawable d = new GradientDrawable();
        d.setShape(GradientDrawable.OVAL);
        d.setColor(online ? color(R.color.brick) : color(R.color.soft));
        dot.setBackground(d);
        dot.setAlpha(online ? 1f : 0.45f);
        row.addView(dot, new LinearLayout.LayoutParams(dp(8), dp(8)));
        TextView label = text(16, color(R.color.ink));
        label.setGravity(Gravity.START);
        label.setTypeface(Typeface.DEFAULT_BOLD);
        label.setText(name);
        label.setPadding(dp(12), 0, dp(8), 0);
        row.addView(label, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        if (!online) {
            TextView off = text(13, color(R.color.soft));
            off.setText(R.string.choose_offline);
            row.addView(off, wrap());
        }
        row.setContentDescription(online ? name : name + ", " + getString(R.string.choose_offline));
        row.setClickable(true);
        row.setFocusable(true);
        row.setOnClickListener(v -> choose(name));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(Math.min(dp(360), (int) (getResources().getDisplayMetrics().widthPixels * 0.86)), ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(10);
        row.setLayoutParams(lp);
        return row;
    }

    private Button primary(int label, View.OnClickListener click) {
        Button b = new Button(this);
        b.setText(label);
        b.setAllCaps(false);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        b.setTypeface(Typeface.DEFAULT_BOLD);
        b.setTextColor(color(R.color.on_brick));
        b.setStateListAnimator(null);
        GradientDrawable bg = new GradientDrawable();
        bg.setCornerRadius(dp(14));
        bg.setColor(color(R.color.brick));
        b.setBackground(bg);
        b.setPadding(dp(26), 0, dp(26), 0);
        b.setMinHeight(dp(50));
        b.setOnClickListener(click);
        b.setLayoutParams(new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(50)));
        return b;
    }

    private TextView quiet(int label, View.OnClickListener click) {
        TextView t = text(15, color(R.color.brick));
        t.setText(label);
        t.setPadding(dp(12), dp(14), dp(12), dp(6));
        t.setOnClickListener(click);
        return t;
    }

    private TextView text(float sp, int color) {
        TextView t = new TextView(this);
        t.setTextSize(TypedValue.COMPLEX_UNIT_SP, sp);
        t.setTextColor(color);
        t.setGravity(Gravity.CENTER_HORIZONTAL);
        t.setMaxWidth(dp(460));
        return t;
    }

    private static LinearLayout.LayoutParams wrap() {
        return new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
    }

    private int dp(float v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private int color(int id) {
        return getResources().getColor(id, getTheme());
    }

    private void openOutside(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.no_browser, Toast.LENGTH_LONG).show();
        }
    }

    /** Lo que la interfaz puede pedir a la app (`window.aulaApp`): abrir otra Aula. */
    private final class AppBridge {
        @JavascriptInterface
        public void switchAula() {
            main.post(() -> { if (!isDestroyed()) chooseAnother(); });
        }
    }
}
