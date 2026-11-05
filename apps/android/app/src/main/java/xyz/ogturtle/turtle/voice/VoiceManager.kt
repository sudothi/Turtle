package xyz.ogturtle.turtle.voice

import android.content.Context
import io.livekit.android.LiveKit
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import io.livekit.android.room.participant.Participant
import io.livekit.android.room.track.RemoteTrackPublication
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.VideoTrack
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import xyz.ogturtle.turtle.data.Api

/** Participante presente na sala LiveKit. */
data class CallPerson(
    val id: String,
    val name: String,
    val speaking: Boolean,
    val muted: Boolean,
    val local: Boolean,
)

/** Vídeo remoto (câmera ou tela compartilhada) pronto para desenhar. */
data class VideoTile(
    val key: String,
    val participantId: String,
    val name: String,
    val screen: Boolean,
    val track: VideoTrack,
)

/** Estado completo da chamada para a interface. */
data class CallUi(
    val status: String = "idle" /* idle|connecting|connected|reconnecting */,
    val channelId: String? = null,
    val muted: Boolean = false,
    val deafened: Boolean = false,
    val people: List<CallPerson> = emptyList(),
    val videos: List<VideoTile> = emptyList(),
    val error: String? = null,
)

/**
 * Gerencia a chamada de voz no LiveKit (uma por vez) e recalcula o estado da UI a cada evento da sala.
 */
