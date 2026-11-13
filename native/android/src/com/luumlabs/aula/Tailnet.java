// El componente de Tailscale dentro de la app (native/tsnet/client): un proceso aparte que se une a la red privada del
// estudiante como «aula-android», encuentra sus Aulas y abre un túnel local (127.0.0.1) hasta la que se le pida. Habla por
// su entrada y su salida, una línea JSON por orden y por aviso. Vive mientras vive la app (si la actividad se recrea al
// girar o al cambiar a modo oscuro, sigue el mismo proceso); si se cae solo, se vuelve a arrancar con más espera cada vez.
package com.luumlabs.aula;

import android.content.Context;
import android.os.Handler;
import android.os.Looper;
import android.util.Log;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

final class Tailnet {
    interface Listener {
        void onEvent(JSONObject event);
    }

    private static final String TAG = "AulaTailnet";
    private static Tailnet instance;

    static synchronized Tailnet get(Context context) {
        if (instance == null) instance = new Tailnet(context.getApplicationContext());
        return instance;
    }

    private final Context context;
    private final Handler main = new Handler(Looper.getMainLooper());
    private Process process;
    private OutputStream stdin;
    private Listener listener;
    private boolean wanted;
    private int restarts;
    /** El último aviso de cada clase: quien empieza a escuchar (una actividad recreada) sabe al momento dónde está. */
    private JSONObject lastState;
    private JSONObject lastForwarding;

    private Tailnet(Context context) {
        this.context = context;
    }

    /** Quién escucha los avisos (la actividad de ahora). Recibe enseguida el último estado y el último túnel. */
    void listen(Listener l) {
        listener = l;
        if (l == null) return;
        if (lastState != null) l.onEvent(lastState);
        if (lastForwarding != null) l.onEvent(lastForwarding);
    }

    boolean running() {
        return process != null && process.isAlive();
    }

    /** Arranca el proceso si no está en marcha. */
    synchronized void start() {
        wanted = true;
        if (running()) return;
        File binary = new File(context.getApplicationInfo().nativeLibraryDir, "libaulatsnet.so");
        File state = new File(context.getFilesDir(), "tailnet");
        //noinspection ResultOfMethodCallIgnored
        state.mkdirs();
        ProcessBuilder pb = new ProcessBuilder(binary.getAbsolutePath(), "--state-dir", state.getAbsolutePath(), "--hostname", "aula-android");
        pb.environment().put("HOME", state.getAbsolutePath());
        pb.environment().put("TMPDIR", context.getCacheDir().getAbsolutePath());
        try {
            Process p = pb.start();
            process = p;
            stdin = p.getOutputStream();
            lastForwarding = null;
            Thread out = new Thread(() -> readEvents(p), "aula-tailnet-events");
            out.setDaemon(true);
            out.start();
            Thread err = new Thread(() -> readLog(p), "aula-tailnet-log");
            err.setDaemon(true);
            err.start();
        } catch (IOException e) {
            Log.w(TAG, "no arrancó", e);
            deliver(event("error", "message", e.getMessage()));
            retryLater();
        }
    }

    /** Para el proceso (al salir de la app): con la entrada cerrada termina limpio; si no, se le mata. */
    synchronized void stop() {
        wanted = false;
        Process p = process;
        process = null;
        if (p == null) return;
        try { stdin.close(); } catch (IOException ignored) { }
        main.postDelayed(() -> { if (p.isAlive()) p.destroy(); }, 3000);
    }

    void connect(String host) {
        send("{\"cmd\":\"connect\",\"host\":" + JSONObject.quote(host) + "}");
    }

    void refresh() {
        send("{\"cmd\":\"refresh\"}");
    }

    void logout() {
        lastForwarding = null;
        send("{\"cmd\":\"logout\"}");
    }

    private synchronized void send(String line) {
        if (!running()) return;
        try {
            stdin.write((line + "\n").getBytes(StandardCharsets.UTF_8));
            stdin.flush();
        } catch (IOException e) {
            Log.w(TAG, "orden perdida", e);
        }
    }

    private void readEvents(Process p) {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) {
                try {
                    JSONObject e = new JSONObject(line);
                    String type = e.optString("type");
                    if ("forwarding".equals(type)) lastForwarding = e;
                    else if (!"error".equals(type) && !"stopped".equals(type)) lastState = e;
                    if ("running".equals(type)) restarts = 0;
                    deliver(e);
                } catch (JSONException ignored) {
                    // una línea a medias
                }
            }
        } catch (IOException ignored) {
            // el proceso se cerró
        }
        int code;
        try { code = p.waitFor(); } catch (InterruptedException e) { code = -1; }
        Log.i(TAG, "terminó con el código " + code);
        synchronized (this) {
            if (process == p) process = null;
        }
        if (wanted) retryLater();
    }

    private void readLog(Process p) {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getErrorStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) Log.i(TAG, line.length() > 400 ? line.substring(0, 400) : line);
        } catch (IOException ignored) {
            // cerrado
        }
    }

    private void retryLater() {
        restarts++;
        long wait = Math.min(60_000, 2000L << Math.min(restarts, 5));
        main.postDelayed(() -> { if (wanted) start(); }, wait);
    }

    private void deliver(JSONObject e) {
        main.post(() -> { if (listener != null) listener.onEvent(e); });
    }

    private static JSONObject event(String type, String key, String value) {
        JSONObject e = new JSONObject();
        try {
            e.put("type", type);
            if (key != null) e.put(key, value == null ? "" : value);
        } catch (JSONException ignored) { }
        return e;
    }
}
