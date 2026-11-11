package xyz.ogturtle.turtle.data

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import kotlin.concurrent.thread
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.pow
import kotlin.math.sin
import kotlin.random.Random

enum class CallSound { Join, Leave, UserJoin, UserLeave, Mute, Unmute, Deafen, Undeafen, Message, DmMessage }

private val PRESENCE = setOf(CallSound.Join, CallSound.Leave, CallSound.UserJoin, CallSound.UserLeave)
private val MESSAGES = setOf(CallSound.Message, CallSound.DmMessage)
private const val MESSAGE_COOLDOWN_MS = 800L

/**
 * Sons do app (chamada, mudo/ensurdecer e mensagens), sintetizados na hora (sem arquivos), iguais aos do web/desktop
 * (`apps/client/src/sounds.ts`): bolhas (seno com o tom deslizando) e ondas (ruído filtrado).
 */
object CallSounds {
    private const val RATE = 44_100
    private val cache = mutableMapOf<CallSound, ShortArray>()
    private val lastMessage = mutableMapOf<CallSound, Long>()

    /** Preferências atuais (ligado pelo AppViewModel; sem ele vale o padrão). */
    @Volatile var prefs: () -> SoundPrefs = { SoundPrefs() }

    /** [force]: botão "ouvir" das configurações (ignora o interruptor do tipo e o cooldown). */
    fun play(sound: CallSound, force: Boolean = false) {
        val p = prefs()
        if (!p.enabled || p.volume <= 0f) return
        val isMessage = sound in MESSAGES
        if (!force) {
            if (sound in PRESENCE && !p.callPresence) return
            if (isMessage) {
                if (!p.messages || p.messageVolume <= 0f) return
                val now = System.currentTimeMillis()
                synchronized(lastMessage) {
                    if (now - (lastMessage[sound] ?: 0L) < MESSAGE_COOLDOWN_MS) return
                    lastMessage[sound] = now
                }
            }
        }
        val gain = p.volume * (if (isMessage) p.messageVolume else 1f) * 0.5f
        val raw = synchronized(cache) { cache.getOrPut(sound) { render(sound) } }
        val pcm = ShortArray(raw.size) { i -> (raw[i] * gain * 2).toInt().coerceIn(-32768, 32767).toShort() }
        thread(isDaemon = true, name = "turtle-call-sound") {
            runCatching {
                val track = AudioTrack.Builder()
                    .setAudioAttributes(
                        // Mesmo caminho do áudio da chamada (fone, caixa ou Bluetooth).
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build(),
                    )
                    .setAudioFormat(
                        AudioFormat.Builder()
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setSampleRate(RATE)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                            .build(),
                    )
                    .setTransferMode(AudioTrack.MODE_STATIC)
                    .setBufferSizeInBytes(pcm.size * 2)
                    .build()
                try {
                    track.write(pcm, 0, pcm.size)
                    track.play()
                    Thread.sleep(pcm.size * 1000L / RATE + 100)
                } finally {
                    track.release()
                }
            }
        }
    }

