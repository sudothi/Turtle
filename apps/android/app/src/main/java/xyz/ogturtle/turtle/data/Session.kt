package xyz.ogturtle.turtle.data

import android.content.Context

/** Guarda o token de login no aparelho (armazenamento privado do app). */
class Session(context: Context) {
    private val prefs = context.getSharedPreferences("turtle", Context.MODE_PRIVATE)
    var token: String?
        get() = prefs.getString("token", null)
        set(value) = prefs.edit().apply { if (value == null) remove("token") else putString("token", value) }.apply()
}
