package xyz.ogturtle.turtle.data

import android.content.Context
import io.livekit.android.ConnectOptions
import io.livekit.android.LiveKit
import io.livekit.android.events.RoomEvent
import io.livekit.android.renderer.TextureViewRenderer
import io.livekit.android.room.Room
import io.livekit.android.room.participant.Participant
import io.livekit.android.room.track.RemoteAudioTrack
import io.livekit.android.room.track.RemoteTrackPublication
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.VideoTrack
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class CallStatus { Connecting, Connected, Reconnecting }

/** Uma pessoa na chamada, já pronta para a tela. `identity` é o id do usuário no Turtle. */
data class ParticipantUi(
    val identity: String,
    val isLocal: Boolean,
    val speaking: Boolean,
    val micOn: Boolean,
    /** Vídeo da câmera (null = câmera desligada). */
    val camera: VideoTrack?,
    /** A pessoa está compartilhando a tela (mas talvez eu ainda não esteja assistindo). */
    val screenAvailable: Boolean,
    /** Vídeo da tela, só depois de tocar em "Assistir". */
    val screen: VideoTrack?,
    /** Volume que eu escolhi para esta pessoa (1 = 100%, até 2 = 200%). */
    val volume: Float = 1f,
)

data class CallUi(
    val channelId: String,
    val status: CallStatus = CallStatus.Connecting,
    val muted: Boolean = false,
    val deafened: Boolean = false,
    val cameraOn: Boolean = false,
    val participants: List<ParticipantUi> = emptyList(),
)

/**
 * Chamada de voz/vídeo pelo LiveKit. Entra sem assinar nada automaticamente: áudio e câmera são
 * assinados na hora; a tela compartilhada só quando a pessoa toca em "Assistir" (como no desktop).
 */
class VoiceController(private val app: Context, private val scope: CoroutineScope) {
    /** Volume por pessoa (id do usuário), salvo no aparelho como no web. */
    private val volumePrefs = app.getSharedPreferences("turtle-volume", Context.MODE_PRIVATE)

    fun volumeOf(identity: String): Float = volumePrefs.getFloat(identity, 1f)

    /** Muda o volume de uma pessoa (0 a 2). O ganho do WebRTC aceita valores acima de 1. */
    fun setVolume(identity: String, volume: Float) {
        val v = volume.coerceIn(0f, 2f)
        volumePrefs.edit().apply { if (v == 1f) remove(identity) else putFloat(identity, v) }.apply()
        refresh()
    }

    private val _call = MutableStateFlow<CallUi?>(null)
    val call: StateFlow<CallUi?> = _call.asStateFlow()

    private var room: Room? = null
    private var events: Job? = null
    private var mutedBeforeDeafen = false
    /** Entrou de fato na sala (para tocar o som de saída só de quem estava dentro). */
    private var joined = false
    /** Até quando ignorar entradas e saídas dos outros (ao reconectar o LiveKit reanuncia todo mundo). */
    private var presenceQuietUntil = 0L
    private var lastPresenceSound = 0L

    /** Liga um renderizador de vídeo à sala atual (necessário antes de mostrar vídeo). */
    fun initRenderer(renderer: TextureViewRenderer) {
        room?.initVideoRenderer(renderer)
    }

    suspend fun join(channelId: String, url: String, token: String) {
        leave()
        val r = LiveKit.create(app)
        room = r
        mutedBeforeDeafen = false
        _call.value = CallUi(channelId)
        events = scope.launch { r.events.events.collect { onEvent(r, it) } }
        try {
            r.connect(url, token, ConnectOptions(autoSubscribe = false))
            r.localParticipant.setMicrophoneEnabled(true)
            r.remoteParticipants.values.forEach(::subscribeDefaults)
            joined = true
            presenceQuietUntil = System.currentTimeMillis() + 1500
            CallSounds.play(CallSound.Join)
            refresh()
        } catch (e: Exception) {
            leave()
            throw e
        }
    }

    fun leave() {
        events?.cancel()
        events = null
        room?.let {
            runCatching { it.disconnect() }
            runCatching { it.release() }
        }
        room = null
        _call.value = null
        if (joined) CallSounds.play(CallSound.Leave)
        joined = false
    }

    private fun onEvent(r: Room, e: RoomEvent) {
        if (room !== r) return
        when (e) {
            is RoomEvent.Disconnected -> leave()
            is RoomEvent.ParticipantConnected -> { subscribeDefaults(e.participant); presenceSound(r, CallSound.UserJoin); refresh() }
            is RoomEvent.ParticipantDisconnected -> { presenceSound(r, CallSound.UserLeave); refresh() }
            is RoomEvent.Reconnected -> { presenceQuietUntil = System.currentTimeMillis() + 2000; refresh() }
            is RoomEvent.TrackPublished -> { (e.participant as? io.livekit.android.room.participant.RemoteParticipant)?.let(::subscribeDefaults); refresh() }
            else -> refresh()
        }
    }