    private fun render(sound: CallSound): ShortArray {
        val out = FloatArray((RATE * 0.75).toInt())
        // Mesmas curvas do web (`playSound` em sounds.ts).
        when (sound) {
            CallSound.Join -> {
                wave(out, 0.0, 260.0, 1500.0, 0.4, 0.35)
                bubble(out, 0.22, 440.0, 880.0, 0.12, 0.5)
                bubble(out, 0.34, 660.0, 1320.0, 0.14, 0.45)
            }
            CallSound.Leave -> {
                wave(out, 0.0, 1500.0, 260.0, 0.4, 0.3)
                bubble(out, 0.05, 880.0, 440.0, 0.13, 0.45)
                bubble(out, 0.18, 660.0, 300.0, 0.16, 0.45)
            }
            CallSound.UserJoin -> {
                bubble(out, 0.0, 900.0, 1500.0, 0.07, 0.4)
                bubble(out, 0.08, 1200.0, 2000.0, 0.08, 0.35)
            }
            CallSound.UserLeave -> {
                bubble(out, 0.0, 2000.0, 1200.0, 0.08, 0.35)
                bubble(out, 0.08, 1500.0, 900.0, 0.09, 0.4)
            }
            CallSound.Mute -> bubble(out, 0.0, 820.0, 360.0, 0.15, 0.5)
            CallSound.Unmute -> bubble(out, 0.0, 360.0, 820.0, 0.15, 0.5)
            CallSound.Deafen -> {
                bubble(out, 0.0, 760.0, 420.0, 0.11, 0.45)
                bubble(out, 0.1, 560.0, 260.0, 0.13, 0.45)
            }
            CallSound.Undeafen -> {
                bubble(out, 0.0, 260.0, 560.0, 0.11, 0.45)
                bubble(out, 0.1, 420.0, 760.0, 0.13, 0.45)
            }
            CallSound.Message -> {
                bubble(out, 0.0, 520.0, 1300.0, 0.11, 0.55)
                bubble(out, 0.09, 900.0, 1700.0, 0.07, 0.25)
            }
            CallSound.DmMessage -> {
                bubble(out, 0.0, 380.0, 760.0, 0.13, 0.6)
                bubble(out, 0.12, 560.0, 1100.0, 0.16, 0.5)
            }
        }
        // Sem volume aqui: o ganho entra em `play`, para o volume das configurações valer na hora.
        return ShortArray(out.size) { i -> (out[i].coerceIn(-2f, 2f) * Short.MAX_VALUE / 2).toInt().toShort() }
    }

    /** Rampa exponencial de `a` até `b` (como `exponentialRampToValueAtTime` do Web Audio). */
    private fun expRamp(a: Double, b: Double, x: Double) = a * (b / a).pow(x.coerceIn(0.0, 1.0))

    private fun bubble(out: FloatArray, at: Double, from: Double, to: Double, dur: Double, level: Double) {
        val start = (at * RATE).toInt()
        val n = (dur * RATE).toInt()
        val attack = 0.012
        var phase = 0.0
        for (i in 0 until n) {
            val idx = start + i
            if (idx >= out.size) break
            val t = i.toDouble() / RATE
            phase += 2 * PI * expRamp(from, to, t / dur) / RATE
            val g = if (t < attack) expRamp(0.0001, level, t / attack) else expRamp(level, 0.0001, (t - attack) / (dur - attack))
            out[idx] += (sin(phase) * g).toFloat()
        }
    }

    private fun wave(out: FloatArray, at: Double, from: Double, to: Double, dur: Double, level: Double) {
        val start = (at * RATE).toInt()
        val n = (dur * RATE).toInt()
        val peak = dur * 0.45
        val q = 0.9
        val rnd = Random(7)
        var x1 = 0.0; var x2 = 0.0; var y1 = 0.0; var y2 = 0.0
        for (i in 0 until n) {
            val idx = start + i
            if (idx >= out.size) break
            val t = i.toDouble() / RATE
            // Passa-banda (RBJ) com a frequência central varrendo de `from` a `to`.
            val w = 2 * PI * expRamp(from, to, t / dur) / RATE
            val alpha = sin(w) / (2 * q)
            val a0 = 1 + alpha
            val b0 = alpha / a0
            val b2 = -alpha / a0
            val a1 = -2 * cos(w) / a0
            val a2 = (1 - alpha) / a0
            val x = rnd.nextDouble() * 2 - 1
            val y = b0 * x + b2 * x2 - a1 * y1 - a2 * y2
            x2 = x1; x1 = x; y2 = y1; y1 = y
            val g = if (t < peak) expRamp(0.0001, level, t / peak) else expRamp(level, 0.0001, (t - peak) / (dur - peak))
            out[idx] += (y * g).toFloat()
        }
    }
}
