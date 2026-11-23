// Aula en Android: la interfaz de la Aula del estudiante (en su Mac o en su servidor), por su red privada de Tailscale.
// Mientras no hay conexión, una hoja de papel dice qué falta y ofrece el único botón que toca (como la app del iPhone):
// iniciar sesión en Tailscale, elegir Aula si hay varias, esperar a que responda, o probar la demostración. Con conexión,
// la interfaz entera en una vista web que se siente app: sin zoom, sin menús de mantener pulsado, los enlaces de fuera en
// el navegador, «atrás» dentro de Aula, y lo que queda bajo las barras del sistema del color de la página.
package com.luumlabs.aula;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.ApplicationInfo;
import android.content.res.ColorStateList;
import android.content.res.Configuration;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.graphics.Insets;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.graphics.drawable.RippleDrawable;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.DisplayCutout;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.PermissionRequest;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
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
import org.json.JSONException;
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
import java.util.Locale;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {

    /** Por dónde va la conexión: cada caso es una pantalla. */
    private enum Stage { STARTING, SIGN_IN, APPROVAL, LOOKING, CHOOSING, UNREACHABLE, READY, FAILED }

    private static final String PREFS = "aula";
    private static final String CHOSEN = "aula.host";
    /** Ya se llegó alguna vez a una Aula: el arranque no repite los pasos de la primera vez. */
    private static final String REACHED = "aula.reached";
    /** Cómo se veía la página la última vez, si su tema no era el del sistema (para arrancar ya con sus colores). */
    private static final String LOOK = "aula.look";
    /** Solo en la compilación de prueba: la Aula del Mac por `adb reverse` en ese puerto (docs/DEVICES.md). */
    private static final String DEV_PORT = "aula.devPort";
    private static final String GATE_COOKIE = "aula_gate";
    private static final String GATE_HEADER = "X-Aula-Gate";
    private static final String DOWNLOAD = "https://github.com/luumlabs/aula/releases/latest";
    private static final int PICK_FILES = 7;
    /**
     * «Atrás» dentro de la interfaz: se le pregunta primero (window.__aulaBack cierra lo que haya abierto encima o vuelve
     * a la pantalla anterior, y dice si lo hizo; deviceBack.ts). true: lo atendió.
     */
    private static final String ASK_BACK = "(() => { if (typeof window.__aulaBack === 'function') return !!window.__aulaBack();"
        + " if (window.aulaNav && typeof window.aulaNav.back === 'function') { window.aulaNav.back(); return true } return false })()";
    /** Una pestaña del navegador dentro de la app (Custom Tabs, sin la librería): basta con estos extras. */
    private static final String TAB_SESSION = "android.support.customtabs.extra.SESSION";
    private static final String TAB_COLOR = "android.support.customtabs.extra.TOOLBAR_COLOR";
    private static final String TAB_TITLE = "android.support.customtabs.extra.TITLE_VISIBILITY";

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
    /** Cuántas Aulas hay en la red (lo pregunta la interfaz, desde otro hilo). */
    private volatile int aulaCount;
    private boolean tailnetRunning;
    private String host;
    /** El túnel de ahora (0: ninguno) y su llave. */
    private int port;
    private String secret;
    /** El puerto cuya interfaz carga la vista web (0: ninguno): el túnel, la demostración o el Mac por adb; lo único que se abre dentro. */
    private int shownPort;
    /** Al cargar la interfaz en un túnel nuevo se olvida el historial: «atrás» nunca vuelve a un puerto que ya no es suyo. */
    private boolean forgetHistory;
    private String restoreURL;
    private boolean opening;
    /** «Abrir otra Aula» con una Aula abierta: se puede volver a ella (Cancelar, atrás) sin recargarla. */
    private boolean choosingFromReady;

    /** La demostración (sin Mac) o el Mac por adb: la red privada sigue a lo suyo sin cambiar de pantalla. */
    private DemoServer demo;
    private boolean inDemo, demoStarting, demoBundled;
    private int devPort;
    /** La pantalla que tocaría según la red mientras la demostración está abierta. */
    private Stage netStage = Stage.STARTING;
    /** La interfaz enseña ella misma el aviso de la demostración (window.aulaApp.demoNotice): la franja nativa sobra. */
    private boolean pageDemoNotice;

    /** La interfaz tiene adónde volver (window.aulaApp.setCanGoBack). */
    private boolean pageCanGoBack;
    /** La interfaz dibuja bajo las barras del sistema con --aula-safe-* (window.aulaApp.edgeToEdge). */
    private boolean edgeToEdge;
    /** Cómo se ve la página (Shell.js); null hasta que lo diga. */
    private JSONObject look;
    private boolean night;
    private PageBack pageBack; // Android 13 o posterior

    /** Las barras del sistema y la muesca, y el teclado (px). */
    private int insL, insT, insR, insB, imeB;
    private String pushedVars = "";
    private String shellJs = "";

    private FrameLayout root;
    private final Bands bands = new Bands();
    private WebView web;
    private LinearLayout demoBar;
    private View demoLine;
    private TextView demoLabel, demoExit;
    private GradientDrawable demoDot;
    /** La tinta de la franja de la demostración ya es la de un papel oscuro (null: aún sin pintar). */
    private Boolean demoInkDark;
    private ScrollView sheet;
    private ImageView art;
    private TextView title, body, foot, steps;
    private LinearLayout actions, legal;
    private TextView bottomLink;
    private View licenses;
    private View customView;
    private WebChromeClient.CustomViewCallback customCallback;
    private ValueCallback<Uri[]> pendingFiles;
    /** La foto que se pidió a la cámara al elegir archivos (si se eligió la cámara). */
    private Uri photo;

    // MARK: Ciclo de vida

    @Override
    protected void onCreate(Bundle saved) {
        super.onCreate(saved);
        keepPhonePortrait();
        prefs = getSharedPreferences(PREFS, MODE_PRIVATE);
        if (saved != null) restoreURL = saved.getString("url");
        night = systemNight();
        shellJs = readAsset("shell.js");
        demoBundled = DemoServer.bundled(this);
        look = savedLook();
        buildViews();
        tailnet = Tailnet.get(this);
        tailnet.listen(events);
        tailnet.start();
        devPort = devPortOf(getIntent());
        if (devPort > 0) showLocal(devPort, "/");
        else render();
        updateBack();
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        int p = devPortOf(intent);
        if (p > 0 && p != devPort) {
            devPort = p;
            showLocal(p, "/");
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        tailnet.listen(events);
        if (!tailnet.running()) tailnet.start();
        else tailnet.refresh();
        // al volver, si la conexión se cortó mientras la app estaba en segundo plano, se vuelve a abrir
        if (stage == Stage.READY && port > 0 && !local()) checkTunnel();
    }

    @Override
    protected void onPause() {
        super.onPause();
        // la cookie que enlaza este teléfono con la Aula, recién puesta al escribir el código, no se pierde si se cierra la app
        CookieManager.getInstance().flush();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        String url = restoreURL != null ? restoreURL : web != null && !local() ? web.getUrl() : null;
        if (url != null) out.putString("url", url);
    }

    @Override
    protected void onDestroy() {
        // nada de lo pendiente (el reintento de «no responde», la respuesta de una comprobación) toca ya esta actividad
        main.removeCallbacksAndMessages(null);
        // al cerrar la app de verdad (no al girar ni al cambiar de tema), el proceso de Tailscale se va con ella; pero si
        // otra actividad ya escucha (se abrió la app antes de que esta terminara de cerrarse), sigue para ella
        if (tailnet.unlisten(events) && isFinishing()) tailnet.stop();
        if (demo != null) demo.stop();
        if (web != null) web.destroy();
        io.shutdownNow();
        super.onDestroy();
    }

    /**
     * El tema del sistema, el tamaño del texto, el idioma o el giro: la actividad sigue (la interfaz no se recarga ni pierde
     * lo que se estaba escribiendo); se rehacen las pantallas propias con los colores, los textos y las medidas nuevas.
     */
    @Override
    public void onConfigurationChanged(Configuration config) {
        super.onConfigurationChanged(config);
        keepPhonePortrait();
        boolean wasNight = night;
        night = systemNight();
        rebuildSheet();
        if (wasNight != night) {
            if (look != null && !lookIsExplicit(look)) look = null;
            checkPageScheme();
        }
        render();
        applyInsets();
        applyLook();
        pushVars();
    }

    /**
     * Un teléfono (menos de 600 dp de lado corto) se queda en vertical, como el iPhone: girado, entre la cabecera, las
     * pestañas y el teclado no quedaba sitio para leer ni para ver lo que se escribe. Una tableta (o un plegable abierto)
     * gira libre.
     */
    private void keepPhonePortrait() {
        int want = getResources().getConfiguration().smallestScreenWidthDp < 600
            ? ActivityInfo.SCREEN_ORIENTATION_USER_PORTRAIT
            : ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
        if (getRequestedOrientation() != want) setRequestedOrientation(want);
    }

    /** Hasta Android 12, «atrás» llega aquí; desde Android 13, por updateBack. */
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (handleBack()) return;
        // sin adónde volver: la app pasa a segundo plano sin cerrarse (la red privada sigue y al volver está al instante)
        moveTaskToBack(true);
    }

    @Override
    @SuppressWarnings("deprecation")
    protected void onActivityResult(int request, int result, Intent data) {
        if (request == PICK_FILES && pendingFiles != null) {
            Uri[] got = pickedFiles(result, data);
            if ((got == null || got.length == 0) && result == RESULT_OK && photo != null && PhotoProvider.taken(this, photo)) got = new Uri[] { photo };
            pendingFiles.onReceiveValue(got);
            pendingFiles = null;
            photo = null;
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

    // MARK: Atrás

    /** Lo que hace «atrás»: salir de la pantalla completa o de las licencias, volver a la Aula abierta, o atrás en Aula. */
    private boolean handleBack() {
        if (customView != null) {
            leaveFullscreen();
            return true;
        }
        if (licenses != null) {
            closeLicenses();
            return true;
        }
        if (stage == Stage.CHOOSING && choosingFromReady) {
            backToAula();
            return true;
        }
        if (stage != Stage.READY || web == null) return false;
        // primero la interfaz; si no tenía nada que deshacer, su historial; si tampoco, la app pasa a segundo plano
        web.evaluateJavascript(ASK_BACK, handled -> {
            if (isDestroyed() || "true".equals(handled)) return;
            if (web.canGoBack()) web.goBack();
            else moveTaskToBack(true);
        });
        return true;
    }

    /**
     * «Atrás» en Android 13 o posterior: llega por el despachador del sistema (en Android 16, con la app hecha para
     * Android 16, onBackPressed ya no se llama). Se queda registrado siempre: sin él, el «atrás» del sistema en «Hoy» (sin
     * nada que deshacer) cerraba la actividad, y con ella la red privada y la demostración; al volver, la app empezaba de
     * cero. Así, sin nada que hacer dentro, la app pasa a segundo plano sin cerrarse (se pierde la animación de ir al inicio
     * en ese último «atrás»).
     */
    private void updateBack() {
        if (Build.VERSION.SDK_INT < 33 || web == null) return;
        if (pageBack == null) pageBack = new PageBack(this::backOrHide);
        pageBack.set(this, !isDestroyed());
    }

    /** «Atrás» dentro de la app o, sin nada que hacer, a segundo plano (sin cerrarla). */
    private void backOrHide() {
        if (!handleBack()) moveTaskToBack(true);
    }

    /** OnBackInvokedCallback solo existe desde Android 13: esta clase solo se carga allí. */
    private static final class PageBack {
        private final OnBackInvokedCallback callback;
        private boolean on;

        PageBack(Runnable back) {
            callback = back::run;
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
                aulaCount = aulas.size();
                if (local()) break;
                if (stage == Stage.CHOOSING) { render(); break; }
                if (stage != Stage.READY) openAula(false);
                break;
            case "forwarding":
                onForwarding(e.optString("host"), e.optInt("port"), e.optString("secret"));
                break;
            case "error":
                // un túnel que no se pudo abrir ya no llega: se deja de esperarlo
                opening = false;
                if (local()) break;
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
        if (!tailnetRunning || local()) return false;
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
        if (local() || h == null || p <= 0 || TextUtils.isEmpty(s)) return;
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
        if (isDestroyed() || io.isShutdown() || port <= 0 || local()) return;
        final int p = port;
        final String s = secret;
        io.execute(() -> {
            Tunnel.Probe answer = probe(p, s);
            main.post(() -> {
                // la actividad ya se cerró, o entretanto llegó otro túnel o se abrió la demostración
                if (isDestroyed() || p != port || local()) return;
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
        if (isDestroyed() || stage != Stage.UNREACHABLE || local()) return;
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
                } catch (JSONException e) {
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
        prefs.edit().putBoolean(REACHED, true).apply();
        if (port != shownPort) {
            // en el túnel nuevo, en la misma pantalla en la que estaba (la interfaz la apunta en el fragmento «#…»)
            String fragment = "";
            String from = restoreURL != null ? restoreURL : web.getUrl();
            if (from != null && from.contains("#")) fragment = from.substring(from.indexOf('#'));
            restoreURL = null;
            shownPort = port;
            forgetHistory = true;
            pageCanGoBack = false;
            web.loadUrl(base + "/" + fragment);
        }
        setStage(Stage.READY);
    }

    /** ¿Es `u` la interfaz que se enseña (el túnel, la demostración o el Mac por adb)? */
    private boolean isShown(Uri u) {
        return Tunnel.isTunnel(u.getScheme(), u.getHost(), u.getPort(), shownPort);
    }

    /**
     * La página deja el túnel que se cierra: apunta en qué pantalla estaba (para volver a ella en el nuevo) y deja de
     * llamar a su puerto, que ya no es nuestro: otra app podría ocuparlo y recibiría las cookies de 127.0.0.1.
     */
    private void leaveTunnel() {
        if (shownPort == 0 || local()) return;
        String url = web.getUrl();
        if (restoreURL == null && url != null && isShown(Uri.parse(url))) restoreURL = url;
        shownPort = 0;
        pageCanGoBack = false;
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

    /** La interfaz no cargó (su túnel se cerró): se pide otro. En la demostración, se vuelve a abrir. */
    private void webFailed() {
        if (inDemo) {
            exitDemo();
            startDemo();
            return;
        }
        if (devPort > 0) return; // el Mac por adb: lo dice la propia vista web, y se recarga a mano
        setStage(Stage.UNREACHABLE);
        leaveTunnel();
        port = 0;
        secret = null;
        if (!openAula(true)) retrySoon();
    }

    /** «Abrir otra Aula» (desde Ajustes de la interfaz o desde una pantalla de espera). */
    private void chooseAnother() {
        if (!tailnetRunning || local()) return;
        boolean fromReady = stage == Stage.READY && port > 0 && port == shownPort;
        setStage(aulas.isEmpty() ? Stage.LOOKING : Stage.CHOOSING);
        choosingFromReady = fromReady && stage == Stage.CHOOSING;
        render();
        updateBack();
    }

    private void choose(String h) {
        // la que ya estaba abierta: se vuelve a ella tal cual, sin recargar
        if (choosingFromReady && h.equals(host) && port > 0 && port == shownPort) {
            prefs.edit().putString(CHOSEN, h).apply();
            backToAula();
            return;
        }
        prefs.edit().putString(CHOSEN, h).apply();
        setStage(Stage.STARTING);
        openAula(true);
    }

    /** Cancelar la lista de Aulas: de vuelta a la que estaba abierta. */
    private void backToAula() {
        setStage(Stage.READY);
    }

    private void signOut() {
        new AlertDialog.Builder(this)
            .setTitle(R.string.sign_out)
            .setMessage(R.string.sign_out_confirm)
            .setNegativeButton(R.string.cancel, null)
            // la cuenta la crea Tailscale al iniciar sesión: cómo borrarla del todo
            .setNeutralButton(R.string.delete_tailscale, (d, w) -> openOutside(Uri.parse(getString(R.string.delete_tailscale_url))))
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

    // MARK: La demostración y el Mac por adb

    private boolean local() {
        return inDemo || devPort > 0;
    }

    /** El puerto del Mac por `adb reverse` (solo en la compilación de prueba: --ei aula.devPort <puerto>). */
    private int devPortOf(Intent intent) {
        if (intent == null || (getApplicationInfo().flags & ApplicationInfo.FLAG_DEBUGGABLE) == 0) return 0;
        Bundle extras = intent.getExtras();
        if (extras == null || !extras.containsKey(DEV_PORT)) return 0;
        // --ei aula.devPort <puerto> (o --es)
        int p = extras.getInt(DEV_PORT, 0);
        if (p == 0) {
            try {
                p = Integer.parseInt(String.valueOf(extras.getString(DEV_PORT)).trim());
            } catch (NumberFormatException e) {
                p = 0;
            }
        }
        return p > 0 && p < 65536 ? p : 0;
    }

    /** Enseña una interfaz servida en este teléfono (la demostración) o por adb (el Mac de quien desarrolla). */
    private void showLocal(int p, String path) {
        if (!local()) netStage = stage == Stage.READY ? Stage.STARTING : stage;
        shownPort = p;
        forgetHistory = true;
        pageCanGoBack = false;
        web.loadUrl("http://127.0.0.1:" + p + path);
        show(Stage.READY);
    }

    /** Abre la demostración: el curso de ejemplo, servido por la propia app. */
    private void startDemo() {
        if (!demoBundled || demoStarting || inDemo || devPort > 0) return;
        demoStarting = true;
        String unavailable = getString(R.string.demo_unavailable);
        String reply = getString(R.string.demo_chat_reply);
        io.execute(() -> {
            DemoServer server = null;
            int p = 0;
            try {
                server = DemoServer.open(this, unavailable, reply);
                p = server.start();
            } catch (IOException | JSONException | RuntimeException e) {
                if (server != null) server.stop();
                server = null;
            }
            final DemoServer s = server;
            final int at = p;
            main.post(() -> {
                demoStarting = false;
                if (s == null) {
                    Toast.makeText(this, R.string.demo_failed, Toast.LENGTH_LONG).show();
                    return;
                }
                if (isDestroyed()) {
                    s.stop();
                    return;
                }
                // lo que la red tuviera abierto deja de llamar a su puerto antes de enseñar la demostración
                leaveTunnel();
                demo = s;
                pageDemoNotice = false;
                netStage = stage == Stage.READY ? Stage.STARTING : stage;
                inDemo = true;
                // «demo=1»: la interfaz usa sus datos de ejemplo donde el Mac daría los del estudiante
                showLocal(at, "/?demo=1");
            });
        });
    }

    /** Sale de la demostración y vuelve a donde estaba la conexión con el Mac. */
    private void exitDemo() {
        if (!inDemo) return;
        inDemo = false;
        pageDemoNotice = false;
        if (demo != null) demo.stop();
        demo = null;
        shownPort = 0;
        pageCanGoBack = false;
        web.stopLoading();
        web.loadUrl("about:blank");
        restoreURL = null;
        opening = false;
        if (tailnetRunning) {
            show(Stage.STARTING);
            openAula(true);
        } else {
            show(netStage == Stage.READY ? Stage.STARTING : netStage);
        }
    }

    // MARK: Lo que se ve

    /** La pantalla que pide la red (mientras la demostración está abierta, solo se apunta). */
    private void setStage(Stage next) {
        if (local()) {
            netStage = next;
            return;
        }
        show(next);
    }

    private void show(Stage next) {
        if (next != Stage.CHOOSING) choosingFromReady = false;
        stage = next;
        render();
        updateBack();
        applyInsets();
        applyLook();
    }

    private void buildViews() {
        root = new FrameLayout(this);
        bands.setPaper(color(R.color.paper));
        root.setBackground(bands);

        web = new WebView(this);
        web.setBackgroundColor(Color.TRANSPARENT);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setSupportZoom(false);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        // el tamaño del texto del sistema llega a la interfaz como --aula-font-scale (la WebView no lo aplica a ciegas)
        s.setTextZoom(100);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true);
        s.setSupportMultipleWindows(false);
        web.setOverScrollMode(View.OVER_SCROLL_NEVER);
        // mantener pulsado selecciona y copia lo que se lee (lo `.selectable`: una respuesta de Aula, la lección); en los
        // controles no, porque shell.js les quita la selección con CSS
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
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                // una página nueva: ella dirá si tiene adónde volver, si dibuja bajo las barras o si enseña su aviso de la
                // demostración (la de vincular no hace nada de eso)
                pageCanGoBack = false;
                if (edgeToEdge || pageDemoNotice) {
                    edgeToEdge = false;
                    pageDemoNotice = false;
                    render();
                    applyInsets();
                }
                updateBack();
            }

            @Override
            public void onPageCommitVisible(WebView view, String url) {
                // antes de que se vea: sin zoom ni destellos, y los márgenes de las barras
                dressPage(view);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                dressPage(view);
                updateBack();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && stage == Stage.READY && isShown(request.getUrl())) webFailed();
            }

            /** El túnel contesta 502/503/504 (Aula no responde: el Mac se durmió) o 403 (la llave no vale): se busca otra vez. */
            @Override
            public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                int code = response == null ? 0 : response.getStatusCode();
                boolean gone = code == 403 || code == 502 || code == 503 || code == 504;
                if (gone && request.isForMainFrame() && stage == Stage.READY && !local() && isShown(request.getUrl())) webFailed();
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingFiles != null) pendingFiles.onReceiveValue(null);
                pendingFiles = callback;
                photo = null;
                try {
                    startActivityForResult(fileChooser(params), PICK_FILES);
                    return true;
                } catch (ActivityNotFoundException e) {
                    pendingFiles = null;
                    photo = null;
                    return false;
                }
            }

            @Override
            public void onPermissionRequest(PermissionRequest request) {
                // ni cámara ni micrófono para la página: las fotos se hacen con la app de cámara (onShowFileChooser)
                request.deny();
            }

            /** Pantalla completa (presentar unas diapositivas, el botón de un vídeo): encima de todo, sin barras. */
            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customCallback = callback;
                view.setBackgroundColor(Color.BLACK);
                root.addView(view, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
                setBarsHidden(true);
                updateBack();
            }

            @Override
            public void onHideCustomView() {
                removeFullscreen();
            }

            /** Un vídeo sin portada: nada (no el dibujo gris de la vista web). */
            @Override
            public Bitmap getDefaultVideoPoster() {
                return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
            }
        });
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));

        buildDemoBar();
        buildSheet();

        setContentView(root);
        fitSystemBars();
    }

    /** Lo que la página necesita de la app cada vez que se carga: Shell.js y los márgenes de las barras. */
    private void dressPage(WebView view) {
        if (!shellJs.isEmpty()) view.evaluateJavascript(shellJs, null);
        pushedVars = "";
        pushVars();
    }

    /** El selector de archivos; si sirven imágenes, con la cámara al lado (la foto la guarda PhotoProvider). */
    private Intent fileChooser(WebChromeClient.FileChooserParams params) {
        Intent pick = params.createIntent();
        pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == WebChromeClient.FileChooserParams.MODE_OPEN_MULTIPLE);
        if (!acceptsImages(params)) return pick;
        Uri out = PhotoProvider.newPhoto(this);
        if (out == null) return pick;
        Intent camera = new Intent(MediaStore.ACTION_IMAGE_CAPTURE)
            .putExtra(MediaStore.EXTRA_OUTPUT, out)
            .addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        camera.setClipData(ClipData.newRawUri("", out));
        if (camera.resolveActivity(getPackageManager()) == null) return pick;
        photo = out;
        Intent chooser = Intent.createChooser(pick, getString(R.string.pick_title));
        chooser.putExtra(Intent.EXTRA_INITIAL_INTENTS, new Intent[] { camera });
        return chooser;
    }

    private static boolean acceptsImages(WebChromeClient.FileChooserParams params) {
        String[] types = params.getAcceptTypes();
        if (types == null || types.length == 0) return true;
        for (String t : types) {
            for (String one : t.split(",")) {
                String x = one.trim().toLowerCase(Locale.ROOT);
                if (x.isEmpty() || x.equals("*/*") || x.startsWith("image/") || x.equals(".jpg") || x.equals(".jpeg") || x.equals(".png") || x.equals(".heic")) return true;
            }
        }
        return false;
    }

    /** La franja de la demostración: dice que lo es y deja salir (como en el iPhone). */
    private void buildDemoBar() {
        demoBar = new LinearLayout(this);
        demoBar.setOrientation(LinearLayout.VERTICAL);
        demoBar.setVisibility(View.GONE);
        demoBar.setClickable(true);
        LinearLayout row = new LinearLayout(this);
        row.setGravity(Gravity.CENTER_VERTICAL);
        row.setPadding(dp(18), 0, dp(6), 0);
        View dot = new View(this);
        GradientDrawable d = new GradientDrawable();
        d.setShape(GradientDrawable.OVAL);
        d.setColor(color(R.color.brick));
        dot.setBackground(d);
        demoDot = d;
        row.addView(dot, new LinearLayout.LayoutParams(dp(7), dp(7)));
        TextView label = text(13, color(R.color.soft));
        demoLabel = label;
        label.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        label.setText(R.string.demo_bar);
        label.setSingleLine(true);
        label.setEllipsize(TextUtils.TruncateAt.END);
        label.setPadding(dp(10), 0, dp(8), 0);
        row.addView(label, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        TextView exit = text(15, color(R.color.brick));
        demoExit = exit;
        exit.setTypeface(Typeface.DEFAULT_BOLD);
        exit.setText(R.string.demo_exit);
        exit.setGravity(Gravity.CENTER);
        exit.setMinWidth(dp(48));
        exit.setPadding(dp(14), 0, dp(14), 0);
        exit.setBackground(LicensesView.ripple(this, color(R.color.brick), dp(12)));
        exit.setOnClickListener(v -> exitDemo());
        row.addView(exit, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(48)));
        demoBar.addView(row, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(48)));
        demoLine = new View(this);
        demoLine.setBackgroundColor(color(R.color.line));
        demoBar.addView(demoLine, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, Math.max(1, dp(0.5f))));
        root.addView(demoBar, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT, Gravity.TOP));
        demoInkDark = null;
    }

    // la tinta de la franja de la demostración en papel claro y en papel oscuro (los de values/ y values-night/themes.xml)
    private static final int[] DEMO_INK_LIGHT = { 0xFF77716A, 0xFFB4502F, 0x1A2A2520 };
    private static final int[] DEMO_INK_DARK = { 0xFFB3ACA3, 0xFFEE9F72, 0x24EFE6DC };

    /**
     * La tinta de la franja según su papel, que es el de la página: el tema de Aula puede no ser el del sistema (Aula en
     * claro con el sistema en oscuro), y con los colores del sistema el texto se quedaba sin contraste.
     */
    private void tintDemoBar(boolean darkPaper) {
        if (demoLabel == null || (demoInkDark != null && demoInkDark == darkPaper)) return;
        demoInkDark = darkPaper;
        int[] ink = darkPaper ? DEMO_INK_DARK : DEMO_INK_LIGHT;
        demoLabel.setTextColor(ink[0]);
        demoDot.setColor(ink[1]);
        demoExit.setTextColor(ink[1]);
        demoExit.setBackground(LicensesView.ripple(this, ink[1], dp(12)));
        demoLine.setBackgroundColor(ink[2]);
    }

    private boolean demoBarShown() {
        return inDemo && !pageDemoNotice && stage == Stage.READY;
    }

    /** La hoja de espera (las pantallas propias), con los colores, los textos y las medidas de ahora. */
    private void buildSheet() {
        sheet = new ScrollView(this);
        sheet.setFillViewport(true);
        LinearLayout col = new LinearLayout(this);
        col.setOrientation(LinearLayout.VERTICAL);
        col.setGravity(Gravity.CENTER_HORIZONTAL);
        col.setPadding(dp(28), dp(24), dp(28), dp(12));

        View top = new View(this);
        col.addView(top, new LinearLayout.LayoutParams(1, 0, 1f));
        art = new ImageView(this);
        art.setAdjustViewBounds(true);
        art.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        col.addView(art, new LinearLayout.LayoutParams(artWidth(), ViewGroup.LayoutParams.WRAP_CONTENT));

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
        col.addView(actions, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));
        foot = text(13, color(R.color.soft));
        foot.setPadding(0, dp(10), 0, 0);
        col.addView(foot, wrap());

        View bottom = new View(this);
        col.addView(bottom, new LinearLayout.LayoutParams(1, 0, 1f));
        steps = text(13, color(R.color.soft));
        steps.setPadding(0, dp(16), 0, dp(6));
        col.addView(steps, wrap());
        bottomLink = text(13, color(R.color.brick));
        bottomLink.setGravity(Gravity.CENTER);
        bottomLink.setMinHeight(dp(44));
        bottomLink.setPadding(dp(12), 0, dp(12), 0);
        bottomLink.setBackground(LicensesView.ripple(this, color(R.color.brick), dp(10)));
        col.addView(bottomLink, wrap());

        // lo legal, discreto al pie de todas las pantallas de espera (como en el iPhone)
        legal = new LinearLayout(this);
        legal.setGravity(Gravity.CENTER);
        legal.addView(link(R.string.privacy_link, v -> openOutside(Uri.parse(getString(R.string.privacy_url)))));
        TextView dot = text(12, color(R.color.soft));
        dot.setText("·");
        dot.setImportantForAccessibility(View.IMPORTANT_FOR_ACCESSIBILITY_NO);
        legal.addView(dot);
        legal.addView(link(R.string.licenses_link, v -> openLicenses()));
        col.addView(legal, wrap());

        sheet.addView(col, new ScrollView.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(sheet, root.indexOfChild(demoBar), new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
    }

    /** El dibujo: hasta 300 dp y el 72 % del ancho; en una pantalla baja (un teléfono apaisado), que no empuje el botón fuera. */
    private int artWidth() {
        Configuration c = getResources().getConfiguration();
        float w = Math.min(300, c.screenWidthDp * 0.72f);
        if (c.screenHeightDp < 520) w = Math.min(w, c.screenHeightDp * 0.3f * 1080f / 930f);
        return dp(w);
    }

    /** Tras un cambio de tema, de tamaño de texto, de idioma o un giro: la hoja, de nuevo; la vista web sigue. */
    private void rebuildSheet() {
        if (root == null) return;
        root.removeView(sheet);
        buildSheet();
        bands.setPaper(color(R.color.paper));
        root.removeView(demoBar);
        buildDemoBar();
        if (licenses != null) {
            root.removeView(licenses);
            licenses = null;
            openLicenses();
        }
        if (customView != null) customView.bringToFront();
    }

    /** De borde a borde: la ventana dibuja bajo las barras del sistema y la muesca; lo que hay en cada sitio lo dice applyInsets. */
    @SuppressWarnings("deprecation")
    private void fitSystemBars() {
        Window w = getWindow();
        if (Build.VERSION.SDK_INT >= 28) {
            // apaisado, la muesca queda en un lado corto: papel detrás, no una franja negra
            WindowManager.LayoutParams lp = w.getAttributes();
            lp.layoutInDisplayCutoutMode = Build.VERSION.SDK_INT >= 30
                ? WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                : WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
            w.setAttributes(lp);
        }
        if (Build.VERSION.SDK_INT >= 29) {
            // sin el velo que Android pone bajo los tres botones: debajo ya hay el color de la página
            w.setStatusBarContrastEnforced(false);
            w.setNavigationBarContrastEnforced(false);
        }
        if (Build.VERSION.SDK_INT >= 30) w.setDecorFitsSystemWindows(false);
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets kb = insets.getInsets(WindowInsets.Type.ime());
                setInsets(bars.left, bars.top, bars.right, bars.bottom, kb.bottom);
                return WindowInsets.CONSUMED;
            }
            int l = insets.getStableInsetLeft(), t = insets.getStableInsetTop(), r = insets.getStableInsetRight(), b = insets.getStableInsetBottom();
            if (Build.VERSION.SDK_INT >= 28 && insets.getDisplayCutout() != null) {
                DisplayCutout cut = insets.getDisplayCutout();
                l = Math.max(l, cut.getSafeInsetLeft());
                t = Math.max(t, cut.getSafeInsetTop());
                r = Math.max(r, cut.getSafeInsetRight());
                b = Math.max(b, cut.getSafeInsetBottom());
            }
            // hasta Android 10 el teclado llega como la parte de abajo que pasa de las barras
            int all = insets.getSystemWindowInsetBottom();
            setInsets(l, t, r, b, all > b ? all : 0);
            return insets.consumeSystemWindowInsets();
        });
        applyLook();
    }

    private void setInsets(int l, int t, int r, int b, int ime) {
        insL = l;
        insT = t;
        insR = r;
        insB = b;
        imeB = ime;
        applyInsets();
    }

    /**
     * Qué va bajo cada barra. Las pantallas propias y las licencias, dentro. La interfaz, dentro también, con lo de fuera
     * pintado de su color (Bands); o, si ella lo pide (edgeToEdge), hasta el borde, dejando sitio con --aula-safe-*. El
     * teclado siempre empuja desde abajo.
     */
    private void applyInsets() {
        if (root == null) return;
        int bottom = Math.max(insB, imeB);
        sheet.setPadding(insL, insT, insR, bottom);
        if (licenses != null) licenses.setPadding(insL, insT, insR, bottom);

        boolean bar = demoBarShown();
        demoBar.setVisibility(bar ? View.VISIBLE : View.GONE);
        demoBar.setPadding(insL, insT, insR, 0);
        boolean edge = edgeToEdge && stage == Stage.READY;
        int top = bar ? insT + dp(48) + Math.max(1, dp(0.5f)) : edge ? 0 : insT;
        int left = edge ? 0 : insL;
        int right = edge ? 0 : insR;
        int webBottom = edge ? imeB : bottom;
        FrameLayout.LayoutParams lp = (FrameLayout.LayoutParams) web.getLayoutParams();
        if (lp.leftMargin != left || lp.topMargin != top || lp.rightMargin != right || lp.bottomMargin != webBottom) {
            lp.setMargins(left, top, right, webBottom);
            web.setLayoutParams(lp);
        }
        bands.setInsets(insL, insT, insR, insB);
        pushVars();
    }

    /** Los márgenes que la página tiene que dejarse ella (CSS px) y el tamaño del texto del sistema. */
    private void pushVars() {
        if (web == null || stage != Stage.READY) return;
        boolean edge = edgeToEdge;
        float d = getResources().getDisplayMetrics().density;
        int top = edge && !demoBarShown() ? Math.round(insT / d) : 0;
        int left = edge ? Math.round(insL / d) : 0;
        int right = edge ? Math.round(insR / d) : 0;
        int bottom = edge && imeB == 0 ? Math.round(insB / d) : 0;
        float scale = fontScale();
        boolean ime = imeB > 0;
        String vars = top + "," + right + "," + bottom + "," + left + "," + scale + "," + ime;
        if (vars.equals(pushedVars)) return;
        pushedVars = vars;
        // los márgenes (--aula-safe-*), el teclado (html.ime-open, lo lee keyboard.ts) y el tamaño del texto del sistema
        // (window.__aulaFontScale de theme.tsx, o __aulaPendingFontScale si la interfaz aún no cargó)
        String js = "(() => { const r = document.documentElement; if (!r) return; const s = r.style;"
            + " for (const [k, v] of [['top'," + top + "],['right'," + right + "],['bottom'," + bottom + "],['left'," + left + "]]) {"
            + " s.setProperty('--aula-safe-' + k, v + 'px'); s.setProperty('--aula-inset-' + k, v + 'px') }"
            + " s.setProperty('--aula-font-scale', '" + scale + "'); r.classList.toggle('ime-open', " + ime + ");"
            + " if (typeof window.__aulaFontScale === 'function') window.__aulaFontScale(" + scale + "); else window.__aulaPendingFontScale = " + scale + ";"
            + " window.dispatchEvent(new Event('aula:insets')) })()";
        web.evaluateJavascript(js, null);
    }

    /** El tamaño del texto del sistema, entre 1 y 1,3 (por debajo de 1, Aula ya tiene su propio ajuste). */
    private float fontScale() {
        float f = getResources().getConfiguration().fontScale;
        return Math.round(Math.max(1f, Math.min(1.3f, f)) * 100) / 100f;
    }

    /** Los colores bajo las barras y la tinta de sus iconos: los de la página con Aula a la vista; si no, los de la app. */
    @SuppressWarnings("deprecation")
    private void applyLook() {
        boolean page = stage == Stage.READY && customView == null;
        int topColor, bottomColor;
        if (page) {
            Bands.Edge t = edge(look, "top", color(R.color.page_top));
            Bands.Edge b = edge(look, "bottom", color(R.color.page_bottom));
            int l = parse(look == null ? null : look.optString("left"), t.main);
            int r = parse(look == null ? null : look.optString("right"), t.main);
            bands.setPage(t, b, l, r);
            topColor = t.main;
            bottomColor = b.main;
            // la franja de la demostración, del mismo papel que lo de arriba de la página (y su tinta, la de ese papel)
            demoBar.setBackgroundColor(t.main);
            tintDemoBar(isDark(t.main));
        } else {
            bands.setPage(null, null, 0, 0);
            topColor = bottomColor = color(R.color.paper);
        }
        if (customView != null) return;
        boolean lightTop = !isDark(topColor);
        boolean lightBottom = !isDark(bottomColor);
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c == null) return;
            int flags = (lightTop ? WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS : 0)
                | (lightBottom ? WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS : 0);
            c.setSystemBarsAppearance(flags, WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
        } else {
            // hasta Android 10: lo mismo con las banderas de siempre (los iconos oscuros de abajo, desde Android 8.0)
            int flags = View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | (lightTop ? View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR : 0)
                | (lightBottom ? View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR : 0);
            getWindow().getDecorView().setSystemUiVisibility(flags);
        }
    }

    /** Pantalla completa: sin barras (vuelven al deslizar desde el borde); al salir, como estaban. */
    @SuppressWarnings("deprecation")
    private void setBarsHidden(boolean hide) {
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c == null) return;
            if (hide) {
                c.setSystemBarsBehavior(WindowInsetsController.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE);
                c.hide(WindowInsets.Type.systemBars());
            } else {
                c.show(WindowInsets.Type.systemBars());
            }
        } else if (hide) {
            getWindow().getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION | View.SYSTEM_UI_FLAG_FULLSCREEN | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY);
        }
        if (!hide) applyLook();
    }

    private void leaveFullscreen() {
        if (customCallback != null) customCallback.onCustomViewHidden();
        removeFullscreen();
    }

    private void removeFullscreen() {
        if (customView == null) return;
        root.removeView(customView);
        customView = null;
        customCallback = null;
        setBarsHidden(false);
        updateBack();
    }

    private void openLicenses() {
        if (licenses != null) return;
        licenses = LicensesView.build(this, this::closeLicenses, this::openOutside);
        root.addView(licenses, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        applyInsets();
        updateBack();
    }

    private void closeLicenses() {
        if (licenses == null) return;
        root.removeView(licenses);
        licenses = null;
        updateBack();
    }

    private void render() {
        if (root == null) return;
        boolean ready = stage == Stage.READY;
        web.setVisibility(ready ? View.VISIBLE : View.INVISIBLE);
        sheet.setVisibility(ready ? View.GONE : View.VISIBLE);
        demoBar.setVisibility(demoBarShown() ? View.VISIBLE : View.GONE);
        if (ready) return;

        boolean lamp = stage == Stage.LOOKING || stage == Stage.UNREACHABLE || stage == Stage.FAILED;
        art.setImageResource(lamp ? R.drawable.spot_lamp : archForHour());
        actions.removeAllViews();
        foot.setVisibility(View.GONE);
        foot.setTextColor(color(R.color.soft));
        foot.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        title.setVisibility(View.VISIBLE);
        body.setVisibility(View.VISIBLE);
        int step = 1;
        boolean demoHere = false;
        switch (stage) {
            case STARTING:
                title.setVisibility(View.GONE);
                body.setText(R.string.starting);
                actions.addView(spinner());
                break;
            case SIGN_IN:
                title.setText(R.string.sign_in_title);
                body.setText(R.string.sign_in_body);
                actions.addView(primary(R.string.sign_in_action, v -> openSignIn(Uri.parse(authURL))));
                foot.setText(R.string.sign_in_after);
                foot.setVisibility(View.VISIBLE);
                demoHere = true;
                break;
            case APPROVAL:
                title.setText(R.string.approval_title);
                body.setText(R.string.approval_body);
                actions.addView(spinner());
                break;
            case LOOKING:
                step = 2;
                title.setText(R.string.looking_title);
                body.setText(R.string.looking_body);
                actions.addView(primary(R.string.retry, v -> { tailnet.refresh(); openAula(true); }));
                demoHere = true;
                break;
            case CHOOSING:
                step = 2;
                title.setText(R.string.choose_title);
                body.setText(aulas.size() > 1 ? R.string.choose_body : R.string.choose_body_one);
                for (String[] a : aulas) actions.addView(aulaRow(a[0], "1".equals(a[1])));
                if (choosingFromReady) actions.addView(quiet(R.string.cancel, v -> backToAula()));
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
                body.setText(R.string.failed_body);
                actions.addView(primary(R.string.retry, v -> { failure = null; tailnet.stop(); tailnet.start(); setStage(Stage.STARTING); }));
                // lo técnico (el error de Tailscale o de Android, en inglés), pequeño, para quien quiera saberlo
                if (!TextUtils.isEmpty(failure)) {
                    foot.setText(failure);
                    foot.setTextSize(TypedValue.COMPLEX_UNIT_SP, 11);
                    foot.setTextColor((color(R.color.soft) & 0x00FFFFFF) | 0xA0000000);
                    foot.setVisibility(View.VISIBLE);
                }
                demoHere = true;
                break;
            default:
                break;
        }
        // sin Mac a mano (o antes de instalar nada): Aula de verdad, con un curso de ejemplo
        if (demoHere && demoBundled) actions.addView(quiet(R.string.demo_action, v -> startDemo()));

        // al arrancar, los pasos de la primera vez solo la primera vez
        boolean quietStart = stage == Stage.STARTING && prefs.getBoolean(REACHED, false);
        String[] names = { getString(R.string.step_1), getString(R.string.step_2), getString(R.string.step_3) };
        steps.setText(getString(R.string.step_label, step, names[step - 1]));
        steps.setVisibility(quietStart ? View.INVISIBLE : View.VISIBLE);
        boolean signedIn = stage == Stage.LOOKING || stage == Stage.UNREACHABLE || stage == Stage.CHOOSING || stage == Stage.APPROVAL;
        bottomLink.setText(signedIn ? R.string.sign_out : R.string.get_aula);
        bottomLink.setOnClickListener(signedIn ? v -> signOut() : v -> openOutside(Uri.parse(DOWNLOAD)));
        bottomLink.setVisibility(quietStart ? View.INVISIBLE : View.VISIBLE);
        legal.setVisibility(quietStart ? View.INVISIBLE : View.VISIBLE);
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
        row.setBackground(pressable(color(R.color.ink), bg, dp(14)));
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
        // un nombre largo se recorta por el medio («aula-servidor…casa»), nunca a mitad de palabra en dos líneas
        label.setSingleLine(true);
        label.setEllipsize(TextUtils.TruncateAt.MIDDLE);
        label.setPadding(dp(12), 0, dp(8), 0);
        row.addView(label, new LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f));
        if (!online) {
            TextView off = text(13, color(R.color.soft));
            off.setText(R.string.choose_offline);
            off.setSingleLine(true);
            row.addView(off, wrap());
        }
        row.setContentDescription(online ? name : name + ", " + getString(R.string.choose_offline));
        row.setClickable(true);
        row.setFocusable(true);
        row.setOnClickListener(v -> choose(name));
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(Math.min(dp(360), (int) (getResources().getDisplayMetrics().widthPixels * 0.86)), ViewGroup.LayoutParams.WRAP_CONTENT);
        lp.bottomMargin = dp(10);
        lp.gravity = Gravity.CENTER_HORIZONTAL;
        row.setLayoutParams(lp);
        return row;
    }

    private ProgressBar spinner() {
        ProgressBar p = new ProgressBar(this);
        LinearLayout.LayoutParams lp = wrap();
        lp.gravity = Gravity.CENTER_HORIZONTAL;
        p.setLayoutParams(lp);
        return p;
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
        b.setBackground(pressable(color(R.color.on_brick), bg, dp(14)));
        b.setPadding(dp(26), 0, dp(26), 0);
        b.setMinHeight(dp(50));
        b.setOnClickListener(click);
        LinearLayout.LayoutParams lp = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, dp(50));
        lp.gravity = Gravity.CENTER_HORIZONTAL;
        b.setLayoutParams(lp);
        return b;
    }

    /** Una acción secundaria: texto de ladrillo, con su onda al tocarlo, tan ancho como su texto. */
    private TextView quiet(int label, View.OnClickListener click) {
        TextView t = text(15, color(R.color.brick));
        t.setText(label);
        t.setGravity(Gravity.CENTER);
        t.setMinHeight(dp(48));
        t.setPadding(dp(14), 0, dp(14), 0);
        t.setBackground(LicensesView.ripple(this, color(R.color.brick), dp(12)));
        t.setOnClickListener(click);
        LinearLayout.LayoutParams lp = wrap();
        lp.topMargin = dp(6);
        lp.gravity = Gravity.CENTER_HORIZONTAL;
        t.setLayoutParams(lp);
        return t;
    }

    private TextView link(int label, View.OnClickListener click) {
        TextView t = text(12, color(R.color.soft));
        t.setText(label);
        t.setGravity(Gravity.CENTER);
        t.setMinHeight(dp(36));
        t.setPadding(dp(8), 0, dp(8), 0);
        t.setBackground(LicensesView.ripple(this, color(R.color.ink), dp(8)));
        t.setOnClickListener(click);
        return t;
    }

    /** Un fondo con la onda del sistema al tocar, del color `ripple` (translúcido), sobre `content`. */
    private Drawable pressable(int ripple, Drawable content, float radius) {
        GradientDrawable mask = new GradientDrawable();
        mask.setCornerRadius(radius);
        mask.setColor(Color.WHITE);
        return new RippleDrawable(ColorStateList.valueOf((ripple & 0x00FFFFFF) | 0x33000000), content, mask);
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

    private boolean systemNight() {
        return (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK) == Configuration.UI_MODE_NIGHT_YES;
    }

    private void openOutside(Uri u) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE));
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.no_browser, Toast.LENGTH_LONG).show();
        }
    }

    /**
     * Iniciar sesión en Tailscale sin salir de la app: una pestaña del navegador encima de Aula (Custom Tabs, con solo los
     * extras del protocolo; un navegador que no los conoce la abre como siempre). Al terminar se cierra y Aula sigue sola.
     */
    private void openSignIn(Uri u) {
        Intent tab = new Intent(Intent.ACTION_VIEW, u).addCategory(Intent.CATEGORY_BROWSABLE);
        Bundle session = new Bundle();
        session.putBinder(TAB_SESSION, null);
        tab.putExtras(session);
        tab.putExtra(TAB_COLOR, color(R.color.paper));
        tab.putExtra(TAB_TITLE, 1);
        try {
            startActivity(tab);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.no_browser, Toast.LENGTH_LONG).show();
        }
    }

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) {
            return readSome(in, 1 << 20);
        } catch (IOException e) {
            return "";
        }
    }

    // MARK: Cómo se ve la página

    /** Lo último que dijo la página, si su tema no era el del sistema (true = oscuro, distinto del sistema claro, o al revés). */
    private JSONObject savedLook() {
        String text = prefs.getString(LOOK, null);
        if (text == null) return null;
        try {
            JSONObject o = new JSONObject(text);
            return lookIsExplicit(o) ? o : null;
        } catch (JSONException e) {
            return null;
        }
    }

    private boolean lookIsExplicit(JSONObject o) {
        return o.optBoolean("dark") != night;
    }

    private void onPageLook(String json) {
        JSONObject o;
        try {
            o = new JSONObject(json);
        } catch (JSONException e) {
            return;
        }
        look = o;
        if (lookIsExplicit(o)) prefs.edit().putString(LOOK, json).apply();
        else prefs.edit().remove(LOOK).apply();
        applyLook();
    }

    /**
     * Tras pasar el sistema a claro u oscuro sin recrear la actividad: si la vista web no se enteró (su prefers-color-scheme
     * sigue en el de antes y la página no lo corrige), se recrea, como hacía Android solo.
     */
    private void checkPageScheme() {
        if (stage != Stage.READY || web == null) return;
        final boolean want = night;
        main.postDelayed(() -> {
            if (isDestroyed() || stage != Stage.READY || night != want) return;
            web.evaluateJavascript("[matchMedia('(prefers-color-scheme: dark)').matches, document.documentElement.classList.contains('dark')]", v -> {
                if (v == null || isDestroyed()) return;
                String s = v.replace(" ", "");
                boolean media = s.startsWith("[true");
                boolean page = s.endsWith("true]");
                if (media != want && page != want) recreate();
            });
        }, 900);
    }

    private static Bands.Edge edge(JSONObject look, String key, int fallback) {
        JSONArray a = look == null ? null : look.optJSONArray(key);
        if (a == null || a.length() < 3) return new Bands.Edge(fallback, fallback, 0);
        int main = parse(a.optString(1), fallback);
        return new Bands.Edge(parse(a.optString(0), main), main, (float) a.optDouble(2, 0));
    }

    private static int parse(String hex, int fallback) {
        if (hex == null || hex.length() != 7 || hex.charAt(0) != '#') return fallback;
        try {
            return Color.parseColor(hex);
        } catch (IllegalArgumentException e) {
            return fallback;
        }
    }

    /** ¿Un color oscuro? (para los iconos de las barras: claros encima). */
    private static boolean isDark(int c) {
        return (0.299 * Color.red(c) + 0.587 * Color.green(c) + 0.114 * Color.blue(c)) / 255 < 0.5;
    }

    /**
     * Lo que la interfaz puede pedir a la app (`window.aulaApp`), lo mismo que en el iPhone (WebView.swift): page(json)
     * cómo se ve (lo manda Shell.js), switchAula() y aulaCount(), setCanGoBack(bool) («atrás» tiene algo que hacer
     * aunque el historial no lo diga), showLicenses(), exitDemo(), demoNotice(bool), edgeToEdge(bool) (la interfaz llega
     * bajo las barras y deja sitio con --aula-safe-*) y fontScale().
     */
    private final class AppBridge {
        @JavascriptInterface
        public void page(String json) {
            main.post(() -> { if (!isDestroyed()) onPageLook(json); });
        }

        @JavascriptInterface
        public void switchAula() {
            main.post(() -> { if (!isDestroyed()) chooseAnother(); });
        }

        @JavascriptInterface
        public int aulaCount() {
            return aulaCount;
        }

        @JavascriptInterface
        public void setCanGoBack(boolean can) {
            main.post(() -> {
                if (isDestroyed()) return;
                pageCanGoBack = can;
                updateBack();
            });
        }

        @JavascriptInterface
        public void showLicenses() {
            main.post(() -> { if (!isDestroyed()) openLicenses(); });
        }

        @JavascriptInterface
        public void exitDemo() {
            main.post(() -> { if (!isDestroyed()) MainActivity.this.exitDemo(); });
        }

        @JavascriptInterface
        public void demoNotice(boolean on) {
            main.post(() -> {
                if (isDestroyed()) return;
                pageDemoNotice = inDemo && on;
                render();
                applyInsets();
            });
        }

        @JavascriptInterface
        public void edgeToEdge(boolean on) {
            main.post(() -> {
                if (isDestroyed() || edgeToEdge == on) return;
                edgeToEdge = on;
                pushedVars = "";
                applyInsets();
            });
        }

        @JavascriptInterface
        public float fontScale() {
            return MainActivity.this.fontScale();
        }
    }
}