    /** Alguém entrou ou saiu: só com a chamada estável, sem ensurdecer, e um som por rajada. */
    private fun presenceSound(r: Room, sound: CallSound) {
        val now = System.currentTimeMillis()
        if (!joined || r.state != Room.State.CONNECTED || _call.value?.deafened == true) return
        if (now < presenceQuietUntil || now - lastPresenceSound < 300) return
        lastPresenceSound = now
        CallSounds.play(sound)
    }

    /** Assina áudio e câmera de quem entrou; tela compartilhada fica para o "Assistir". */
    private fun subscribeDefaults(p: io.livekit.android.room.participant.RemoteParticipant) {
        val deaf = _call.value?.deafened == true
        for (pub in p.trackPublications.values) {
            val remote = pub as? RemoteTrackPublication ?: continue
            when (remote.source) {
                Track.Source.MICROPHONE -> remote.setSubscribed(!deaf)
                Track.Source.CAMERA -> remote.setSubscribed(true)
                else -> {}
            }
        }
    }

    private fun refresh() {
        val r = room ?: return
        val cur = _call.value ?: return
        fun ui(p: Participant, local: Boolean): ParticipantUi {
            val cam = p.getTrackPublication(Track.Source.CAMERA)
            val mic = p.getTrackPublication(Track.Source.MICROPHONE)
            val scr = p.getTrackPublication(Track.Source.SCREEN_SHARE)
            return ParticipantUi(
                identity = p.identity?.value.orEmpty(),
                isLocal = local,
                speaking = p.isSpeaking,
                micOn = mic != null && !mic.muted,
                camera = if (cam != null && !cam.muted) cam.track as? VideoTrack else null,
                screenAvailable = !local && scr != null,
                screen = if (local) null else scr?.track as? VideoTrack,
                volume = if (local) 1f else volumeOf(p.identity?.value.orEmpty()),
            )
        }
        val status = when (r.state) {
            Room.State.CONNECTED -> CallStatus.Connected
            Room.State.RECONNECTING -> CallStatus.Reconnecting
            else -> CallStatus.Connecting
        }
        // Aplica o volume de cada pessoa (também vale para áudio assinado depois de entrar).
        for (p in r.remoteParticipants.values) {
            val track = p.getTrackPublication(Track.Source.MICROPHONE)?.track as? RemoteAudioTrack ?: continue
            runCatching { track.setVolume(volumeOf(p.identity?.value.orEmpty()).toDouble()) }
        }
        _call.value = cur.copy(
            status = status,
            participants = listOf(ui(r.localParticipant, true)) + r.remoteParticipants.values.map { ui(it, false) },
        )
    }

    fun setMuted(muted: Boolean) {
        val r = room ?: return
        val cur = _call.value ?: return
        // Ligar o microfone sem áudio não faz sentido: volta o áudio também (como no desktop).
        if (cur.deafened && !muted) {
            mutedBeforeDeafen = false
            setDeafened(false)
            return
        }
        _call.value = cur.copy(muted = muted)
        scope.launch { runCatching { r.localParticipant.setMicrophoneEnabled(!muted) }; refresh() }
    }

    fun setDeafened(deafened: Boolean) {
        val r = room ?: return
        val cur = _call.value ?: return
        if (deafened) mutedBeforeDeafen = cur.muted
        val muted = if (deafened) true else mutedBeforeDeafen
        _call.value = cur.copy(deafened = deafened, muted = muted)
        for (p in r.remoteParticipants.values) {
            (p.getTrackPublication(Track.Source.MICROPHONE) as? RemoteTrackPublication)?.setSubscribed(!deafened)
        }
        scope.launch { runCatching { r.localParticipant.setMicrophoneEnabled(!muted) }; refresh() }
    }

    /** Liga ou desliga a câmera. Devolve false se não foi possível (ex.: sem permissão). */
    fun setCamera(on: Boolean, onResult: (Boolean) -> Unit = {}) {
        val r = room ?: return
        scope.launch {
            val ok = runCatching { r.localParticipant.setCameraEnabled(on) }.getOrDefault(false)
            _call.value = _call.value?.copy(cameraOn = if (ok) on else _call.value?.cameraOn ?: false)
            refresh()
            onResult(ok)
        }
    }

    /** Começa ou para de assistir à tela de alguém (identity = id do usuário). */
    fun watchScreen(identity: String, watch: Boolean) {
        val p = room?.remoteParticipants?.values?.firstOrNull { it.identity?.value == identity } ?: return
        for (src in listOf(Track.Source.SCREEN_SHARE, Track.Source.SCREEN_SHARE_AUDIO)) {
            (p.getTrackPublication(src) as? RemoteTrackPublication)?.setSubscribed(watch)
        }
        refresh()
    }
}
