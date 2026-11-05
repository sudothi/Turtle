package xyz.ogturtle.turtle.ui

import android.Manifest
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CallEnd
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.GraphicEq
import androidx.compose.material.icons.filled.Headset
import androidx.compose.material.icons.filled.HeadsetOff
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import io.livekit.android.renderer.TextureViewRenderer
import io.livekit.android.room.Room
import io.livekit.android.room.track.VideoTrack
import livekit.org.webrtc.RendererCommon
import xyz.ogturtle.turtle.AppViewModel
import xyz.ogturtle.turtle.UiState
import xyz.ogturtle.turtle.data.shownName
import xyz.ogturtle.turtle.ui.theme.Ink
import xyz.ogturtle.turtle.voice.CallUi
import xyz.ogturtle.turtle.voice.VideoTile

/** Tela de um canal de voz (ou chamada de conversa): prévia com quem já está lá, ou a chamada ativa. */
@Composable
fun VoiceScreen(
    state: UiState,
    call: CallUi,
    vm: AppViewModel,
    channelId: String,
    title: String,
    onProfile: (String) -> Unit,
) {
    val context = LocalContext.current
    val inThisCall = call.channelId == channelId && call.status != "idle"
    var permError by remember(channelId) { mutableStateOf<String?>(null) }
    var fullVideoKey by remember(channelId) { mutableStateOf<String?>(null) }
    // O LiveKit só sabe o nome de usuário; o nome de exibição e a foto vêm da lista de quem está na voz.
    val known = state.voiceStates.associateBy { it.userId }

    val permissionLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { result ->
        val micGranted = result[Manifest.permission.RECORD_AUDIO] == true ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        if (micGranted) {
            permError = null
            vm.joinVoice(channelId)
        } else {
            permError = "Sem permissão do microfone, não dá para falar."
        }
    }

    fun requestJoin() {
        val hasMic = ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        val needsNotif = Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
        if (hasMic && !needsNotif) {
            permError = null
            vm.joinVoice(channelId)
        } else {
            val perms = buildList {
                add(Manifest.permission.RECORD_AUDIO)
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) add(Manifest.permission.POST_NOTIFICATIONS)
            }.toTypedArray()
            permissionLauncher.launch(perms)
        }
    }

    Box(Modifier.fillMaxSize().background(Ink.Ink0)) {
        Column(Modifier.fillMaxSize()) {
            // Faixa de erro da chamada no topo (toque para fechar).
            call.error?.let { msg ->
                Text(
                    msg,
                    color = Ink.Ink0,
                    style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.fillMaxWidth().background(Ink.Paper).clickable { vm.voice.clearError() }
                        .padding(horizontal = 16.dp, vertical = 10.dp),
                )
            }

            if (!inThisCall) {
                // Fora desta chamada: quem está na sala e o botão para entrar.
                val present = state.voiceStates.filter { it.channelId == channelId }
                Column(Modifier.weight(1f).fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp)) {
                    Text(title, style = MaterialTheme.typography.titleLarge, color = Ink.Paper)
                    Spacer(Modifier.height(16.dp))
                    if (present.isEmpty()) {
                        Box(Modifier.weight(1f).fillMaxWidth(), contentAlignment = Alignment.Center) {
                            Text("Ninguém na chamada ainda", style = MaterialTheme.typography.bodyLarge, color = Ink.Muted)
                        }
                    } else {
                        LazyColumn(Modifier.weight(1f).fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            items(present, key = { it.userId }) { vs ->
                                Row(
                                    Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).background(Ink.Ink2)
                                        .clickable { onProfile(vs.userId) }.padding(horizontal = 12.dp, vertical = 10.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Avatar(vs.shown, vm.api.fileUrl(vs.avatar), size = 44.dp)
                                    Spacer(Modifier.width(12.dp))
                                    Text(vs.shown, style = MaterialTheme.typography.titleMedium, color = Ink.Paper, maxLines = 1,
                                        overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f))
                                    if (vs.deafened) {
                                        Icon(Icons.Filled.HeadsetOff, contentDescription = "Sem áudio", tint = Ink.Muted, modifier = Modifier.size(18.dp))
                                    } else if (vs.muted) {
                                        Icon(Icons.Filled.MicOff, contentDescription = "Microfone mudo", tint = Ink.Muted, modifier = Modifier.size(18.dp))
                                    }
                                }
                            }
                        }
                    }
                    permError?.let { Text(it, color = Ink.PaperDim, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.padding(bottom = 12.dp)) }
                    Button(
                        onClick = { requestJoin() },
                        colors = ButtonDefaults.buttonColors(containerColor = Ink.Paper, contentColor = Ink.Ink0),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier.fillMaxWidth().height(52.dp),
                    ) {
                        Text(if (call.channelId != null) "Trocar para esta chamada" else "Entrar na chamada", style = MaterialTheme.typography.labelLarge, color = Ink.Ink0)
                    }
                }
            } else {
                // Dentro desta chamada: status, vídeos, grade de participantes e controles.
                val statusText = when (call.status) {
                    "connecting" -> "Conectando…"
                    "reconnecting" -> "Reconectando…"
                    else -> if (call.people.size == 1) "Na chamada · só você" else "Na chamada · ${call.people.size} pessoas"
                }
                Column(Modifier.weight(1f).fillMaxWidth()) {
                    Column(Modifier.padding(horizontal = 20.dp, vertical = 12.dp)) {
                        Text(title, style = MaterialTheme.typography.titleLarge, color = Ink.Paper)
                        Spacer(Modifier.height(4.dp))
                        Text(statusText, style = MaterialTheme.typography.bodyMedium, color = Ink.Muted)
                    }
                    // Faixa de vídeos (câmeras e telas compartilhadas dos outros).
                    if (call.videos.isNotEmpty()) {
                        LazyRow(contentPadding = PaddingValues(horizontal = 20.dp, vertical = 8.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            items(call.videos, key = { it.key }) { tile ->
                                VideoTileItem(tile, known[tile.participantId]?.shown ?: tile.name, vm.voice.room) { fullVideoKey = tile.key }
                            }
                        }
                    }
                    // Grade de participantes (3 colunas); anel branco em quem está falando.
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(3),
                        modifier = Modifier.weight(1f).fillMaxWidth(),
                        contentPadding = PaddingValues(horizontal = 16.dp, vertical = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(12.dp),
                        verticalArrangement = Arrangement.spacedBy(16.dp),
                    ) {
                        items(call.people.size, key = { call.people[it].id }) { i ->
                            val person = call.people[i]
                            val info = known[person.id]
                            val name = if (person.local) state.user?.shownName ?: person.name else info?.shown ?: person.name
                            val avatar = if (person.local) state.user?.avatar else info?.avatar
                            Column(
                                Modifier.clip(RoundedCornerShape(10.dp))
                                    .then(if (!person.local) Modifier.clickable { onProfile(person.id) } else Modifier)
                                    .padding(vertical = 8.dp, horizontal = 4.dp),
                                horizontalAlignment = Alignment.CenterHorizontally,
                            ) {
                                Box(Modifier.border(3.dp, if (person.speaking) Ink.Paper else Color.Transparent, CircleShape).padding(4.dp), contentAlignment = Alignment.Center) {
                                    Avatar(name, vm.api.fileUrl(avatar), size = 64.dp)
                                }
                                Spacer(Modifier.height(6.dp))
                                Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.Center) {
                                    Text(name, style = MaterialTheme.typography.bodyMedium, color = Ink.Paper, maxLines = 1,
                                        overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                                    if (person.muted) {
                                        Spacer(Modifier.width(4.dp))
                                        Icon(Icons.Filled.MicOff, contentDescription = "Mudo", tint = Ink.Muted, modifier = Modifier.size(14.dp))
                                    }
                                }
                            }
                        }
                    }
                }
                // Barra de controles da chamada.
                Row(
                    Modifier.fillMaxWidth().background(Ink.Ink1).navigationBarsPadding().padding(vertical = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(16.dp, Alignment.CenterHorizontally),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    CallControlButton(if (call.muted) Icons.Filled.MicOff else Icons.Filled.Mic, if (call.muted) "Ativar microfone" else "Silenciar microfone", call.muted) { vm.toggleMute() }
                    CallControlButton(if (call.deafened) Icons.Filled.HeadsetOff else Icons.Filled.Headset, if (call.deafened) "Ativar áudio" else "Desativar áudio", call.deafened) { vm.toggleDeafen() }
                    CallControlButton(Icons.Filled.CallEnd, "Sair da chamada", true) { vm.leaveVoice() }
                }
            }
        }

        // Vídeo em tela cheia (toque numa miniatura).
        val fullTile = call.videos.firstOrNull { it.key == fullVideoKey }
        if (fullTile != null) {
            BackHandler { fullVideoKey = null }
            Box(Modifier.fillMaxSize().background(Ink.Ink0)) {
                VideoView(fullTile.track, vm.voice.room, Modifier.fillMaxSize(), fit = true)
                IconButton(
                    onClick = { fullVideoKey = null },
                    modifier = Modifier.align(Alignment.TopEnd).padding(16.dp).clip(CircleShape).background(Ink.Ink2),
                ) { Icon(Icons.Filled.Close, contentDescription = "Fechar vídeo", tint = Ink.Paper) }
            }
        }
    }
}

