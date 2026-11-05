package xyz.ogturtle.turtle.ui

import android.Manifest
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Headset
import androidx.compose.material.icons.filled.HeadsetOff
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.VideocamOff
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import io.livekit.android.renderer.TextureViewRenderer
import io.livekit.android.room.track.VideoTrack
import livekit.org.webrtc.RendererCommon
import xyz.ogturtle.turtle.AppViewModel
import xyz.ogturtle.turtle.UiState
import xyz.ogturtle.turtle.data.CallStatus
import xyz.ogturtle.turtle.data.Channel
import xyz.ogturtle.turtle.data.ParticipantUi
import xyz.ogturtle.turtle.data.VoiceState
import xyz.ogturtle.turtle.ui.theme.Ink

/** Nome e foto de quem está na chamada, vindos do servidor (voiceStates) ou, se faltar, dos membros. */
private data class WhoIs(val name: String, val avatar: String?)

private fun whoIs(state: UiState, vm: AppViewModel, userId: String): WhoIs {
    state.voiceStates.firstOrNull { it.userId == userId }?.let { return WhoIs(it.shown, vm.api.fileUrl(it.avatar)) }
    if (userId == state.user?.id) state.user?.let { return WhoIs(it.displayName?.takeIf { n -> n.isNotBlank() } ?: it.username, vm.api.fileUrl(it.avatar)) }
    state.members.values.flatten().firstOrNull { it.userId == userId }?.let { return WhoIs(it.shown, vm.api.fileUrl(it.avatar)) }
    return WhoIs("Alguém", null)
}

/** Tela de um canal de voz: antes de entrar mostra quem está lá; dentro, a grade da chamada e os botões. */
@Composable
fun VoiceScreen(state: UiState, vm: AppViewModel, channel: Channel) {
    val call = state.call
    val here = state.voiceStates.filter { it.channelId == channel.id }

    // Permissões: microfone para entrar (e aviso de notificação no Android 13+), câmera ao ligar o vídeo.
    val joinPermissions = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { granted ->
        if (granted[Manifest.permission.RECORD_AUDIO] == true) vm.joinCall(channel.id)
    }
    val cameraPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { ok ->
        if (ok) vm.toggleCamera()
    }
    val context = androidx.compose.ui.platform.LocalContext.current
    fun hasMic() = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == android.content.pm.PackageManager.PERMISSION_GRANTED
    fun join() {
        if (hasMic()) vm.joinCall(channel.id)
        else joinPermissions.launch(
            if (Build.VERSION.SDK_INT >= 33) arrayOf(Manifest.permission.RECORD_AUDIO, Manifest.permission.POST_NOTIFICATIONS)
            else arrayOf(Manifest.permission.RECORD_AUDIO),
        )
    }

    if (call?.channelId == channel.id) {
        InCall(state, vm, call) {
            if (call.cameraOn || ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == android.content.pm.PackageManager.PERMISSION_GRANTED) vm.toggleCamera()
            else cameraPermission.launch(Manifest.permission.CAMERA)
        }
    } else {
        Lobby(state, vm, channel, here, inOtherCall = call != null, onJoin = ::join)
    }
}

@Composable
private fun Lobby(state: UiState, vm: AppViewModel, channel: Channel, here: List<VoiceState>, inOtherCall: Boolean, onJoin: () -> Unit) {
    Column(Modifier.fillMaxSize().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Text(channel.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.ExtraBold)
        Spacer(Modifier.height(4.dp))
        Text(if (here.isEmpty()) "Ninguém na chamada" else "${here.size} na chamada", color = Ink.Muted)
        Spacer(Modifier.height(20.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            here.take(6).forEach { Avatar(it.shown, vm.api.fileUrl(it.avatar), size = 48.dp) }
        }
        if (here.any { it.screen }) {
            Spacer(Modifier.height(12.dp))
            Text("AO VIVO: ${here.filter { it.screen }.joinToString { it.shown }}", color = Ink.Paper, fontWeight = FontWeight.Bold)
        }
        Spacer(Modifier.height(28.dp))
        Button(onClick = onJoin, colors = ButtonDefaults.buttonColors(containerColor = Ink.Paper, contentColor = Ink.Ink0)) {
            Text(if (inOtherCall) "Trocar para esta chamada" else "Entrar na chamada", fontWeight = FontWeight.Bold)
        }
        if (state.call?.status == CallStatus.Connecting) {
            Spacer(Modifier.height(12.dp))
            Text("Conectando…", color = Ink.Muted)
        }
    }
}

@Composable
private fun InCall(state: UiState, vm: AppViewModel, call: xyz.ogturtle.turtle.data.CallUi, onCamera: () -> Unit) {
    Column(Modifier.fillMaxSize()) {
        if (call.status != CallStatus.Connected) {
            Text(
                if (call.status == CallStatus.Reconnecting) "Reconectando…" else "Conectando…",
                color = Ink.Ink0, fontWeight = FontWeight.Bold,
                modifier = Modifier.fillMaxWidth().background(Ink.Paper).padding(8.dp),
            )
        }
        LazyVerticalGrid(
            columns = GridCells.Fixed(2),
            modifier = Modifier.weight(1f).fillMaxWidth(),
            contentPadding = PaddingValues(12.dp),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp),
        ) {
            // Telas compartilhadas primeiro, ocupando a largura toda.
            items(call.participants.filter { it.screenAvailable }, key = { "screen-" + it.identity }, span = { GridItemSpan(2) }) { p ->
                ScreenTile(state, vm, p)
            }
            items(call.participants, key = { it.identity }) { p -> PersonTile(state, vm, p) }
        }
        ControlBar(call, vm, onCamera)
    }
}

