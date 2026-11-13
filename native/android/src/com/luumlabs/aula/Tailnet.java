// El componente de Tailscale dentro de la app (native/tsnet/client): un proceso aparte que se une a la red privada del
// estudiante como «aula-android», encuentra sus Aulas y abre un túnel local (127.0.0.1) hasta la que se le pida. Habla por
// su entrada y su salida, una línea JSON por orden y por aviso. Vive mientras vive la app (si la actividad se recrea al
// girar o al cambiar a modo oscuro, sigue el mismo proceso); si se cae solo, avisa con {"type":"exited"} (su túnel se fue
// con él) y se vuelve a arrancar con más espera cada vez.
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
    private volatile Process process;
    private OutputStream stdin;
    private Listener listener;
    private volatile boolean wanted;
    private int restarts;
    /** El último estado del proceso de ahora: quien empieza a escuchar (una actividad recreada) sabe al momento dónde está. */
    private volatile JSONObject lastState;
    /** El túnel abierto por el proceso de ahora (solo vale mientras ese proceso vive). */
    private volatile JSONObject lastForwarding;

    private Tailnet(Context context) {
        this.context = context;
    }

    /** Quién escucha los avisos (la actividad de ahora). Al empezar a escuchar recibe enseguida el último estado. */
    void listen(Listener l) {
        if (l == listener) return;
        listener = l;
        if (l != null && lastState != null) l.onEvent(lastState);
    }

    /**
     * Deja de escuchar, si quien escucha sigue siendo `l`. Devuelve si lo era: una actividad que se cierra tarde (su
     * onDestroy llega después de que otra ya escuche) no le quita los avisos a la nueva.
     */
    boolean unlisten(Listener l) {
        if (listener != l) return false;
        listener = null;
        return true;
    }

    boolean running() {
        Process p = process;
        return p != null && p.isAlive();
    }

    /** El túnel que el proceso de ahora tiene abierto hasta `host`, si lo hay (una actividad recreada sigue con él). */
    JSONObject forwardingTo(String host) {
        JSONObject f = lastForwarding;
        return f != null && host != null && host.equals(f.optString("host")) ? f : null;
    }

    /** Arranca el proceso si no está en marcha. */
    synchronized void start() {
        wanted = true;
        if (running()) return;
        File binary = new File(context.getApplicationInfo().nativeLibraryDir, "libaulatsnet.so");
        File state = stateDir();
        //noinspection ResultOfMethodCallIgnored
        state.mkdirs();
        ProcessBuilder pb = new ProcessBuilder(binary.getAbsolutePath(), "--state-dir", state.getAbsolutePath(), "--hostname", "aula-android");
        pb.environment().put("HOME", state.getAbsolutePath());
        pb.environment().put("TMPDIR", context.getCacheDir().getAbsolutePath());
        lastState = null;
        lastForwarding = null;
        try {
            Process p = pb.start();
            process = p;
            stdin = p.getOutputStream();
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

    /**
     * Donde el nodo guarda su identidad (su clave privada de Tailscale): en no_backup, que Android nunca copia ni a la
     * nube ni a otro teléfono (la clave no debe acabar en otro dispositivo, como en el iPhone). Las compilaciones de
     * prueba anteriores la guardaban en files/: se mueve, para no tener que iniciar sesión otra vez.
     */
    private File stateDir() {
        File state = new File(context.getNoBackupFilesDir(), "tailnet");
        File old = new File(context.getFilesDir(), "tailnet");
        if (old.isDirectory() && !state.exists() && !old.renameTo(state)) Log.w(TAG, "no se pudo mover " + old);
        return state;
    }

    /** Para el proceso (al salir de la app): con la entrada cerrada termina limpio; si no, se le mata. */
    synchronized void stop() {
        wanted = false;
        Process p = process;
        process = null;
        lastState = null;
        lastForwarding = null;
        if (p == null) return;
        try { stdin.close(); } catch (IOException ignored) { }
        main.postDelayed(() -> { if (p.isAlive()) p.destroy(); }, 3000);
    }

    /** Pide un túnel hasta `host`. Devuelve si la orden llegó al proceso (no, si no está en marcha). */
    boolean connect(String host) {
        return send("{\"cmd\":\"connect\",\"host\":" + JSONObject.quote(host) + "}");
    }

    void refresh() {
        send("{\"cmd\":\"refresh\"}");
    }

    void logout() {
        lastForwarding = null;
        send("{\"cmd\":\"logout\"}");
    }

    private synchronized boolean send(String line) {
        if (!running()) return false;
        try {
            stdin.write((line + "\n").getBytes(StandardCharsets.UTF_8));
            stdin.flush();
            return true;
        } catch (IOException e) {
            Log.w(TAG, "orden perdida", e);
            return false;
        }
    }

    private void readEvents(Process p) {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) {
                // lo que aún diga un proceso que ya se paró (stop) no es de ahora
                if (process != p) continue;
                try {
                    JSONObject e = new JSONObject(line);
                    String type = e.optString("type");
                    if ("forwarding".equals(type)) lastForwarding = e;
                    else if (!"error".equals(type) && !"stopped".equals(type)) lastState = e;
                    if ("running".equals(type)) synchronized (this) { restarts = 0; }
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
        boolean current;
        synchronized (this) {
            current = process == p;
            if (current) {
                process = null;
                lastState = null;
                lastForwarding = null;
            }
        }
        // si se cayó solo (no lo paró stop), su túnel ya no existe: se avisa y se vuelve a arrancar
        if (!current) return;
        deliver(event("exited", null, null));
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

    private synchronized void retryLater() {
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
