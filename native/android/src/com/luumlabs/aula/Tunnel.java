// Las reglas del túnel local (127.0.0.1:<puerto>) que no dependen de Android, para comprobarlas en la JVM al compilar
// (tools/TunnelTest.java): qué se abre dentro de la app y qué hacer según conteste el túnel.
package com.luumlabs.aula;

import java.util.Locale;

final class Tunnel {
    private Tunnel() { }

    /** Dónde se abre una dirección que la vista web quiere visitar. */
    enum Open { INSIDE, OUTSIDE, NOWHERE }

    /** Qué hacer tras preguntar al túnel por /health. */
    enum Probe {
        /** Responde Aula: se enseña. */
        AULA,
        /** El túnel es nuestro, pero la Aula no contesta (el Mac duerme): se vuelve a preguntar por el mismo túnel. */
        WAIT,
        /** En ese puerto ya no está nuestro túnel (nadie escucha, o no acepta la llave): hace falta uno nuevo. */
        NEW_TUNNEL
    }

    /**
     * Solo la Aula del túnel que se enseña (http, 127.0.0.1 y su puerto) se abre dentro: la vista web guarda las cookies
     * de 127.0.0.1 (la llave del túnel y la del dispositivo), y las cookies no distinguen puertos, así que cualquier otro
     * puerto de 127.0.0.1 (otra app del teléfono) las recibiría. Lo de fuera que es web va al navegador, y solo desde el
     * marco principal; lo demás, a ninguna parte.
     */
    static Open open(String scheme, String host, int port, boolean mainFrame, int tunnelPort) {
        String s = scheme == null ? "" : scheme.toLowerCase(Locale.ROOT);
        if ("about".equals(s)) return Open.INSIDE; // about:blank, al dejar un túnel o al cerrar sesión
        if (isTunnel(s, host, port, tunnelPort)) return Open.INSIDE;
        if (mainFrame && ("http".equals(s) || "https".equals(s) || "mailto".equals(s))) return Open.OUTSIDE;
        return Open.NOWHERE;
    }

    /** ¿Es una dirección del túnel de `tunnelPort` (http, 127.0.0.1 y ese puerto)? */
    static boolean isTunnel(String scheme, String host, int port, int tunnelPort) {
        return tunnelPort > 0 && port == tunnelPort && "http".equalsIgnoreCase(scheme) && "127.0.0.1".equals(host);
    }

    /**
     * Lo que dice la respuesta a /health. `refused`: nadie escucha en el puerto (el proceso que lo abría ya no lo tiene);
     * `status`: el código HTTP (-1 si no llegó ninguno: se agotó el tiempo); `app`: el campo «app» de la respuesta.
     * Un 403 es la puerta de un túnel que no reconoce la llave: no es el nuestro.
     */
    static Probe probe(boolean refused, int status, String app) {
        if (refused || status == 403) return Probe.NEW_TUNNEL;
        if (status == 200 && "aula".equals(app)) return Probe.AULA;
        return Probe.WAIT;
    }
}