@Composable
private fun PersonTile(state: UiState, vm: AppViewModel, p: ParticipantUi) {
    val who = whoIs(state, vm, p.identity)
    val shape = RoundedCornerShape(12.dp)
    Box(
        Modifier.fillMaxWidth().aspectRatio(4f / 3f).clip(shape).background(Ink.Ink1)
            .border(if (p.speaking) 3.dp else 1.dp, if (p.speaking) Ink.Paper else Ink.Line, shape),
        contentAlignment = Alignment.Center,
    ) {
        if (p.camera != null) VideoView(p.camera, vm, Modifier.fillMaxSize(), fill = true, mirror = p.isLocal)
        else Avatar(who.name, who.avatar, size = 64.dp)
        Row(
            Modifier.align(Alignment.BottomStart).padding(6.dp).clip(RoundedCornerShape(6.dp)).background(Color(0xB3000000)).padding(horizontal = 6.dp, vertical = 3.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (!p.micOn) {
                Icon(Icons.Filled.MicOff, contentDescription = "Mudo", tint = Ink.Paper, modifier = Modifier.size(14.dp))
                Spacer(Modifier.size(4.dp))
            }
            Text(if (p.isLocal) "${who.name} (você)" else who.name, style = MaterialTheme.typography.labelMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
    }
}

@Composable
private fun ScreenTile(state: UiState, vm: AppViewModel, p: ParticipantUi) {
    val who = whoIs(state, vm, p.identity)
    val shape = RoundedCornerShape(12.dp)
    Column(Modifier.fillMaxWidth().clip(shape).background(Ink.Ink0).border(1.dp, Ink.Paper, shape)) {
        Box(Modifier.fillMaxWidth().aspectRatio(16f / 9f), contentAlignment = Alignment.Center) {
            if (p.screen != null) {
                VideoView(p.screen, vm, Modifier.fillMaxSize(), fill = false, mirror = false)
            } else {
                Button(
                    onClick = { vm.voice.watchScreen(p.identity, true) },
                    colors = ButtonDefaults.buttonColors(containerColor = Ink.Paper, contentColor = Ink.Ink0),
                ) {
                    Icon(Icons.Filled.Visibility, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(Modifier.size(8.dp))
                    Text("Assistir", fontWeight = FontWeight.Bold)
                }
            }
        }
        Row(Modifier.fillMaxWidth().padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("AO VIVO · ${who.name}", style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f), maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (p.screen != null) {
                OutlinedButton(onClick = { vm.voice.watchScreen(p.identity, false) }, border = BorderStroke(1.dp, Ink.Line), contentPadding = PaddingValues(horizontal = 12.dp, vertical = 0.dp)) {
                    Text("Parar", color = Ink.Paper)
                }
            }
        }
    }
}

@Composable
private fun ControlBar(call: xyz.ogturtle.turtle.data.CallUi, vm: AppViewModel, onCamera: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().background(Ink.Ink1).navigationBarsPadding().padding(vertical = 12.dp),
        horizontalArrangement = Arrangement.SpaceEvenly,
    ) {
        RoundButton(if (call.muted) Icons.Filled.MicOff else Icons.Filled.Mic, if (call.muted) "Ligar microfone" else "Silenciar", active = !call.muted, onClick = vm::toggleMute)
        RoundButton(if (call.deafened) Icons.Filled.HeadsetOff else Icons.Filled.Headset, if (call.deafened) "Ouvir" else "Ensurdecer", active = !call.deafened, onClick = vm::toggleDeafen)
        RoundButton(if (call.cameraOn) Icons.Filled.Videocam else Icons.Filled.VideocamOff, if (call.cameraOn) "Desligar câmera" else "Ligar câmera", active = call.cameraOn, onClick = onCamera)
        RoundButton(Icons.Filled.CallEnd, "Sair da chamada", active = true, danger = true, onClick = vm::leaveCall)
    }
}

@Composable
private fun RoundButton(icon: ImageVector, description: String, active: Boolean, danger: Boolean = false, onClick: () -> Unit) {
    val bg = when {
        danger -> Ink.Danger
        active -> Ink.Paper
        else -> Ink.Ink4
    }
    Box(
        Modifier.size(56.dp).clip(CircleShape).background(bg).border(1.dp, Ink.Line, CircleShape).clickable(onClick = onClick),
        contentAlignment = Alignment.Center,
    ) {
        Icon(icon, contentDescription = description, tint = if (danger) Ink.Paper else if (active) Ink.Ink0 else Ink.Paper, modifier = Modifier.size(26.dp))
    }
}

/** Mostra um vídeo do LiveKit. `fill` corta para encher o quadro (câmera); sem ele cabe inteiro (tela). */
@Composable
fun VideoView(track: VideoTrack, vm: AppViewModel, modifier: Modifier, fill: Boolean, mirror: Boolean) {
    var renderer by remember { mutableStateOf<TextureViewRenderer?>(null) }
    AndroidView(
        modifier = modifier,
        factory = { ctx ->
            TextureViewRenderer(ctx).also {
                vm.voice.initRenderer(it)
                it.setScalingType(if (fill) RendererCommon.ScalingType.SCALE_ASPECT_FILL else RendererCommon.ScalingType.SCALE_ASPECT_FIT)
                it.setMirror(mirror)
                renderer = it
            }
        },
    )
    DisposableEffect(track, renderer) {
        val r = renderer
        if (r != null) track.addRenderer(r)
        onDispose { if (r != null) track.removeRenderer(r) }
    }
    DisposableEffect(renderer) {
        val r = renderer
        onDispose { r?.release() }
    }
}
