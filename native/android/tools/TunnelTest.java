// Comprueba en la JVM las reglas de Tunnel.java (build.sh lo ejecuta antes de empaquetar; un fallo para la compilación).
package com.luumlabs.aula;

public final class TunnelTest {
    private static int failures;

    private static void check(boolean ok, String what) {
        if (!ok) {
            failures++;
            System.err.println("FALLA: " + what);
        }
    }

    public static void main(String[] args) {
        // dentro, solo el túnel que se enseña
        check(Tunnel.open("http", "127.0.0.1", 41234, true, 41234) == Tunnel.Open.INSIDE, "el túnel se abre dentro");
        check(Tunnel.open("HTTP", "127.0.0.1", 41234, true, 41234) == Tunnel.Open.INSIDE, "el esquema no distingue mayúsculas");
        check(Tunnel.open("about", null, -1, true, 41234) == Tunnel.Open.INSIDE, "about:blank se abre dentro");
        // otro puerto de 127.0.0.1 (otra app) nunca dentro: fuera, donde el navegador no tiene las cookies de la app
        check(Tunnel.open("http", "127.0.0.1", 9999, true, 41234) == Tunnel.Open.OUTSIDE, "otro puerto de 127.0.0.1 no se abre dentro");
        check(Tunnel.open("http", "127.0.0.1", -1, true, 41234) == Tunnel.Open.OUTSIDE, "127.0.0.1 sin puerto (80) no se abre dentro");
        check(Tunnel.open("https", "127.0.0.1", 41234, true, 41234) == Tunnel.Open.OUTSIDE, "https al puerto del túnel no es el túnel");
        check(Tunnel.open("http", "localhost", 41234, true, 41234) == Tunnel.Open.OUTSIDE, "localhost no es el túnel");
        // sin túnel enseñado, nada de 127.0.0.1 se abre dentro
        check(Tunnel.open("http", "127.0.0.1", 41234, true, 0) == Tunnel.Open.OUTSIDE, "sin túnel, nada de 127.0.0.1 dentro");
        // la web y el correo, al navegador; desde un marco interior, a ninguna parte
        check(Tunnel.open("https", "example.com", -1, true, 41234) == Tunnel.Open.OUTSIDE, "https de fuera al navegador");
        check(Tunnel.open("mailto", null, -1, true, 41234) == Tunnel.Open.OUTSIDE, "mailto al navegador");
        check(Tunnel.open("https", "example.com", -1, false, 41234) == Tunnel.Open.NOWHERE, "un marco interior no abre el navegador");
        check(Tunnel.open("http", "127.0.0.1", 9999, false, 41234) == Tunnel.Open.NOWHERE, "un marco interior a otro puerto, a ninguna parte");
        check(Tunnel.open("intent", null, -1, true, 41234) == Tunnel.Open.NOWHERE, "intent: a ninguna parte");
        check(Tunnel.open("javascript", null, -1, true, 41234) == Tunnel.Open.NOWHERE, "javascript: a ninguna parte");
        check(Tunnel.open(null, null, -1, true, 41234) == Tunnel.Open.NOWHERE, "sin esquema, a ninguna parte");

        // la interfaz que se enseña (para el historial y los errores de carga): solo su puerto
        check(Tunnel.isTunnel("http", "127.0.0.1", 41234, 41234), "la interfaz enseñada es del túnel");
        check(!Tunnel.isTunnel("http", "127.0.0.1", 41235, 41234), "otro puerto no es del túnel");
        check(!Tunnel.isTunnel("http", "127.0.0.1", 41234, 0), "sin túnel enseñado, nada lo es");
        check(!Tunnel.isTunnel("about", null, -1, 41234), "about:blank no es del túnel");

        // lo que dice /health
        check(Tunnel.probe(false, 200, "aula") == Tunnel.Probe.AULA, "200 de Aula: se enseña");
        check(Tunnel.probe(false, 502, null) == Tunnel.Probe.WAIT, "502 del túnel (la Aula no contesta): se espera");
        check(Tunnel.probe(false, -1, null) == Tunnel.Probe.WAIT, "sin respuesta a tiempo: se espera");
        check(Tunnel.probe(false, 200, "otra") == Tunnel.Probe.WAIT, "200 de otra cosa por el túnel: se espera");
        check(Tunnel.probe(true, -1, null) == Tunnel.Probe.NEW_TUNNEL, "nadie escucha en el puerto: túnel nuevo");
        check(Tunnel.probe(false, 403, null) == Tunnel.Probe.NEW_TUNNEL, "la puerta no acepta la llave: túnel nuevo");

        if (failures > 0) {
            System.err.println(failures + " comprobaciones fallaron");
            System.exit(1);
        }
        System.out.println("Tunnel: comprobaciones en orden");
    }
}
