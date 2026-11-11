package xyz.ogturtle.turtle

import java.net.URI
import java.net.URLDecoder

/** Servidor e/ou código de convite vindos de um link. */
data class ServerLink(val server: String?, val code: String?)

/** Aceita "app.exemplo.com" ou "https://app.exemplo.com/"; só HTTPS (ou http em localhost/emulador). */
fun normalizeServerUrl(text: String): String? {
    var t = text.trim().trimEnd('/')
    if (t.isEmpty()) return null
    if (!t.contains("://")) t = "https://$t"
    val uri = runCatching { URI(t) }.getOrNull() ?: return null
    val host = uri.host ?: return null
    val local = host == "localhost" || host == "10.0.2.2" || host == "127.0.0.1"
    if (uri.scheme != "https" && !(uri.scheme == "http" && local)) return null
    if (!local && !host.contains('.')) return null
    return "${uri.scheme}://$host" + (if (uri.port > 0) ":${uri.port}" else "")
}

/**
 * Entende `turtle://convite?server=https://app.exemplo.com&code=abc` e
 * `https://app.exemplo.com/convite/abc` (o link que o administrador compartilha).
 */
fun parseServerLink(link: String): ServerLink? {
    val uri = runCatching { URI(link.trim()) }.getOrNull() ?: return null
    fun q(name: String) = uri.rawQuery?.split('&')?.firstNotNullOfOrNull {
        val (k, v) = (it.split('=', limit = 2) + "").take(2)
        if (k == name) URLDecoder.decode(v, "UTF-8") else null
    }
    return when (uri.scheme) {
        "turtle" -> {
            val server = q("server")?.let(::normalizeServerUrl)
            val code = q("code")?.trim()?.takeIf { it.isNotEmpty() }
            if (server == null && code == null) null else ServerLink(server, code)
        }
        "https" -> {
            val m = Regex("^/convite/([^/]+)/?$").find(uri.rawPath ?: "") ?: return null
            ServerLink(normalizeServerUrl("https://${uri.host}" + (if (uri.port > 0) ":${uri.port}" else "")), URLDecoder.decode(m.groupValues[1], "UTF-8"))
        }
        else -> null
    }
}
