package xyz.ogturtle.turtle.data

import android.content.Context

/** Guarda o token de login no aparelho (armazenamento privado do app). */
class Session(context: Context, private val defaultServer: String) {
    private val prefs = context.getSharedPreferences("turtle", Context.MODE_PRIVATE)
    /** Servidor escolhido pela pessoa (link de convite ou campo na entrada); sem escolha usa o do build. */
    var serverUrl: String
        get() = prefs.getString("server", null) ?: defaultServer
        set(value) = prefs.edit().apply { if (value == defaultServer) remove("server") else putString("server", value) }.apply()
    var token: String?
        get() = prefs.getString("token", null)
        set(value) = prefs.edit().apply { if (value == null) remove("token") else putString("token", value) }.apply()
}
