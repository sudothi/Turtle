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
    val screenVolume: Float = 1f,
    val watchingScreen: Boolean = false,
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
private val NO_RETRY = setOf("CLIENT_INITIATED", "DUPLICATE_IDENTITY", "PARTICIPANT_REMOVED", "ROOM_DELETED", "ROOM_CLOSED")

class VoiceController(private val app: Context, private val scope: CoroutineScope) {
    /** Volume por pessoa (id do usuário), salvo no aparelho como no web. */
    private val volumePrefs = app.getSharedPreferences("turtle-volume", Context.MODE_PRIVATE)
    private val screenVolumePrefs = app.getSharedPreferences("turtle-screen-volume", Context.MODE_PRIVATE)
    private val audio = VoiceAudioState()
    private val requestedSubscriptions = mutableMapOf<String, Boolean>()

    fun volumeOf(identity: String): Float = volumePrefs.getFloat(identity, 1f)
    fun screenVolumeOf(identity: String): Float = screenVolumePrefs.getFloat(identity, 1f)

    /** Muda o volume de uma pessoa (0 a 2). O ganho do WebRTC aceita valores acima de 1. */
    fun setVolume(identity: String, volume: Float) {
        val v = volume.coerceIn(0f, 2f)
        volumePrefs.edit().apply { if (v == 1f) remove(identity) else putFloat(identity, v) }.apply()
        refresh()
    }

    fun setScreenVolume(identity: String, volume: Float) {
        val v = volume.coerceIn(0f, 2f)
        screenVolumePrefs.edit().apply { if (v == 1f) remove(identity) else putFloat(identity, v) }.apply()
        refresh()
    }

    private val _call = MutableStateFlow<CallUi?>(null)
    val call: StateFlow<CallUi?> = _call.asStateFlow()

    private var room: Room? = null
    private var events: Job? = null
    /** Entrou de fato na sala (para tocar o som de saída só de quem estava dentro). */
    private var joined = false
    /** Até quando ignorar entradas e saídas dos outros (ao reconectar o LiveKit reanuncia todo mundo). */
    private var presenceQuietUntil = 0L
    private var lastPresenceSound = 0L

    /** A chamada caiu: recebe o canal e as escolhas de áudio que a recuperação deve preservar. */
    var onDropped: ((String, Boolean, Boolean) -> Unit)? = null

    /** Liga um renderizador de vídeo à sala atual (necessário antes de mostrar vídeo). */
    fun initRenderer(renderer: TextureViewRenderer) {
        room?.initVideoRenderer(renderer)
    }

    suspend fun join(channelId: String, url: String, token: String, muted: Boolean = false, deafened: Boolean = false) {
        leave()
        audio.reset(muted, deafened)
        val r = LiveKit.create(app)
        room = r
        _call.value = CallUi(channelId, muted = audio.muted, deafened = audio.deafened)
        events = scope.launch { r.events.events.collect { onEvent(r, it) } }
        try {
            r.connect(url, token, ConnectOptions(autoSubscribe = false))
            if (room !== r) return
            val microphone = !audio.muted
            r.localParticipant.setMicrophoneEnabled(microphone)
            if (room !== r || microphone && audio.muted) r.localParticipant.setMicrophoneEnabled(false)
            if (room !== r) return
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
            for (p in it.remoteParticipants.values) for (pub in p.trackPublications.values) {
                (pub.track as? RemoteAudioTrack)?.let { track -> runCatching { track.setVolume(0.0) } }
            }
            runCatching { it.disconnect() }
            runCatching { it.release() }
        }
        room = null
        _call.value = null
        audio.reset()
        requestedSubscriptions.clear()
        if (joined) CallSounds.play(CallSound.Leave)
        joined = false
    }

