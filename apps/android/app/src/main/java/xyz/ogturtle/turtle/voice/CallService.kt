package xyz.ogturtle.turtle.voice

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import xyz.ogturtle.turtle.MainActivity

/**
 * Serviço em primeiro plano que mantém o microfone e a conexão de voz ativos quando o app vai para segundo plano.
 */
class CallService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (intent?.action == ACTION_HANG_UP) {
            onHangUp?.invoke()
            stopSelf()
            return START_NOT_STICKY
        }

        ensureChannel()

        val openIntent = Intent(this, MainActivity::class.java).apply {
            this.flags = Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP
        }
        val openPending = PendingIntent.getActivity(
            this,
            0,
            openIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val hangUpIntent = Intent(this, CallService::class.java).apply {
            action = ACTION_HANG_UP
        }
        val hangUpPending = PendingIntent.getService(
            this,
            1,
            hangUpIntent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setSmallIcon(android.R.drawable.ic_btn_speak_now)
            .setContentTitle("Turtle")
            .setContentText("Em chamada no Turtle")
            .setContentIntent(openPending)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .addAction(0, "Sair", hangUpPending)
            .build()

        val fgType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        } else {
            0
        }
        ServiceCompat.startForeground(this, NOTIFICATION_ID, notification, fgType)
        return START_NOT_STICKY
    }

    private fun ensureChannel() {
        val nm = getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL_ID) == null) {
            val ch = NotificationChannel(
                CHANNEL_ID,
                "Chamadas",
                NotificationManager.IMPORTANCE_LOW,
            ).apply {
                description = "Chamada de voz em andamento"
            }
            nm.createNotificationChannel(ch)
        }
    }

    companion object {
        private const val CHANNEL_ID = "chamada"
        private const val NOTIFICATION_ID = 1001
        private const val ACTION_HANG_UP = "xyz.ogturtle.turtle.voice.HANG_UP"

        /** Chamado quando a pessoa toca na ação "Sair" da notificação. */
        var onHangUp: (() -> Unit)? = null

        fun start(context: Context) {
            val intent = Intent(context.applicationContext, CallService::class.java)
            runCatching {
                ContextCompat.startForegroundService(context.applicationContext, intent)
            }
        }

        fun stop(context: Context) {
            val intent = Intent(context.applicationContext, CallService::class.java)
            runCatching {
                context.applicationContext.stopService(intent)
            }
        }
    }
}
