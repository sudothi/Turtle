package xyz.ogturtle.turtle.data

import android.content.Context

/** Mesmas opções de Configurações > Notificações do web/desktop (`apps/client/src/sounds.ts`). */
data class SoundPrefs(
    val enabled: Boolean = true,
    val volume: Float = 0.6f,
    val callPresence: Boolean = true,
    val messages: Boolean = true,
    val messageVolume: Float = 1f,
)

/**
 * Preferências de som e servidores/canais silenciados, salvas só neste aparelho.
 * Silenciado não toca som, mas continua contando como não lido (igual ao web).
 */
class SoundStore(context: Context) {
    private val prefs = context.getSharedPreferences("turtle-sons", Context.MODE_PRIVATE)

    fun load() = SoundPrefs(
        enabled = prefs.getBoolean("enabled", true),
        volume = prefs.getFloat("volume", 0.6f),
        callPresence = prefs.getBoolean("callPresence", true),
        messages = prefs.getBoolean("messages", true),
        messageVolume = prefs.getFloat("messageVolume", 1f),
    )

    fun save(p: SoundPrefs) = prefs.edit()
        .putBoolean("enabled", p.enabled)
        .putFloat("volume", p.volume)
        .putBoolean("callPresence", p.callPresence)
        .putBoolean("messages", p.messages)
        .putFloat("messageVolume", p.messageVolume)
        .apply()

    fun mutedServers(): Set<String> = prefs.getStringSet("mutedServers", emptySet()).orEmpty().toSet()
    fun mutedChannels(): Set<String> = prefs.getStringSet("mutedChannels", emptySet()).orEmpty().toSet()
    fun saveMuted(servers: Set<String>, channels: Set<String>) =
        prefs.edit().putStringSet("mutedServers", servers).putStringSet("mutedChannels", channels).apply()
}