/** Miniatura 16:9 de câmera ou tela compartilhada. */
@Composable
private fun VideoTileItem(tile: VideoTile, name: String, room: Room?, onClick: () -> Unit) {
    Box(Modifier.width(240.dp).aspectRatio(16f / 9f).clip(RoundedCornerShape(12.dp)).background(Ink.Ink3).clickable(onClick = onClick)) {
        VideoView(tile.track, room, Modifier.fillMaxSize(), fit = true)
        Text(
            if (tile.screen) "Tela de $name" else name,
            style = MaterialTheme.typography.bodyMedium,
            color = Ink.Paper,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.align(Alignment.BottomStart).padding(8.dp).clip(RoundedCornerShape(6.dp))
                .background(Ink.Ink0.copy(alpha = 0.75f)).padding(horizontal = 8.dp, vertical = 4.dp),
        )
    }
}

/** Botão redondo da barra de controles; `off` (mudo, sem áudio, sair) fica branco. */
@Composable
private fun CallControlButton(icon: ImageVector, description: String, off: Boolean, onClick: () -> Unit) {
    IconButton(onClick = onClick, modifier = Modifier.size(56.dp).clip(CircleShape).background(if (off) Ink.Paper else Ink.Ink3)) {
        Icon(icon, contentDescription = description, tint = if (off) Ink.Ink0 else Ink.Paper)
    }
}