class VoiceManager(
    private val context: Context,
    private val api: Api,
    private val scope: CoroutineScope,
    private val onReport: (channelId: String?, muted: Boolean, deafened: Boolean) -> Unit,
) {
    private val _ui = MutableStateFlow(CallUi())
    val ui: StateFlow<CallUi> = _ui.asStateFlow()

    var room: Room? = null
        private set

    private var connectJob: Job? = null
    private var eventsJob: Job? = null
    /** Guarda se o microfone já estava mudo antes de ativar o ensurdecer. */
    private var mutedBeforeDeafen: Boolean = false

    fun join(channelId: String) {
        val cur = _ui.value
        if (cur.channelId == channelId && cur.status != "idle") return
        if (room != null || cur.status != "idle") {
            disconnectCurrent()
        }

        val muted = _ui.value.muted
        val deafened = _ui.value.deafened
        _ui.value = CallUi(
            status = "connecting",
            channelId = channelId,
            muted = muted,
            deafened = deafened,
        )

        val newRoom = LiveKit.create(context.applicationContext)
        room = newRoom
        eventsJob = scope.launch {
            newRoom.events.collect { event ->
                if (room !== newRoom) return@collect
                when (event) {
                    is RoomEvent.Reconnecting -> _ui.update { it.copy(status = "reconnecting") }
                    is RoomEvent.Reconnected -> {
                        _ui.update { it.copy(status = "connected") }
                        applyDeafenToRemote(newRoom, _ui.value.deafened)
                        reportAgain()
                    }
                    is RoomEvent.Disconnected -> {
                        if (room === newRoom) {
                            cleanupRoom()
                            CallService.stop(context)
                            onReport(null, false, false)
                            _ui.value = CallUi()
                        }
                        return@collect
                    }
                    is RoomEvent.ParticipantConnected,
                    is RoomEvent.TrackPublished,
                    is RoomEvent.TrackSubscribed,
                    -> {
                        if (_ui.value.deafened) applyDeafenToRemote(newRoom, true)
                    }
                    else -> {}
                }
                rebuildSnapshot(newRoom)
            }
        }

        connectJob = scope.launch {
            try {
                val tk = api.voiceToken(channelId)
                newRoom.connect(tk.url, tk.token)
                if (room !== newRoom) return@launch

                val shouldMute = _ui.value.muted || _ui.value.deafened
                runCatching {
                    newRoom.localParticipant.setMicrophoneEnabled(!shouldMute)
                }
                if (_ui.value.deafened) {
                    applyDeafenToRemote(newRoom, true)
                }

                CallService.start(context)
                _ui.update { it.copy(status = "connected", error = null) }
                rebuildSnapshot(newRoom)
                val st = _ui.value
                onReport(channelId, st.muted, st.deafened)
            } catch (e: CancellationException) {
                throw e
            } catch (e: Throwable) {
                if (room === newRoom) {
                    cleanupRoom()
                    CallService.stop(context)
                    onReport(null, false, false)
                    val msg = e.message ?: "erro desconhecido"
                    _ui.value = CallUi(error = "Não foi possível entrar na chamada: $msg")
                }
            }
        }
    }

    fun leave() {
        disconnectCurrent()
        CallService.stop(context)
        onReport(null, false, false)
        _ui.value = CallUi()
    }

    fun toggleMute() {
        val st = _ui.value
        // Ligar o microfone sem áudio não faz sentido: volta o áudio também (como no desktop).
        if (st.deafened && st.muted) {
            mutedBeforeDeafen = false
            toggleDeafen()
            return
        }
        val nextMuted = !st.muted
        _ui.update { it.copy(muted = nextMuted) }
        val r = room
        if (r != null && st.status != "idle") {
            scope.launch {
                runCatching { r.localParticipant.setMicrophoneEnabled(!nextMuted) }
                rebuildSnapshot(r)
            }
            onReport(st.channelId, nextMuted, st.deafened)
        }
    }

    fun toggleDeafen() {
        val st = _ui.value
        val nextDeafened = !st.deafened
        val nextMuted = if (nextDeafened) {
            mutedBeforeDeafen = st.muted
            true
        } else {
            mutedBeforeDeafen
        }
        _ui.update { it.copy(muted = nextMuted, deafened = nextDeafened) }
        val r = room
        if (r != null && st.status != "idle") {
            applyDeafenToRemote(r, nextDeafened)
            scope.launch {
                runCatching { r.localParticipant.setMicrophoneEnabled(!nextMuted) }
                rebuildSnapshot(r)
            }
            onReport(st.channelId, nextMuted, nextDeafened)
        }
    }

    fun reportAgain() {
        val st = _ui.value
        if (st.channelId != null && st.status != "idle") {
            onReport(st.channelId, st.muted, st.deafened)
        }
    }

    fun clearError() {
        _ui.update { it.copy(error = null) }
    }

    /** Inscreve ou desinscreve todo o áudio remoto conforme o estado de ensurdecer. */
    private fun applyDeafenToRemote(r: Room, deafened: Boolean) {
        for (p in r.remoteParticipants.values) {
            for ((pub, _) in p.audioTrackPublications) {
                (pub as? RemoteTrackPublication)?.setSubscribed(!deafened)
            }
        }
    }

    /** Recalcula a lista de participantes e vídeos a partir do estado atual da sala. */
    private fun rebuildSnapshot(r: Room) {
        if (room !== r) return
        val people = mutableListOf<CallPerson>()
        val videos = mutableListOf<VideoTile>()

        val lp = r.localParticipant
        val localId = lp.identity?.value ?: "local"
        val localName = lp.name?.takeIf { it.isNotBlank() } ?: localId
        people += CallPerson(
            id = localId,
            name = localName,
            speaking = lp.isSpeaking,
            muted = _ui.value.muted || !lp.isMicrophoneEnabled,
            local = true,
        )

        for (rp in r.remoteParticipants.values) {
            val pid = rp.identity?.value ?: continue
            val pname = rp.name?.takeIf { it.isNotBlank() } ?: pid
            people += CallPerson(
                id = pid,
                name = pname,
                speaking = rp.isSpeaking,
                muted = !rp.isMicrophoneEnabled,
                local = false,
            )
            for ((pub, track) in rp.videoTrackPublications) {
                val videoTrack = track as? VideoTrack ?: continue
                if (pub.muted) continue
                val isScreen = pub.source == Track.Source.SCREEN_SHARE
                val isCamera = pub.source == Track.Source.CAMERA
                if (!isScreen && !isCamera) continue
                val suffix = if (isScreen) "screen" else "camera"
                videos += VideoTile(
                    key = "$pid:$suffix:${pub.sid}",
                    participantId = pid,
                    name = pname,
                    screen = isScreen,
                    track = videoTrack,
                )
            }
        }

        _ui.update { it.copy(people = people, videos = videos) }
    }

    private fun disconnectCurrent() {
        connectJob?.cancel()
        connectJob = null
        cleanupRoom()
    }

    private fun cleanupRoom() {
        eventsJob?.cancel()
        eventsJob = null
        val r = room
        room = null
        if (r != null) {
            runCatching { r.disconnect() }
            runCatching { r.release() }
        }
    }
}
