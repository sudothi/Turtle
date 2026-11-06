package xyz.ogturtle.turtle

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.media.Ringtone
import android.media.RingtoneManager
import android.os.Build
import androidx.core.app.NotificationCompat
import xyz.ogturtle.turtle.data.ServerEvent

/**
 * Toque de chamada recebida (DM e grupo) com o app em memória: toca o toque do aparelho em loop e mostra uma
 * notificação de chamada com tela cheia (`fullScreenIntent`). Com o app fechado depende de push (issue #98).
 */
object Ringer {
    private const val CHANNEL = "ring"
    private val active = mutableMapOf<String, Int>()
    private var ringtone: Ringtone? = null

    private fun id(channelId: String) = 1000 + (channelId.hashCode() and 0xFFFF)

    fun ring(app: Application, r: ServerEvent.Ring) {
        val nm = app.getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            val ch = NotificationChannel(CHANNEL, "Chamadas recebidas", NotificationManager.IMPORTANCE_HIGH)
            ch.setSound(null, null) // o som é o toque em loop abaixo
            nm.createNotificationChannel(ch)
        }
        val open = PendingIntent.getActivity(
            app, 0, Intent(app, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val n = NotificationCompat.Builder(app, CHANNEL)
            .setSmallIcon(R.mipmap.ic_launcher)
            .setContentTitle("${r.fromName} está te ligando")
            .setContentText("Chamada de voz no Turtle")
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setTimeoutAfter(30_000)
            .setAutoCancel(true)
            .setContentIntent(open)
            .apply { if (!r.silent) setFullScreenIntent(open, true) }
            .build()
        runCatching { nm.notify(id(r.channelId), n) } // sem permissão de notificação: só o cartão dentro do app
        active[r.channelId] = id(r.channelId)
        if (!r.silent && ringtone == null) {
            ringtone = runCatching {
                RingtoneManager.getRingtone(app, RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE))?.also {
                    if (Build.VERSION.SDK_INT >= 28) it.isLooping = true
                    it.play()
                }
            }.getOrNull()
        }
    }

    fun stop(app: Context, channelId: String) {
        active.remove(channelId)?.let { app.getSystemService(NotificationManager::class.java).cancel(it) }
        if (active.isEmpty()) {
            runCatching { ringtone?.stop() }
            ringtone = null
        }
    }
}