/** Desenha um vídeo do LiveKit (câmera ou tela). */
@Composable
fun VideoView(track: VideoTrack, room: Room?, modifier: Modifier = Modifier, fit: Boolean = true) {
    val context = LocalContext.current
    val renderer = remember(room) { TextureViewRenderer(context).also { r -> room?.initVideoRenderer(r) } }
    DisposableEffect(track, renderer) {
        track.addRenderer(renderer)
        onDispose { track.removeRenderer(renderer) }
    }
    AndroidView(
        factory = { renderer },
        modifier = modifier,
        update = { r -> r.setScalingType(if (fit) RendererCommon.ScalingType.SCALE_ASPECT_FIT else RendererCommon.ScalingType.SCALE_ASPECT_FILL) },
        onRelease = { it.release() },
    )
}

/** Faixa fina mostrada quando a pessoa está numa chamada mas olhando outra tela. */
@Composable
fun CallBar(call: CallUi, channelName: String, onOpen: () -> Unit, vm: AppViewModel) {
    Row(
        Modifier.fillMaxWidth().background(Ink.Paper).clickable(onClick = onOpen).padding(horizontal = 12.dp, vertical = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(Icons.Filled.GraphicEq, contentDescription = null, tint = Ink.Ink0)
        Spacer(Modifier.width(8.dp))
        Text(
            (if (call.status == "connecting") "Conectando · " else "Em chamada · ") + channelName,
            color = Ink.Ink0,
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Bold,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        IconButton(onClick = { vm.toggleMute() }) {
            Icon(if (call.muted) Icons.Filled.MicOff else Icons.Filled.Mic, contentDescription = if (call.muted) "Ativar microfone" else "Silenciar microfone", tint = Ink.Ink0)
        }
        IconButton(onClick = { vm.leaveVoice() }) { Icon(Icons.Filled.CallEnd, contentDescription = "Sair da chamada", tint = Ink.Ink0) }
    }
}