    private fun onEvent(r: Room, e: RoomEvent) {
        if (room !== r) return
        when (e) {
            is RoomEvent.Disconnected -> {
                val channelId = _call.value?.channelId
                val muted = audio.muted
                val deafened = audio.deafened
                // Igual ao NO_RETRY do web (apps/client/src/voice/client.ts): sair, ser removido ou entrar em outro lugar não volta.
                val retry = joined && channelId != null && e.reason?.name !in NO_RETRY
                leave()
                if (retry) onDropped?.invoke(channelId!!, muted, deafened)
            }
            is RoomEvent.ParticipantConnected -> { subscribeDefaults(e.participant); presenceSound(r, CallSound.UserJoin); refresh() }
            is RoomEvent.ParticipantDisconnected -> { presenceSound(r, CallSound.UserLeave); refresh() }
            is RoomEvent.Reconnected -> { presenceQuietUntil = System.currentTimeMillis() + 2000; requestedSubscriptions.clear(); refresh() }
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
        for (pub in p.trackPublications.values) {
            val remote = pub as? RemoteTrackPublication ?: continue
            when (remote.source) {
                Track.Source.MICROPHONE -> subscribe(remote, !audio.deafened)
                Track.Source.CAMERA -> subscribe(remote, true)
                else -> {}
            }
        }
    }

    private fun subscribe(publication: RemoteTrackPublication, subscribed: Boolean) {
        if (requestedSubscriptions[publication.sid] == subscribed) return
        requestedSubscriptions[publication.sid] = subscribed
        publication.setSubscribed(subscribed)
    }

    private fun syncAudio(r: Room) {
        val screens = r.remoteParticipants.values.mapNotNull { p ->
            val identity = p.identity?.value ?: return@mapNotNull null
            val screen = p.getTrackPublication(Track.Source.SCREEN_SHARE)?.takeUnless { it.muted } ?: return@mapNotNull null
            identity to screen.sid
        }.toMap()
        audio.reconcileScreens(screens)
        val publications = r.remoteParticipants.values.flatMap { it.trackPublications.values }.map { it.sid }.toSet()
        requestedSubscriptions.keys.retainAll(publications)
        for (p in r.remoteParticipants.values) {
            val identity = p.identity?.value.orEmpty()
            val screen = screens[identity]
            for (pub in p.trackPublications.values) {
                val remote = pub as? RemoteTrackPublication ?: continue
                val watching = audio.isWatching(identity, screen)
                val level = when (pub.source) {
                    Track.Source.MICROPHONE -> audio.voiceVolume(volumeOf(identity))
                    Track.Source.SCREEN_SHARE_AUDIO -> audio.screenVolume(identity, screen, screenVolumeOf(identity))
                    else -> null
                }
                if (level != null) (pub.track as? RemoteAudioTrack)?.let { track -> runCatching { track.setVolume(level) } }
                when (pub.source) {
                    Track.Source.MICROPHONE -> subscribe(remote, !audio.deafened)
                    Track.Source.CAMERA -> subscribe(remote, true)
                    Track.Source.SCREEN_SHARE -> subscribe(remote, watching)
                    Track.Source.SCREEN_SHARE_AUDIO -> subscribe(remote, watching && (level ?: 0.0) > 0.0)
                    else -> {}
                }
            }
        }
    }

    private fun refresh() {
        val r = room ?: return
        val cur = _call.value ?: return
        syncAudio(r)
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
                screenAvailable = !local && scr != null && !scr.muted,
                screen = if (local || !audio.isWatching(p.identity?.value.orEmpty(), scr?.sid)) null else scr?.track as? VideoTrack,
                volume = if (local) 1f else volumeOf(p.identity?.value.orEmpty()),
                screenVolume = if (local) 1f else screenVolumeOf(p.identity?.value.orEmpty()),
                watchingScreen = !local && audio.isWatching(p.identity?.value.orEmpty(), scr?.sid),
            )
        }
        val status = when (r.state) {
            Room.State.CONNECTED -> CallStatus.Connected
            Room.State.RECONNECTING -> CallStatus.Reconnecting
            else -> CallStatus.Connecting
        }
        _call.value = cur.copy(
            muted = audio.muted, deafened = audio.deafened,
            status = status,
            participants = listOf(ui(r.localParticipant, true)) + r.remoteParticipants.values.map { ui(it, false) },
        )
    }

    fun setMuted(muted: Boolean) {
        val r = room ?: return
        val cur = _call.value ?: return
        audio.muteMicrophone(muted)
        if (cur.deafened && !audio.deafened) CallSounds.play(CallSound.Undeafen)
        else if (muted != cur.muted) CallSounds.play(if (muted) CallSound.Mute else CallSound.Unmute)
        updateCapture(r)
    }

    fun setDeafened(deafened: Boolean) {
        val r = room ?: return
        val cur = _call.value ?: return
        audio.silenceConversation(deafened)
        if (deafened != cur.deafened) CallSounds.play(if (deafened) CallSound.Deafen else CallSound.Undeafen)
        updateCapture(r)
    }

    private fun updateCapture(r: Room) {
        refresh()
        scope.launch {
            if (room !== r) return@launch
            val microphone = !audio.muted
            runCatching {
                r.localParticipant.setMicrophoneEnabled(microphone)
                if (microphone && room === r && audio.muted) r.localParticipant.setMicrophoneEnabled(false)
            }
            if (room === r) refresh()
        }
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
        val screen = p.getTrackPublication(Track.Source.SCREEN_SHARE)?.takeUnless { it.muted }
        audio.watchScreen(identity, screen?.sid, watch)
        refresh()
    }
}
