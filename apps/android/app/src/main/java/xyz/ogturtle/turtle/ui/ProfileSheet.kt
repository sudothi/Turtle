package xyz.ogturtle.turtle.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import xyz.ogturtle.turtle.AppViewModel
import xyz.ogturtle.turtle.data.ApiException
import xyz.ogturtle.turtle.data.ProfileView
import xyz.ogturtle.turtle.ui.theme.Ink
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val memberSince = DateTimeFormatter.ofPattern("dd/MM/yyyy")

/** Cartão de perfil de baixo para cima (banner, foto, sobre mim, o que têm em comum e ações). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileSheet(userId: String, myId: String?, vm: AppViewModel, onDismiss: () -> Unit, onMessage: (String) -> Unit) {
    var profile by remember(userId) { mutableStateOf<ProfileView?>(null) }
    var failed by remember(userId) { mutableStateOf<String?>(null) }
    var reload by remember { mutableStateOf(0) }
    LaunchedEffect(userId, reload) {
        try {
            profile = vm.api.profile(userId)
        } catch (e: ApiException) {
            failed = e.message
        }
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true),
        containerColor = Ink.Ink2,
        contentColor = Ink.Paper,
        dragHandle = null,
        shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp),
    ) {
        val p = profile
        when {
            p != null -> Column(Modifier.verticalScroll(rememberScrollState()).navigationBarsPadding()) {
                Box(Modifier.fillMaxWidth().height(112.dp).background(Ink.Ink4)) {
                    vm.api.fileUrl(p.banner)?.let {
                        AsyncImage(model = it, contentDescription = null, contentScale = ContentScale.Crop, modifier = Modifier.fillMaxWidth().height(112.dp))
                    }
                }
                Row(Modifier.padding(horizontal = 16.dp).offset(y = (-36).dp)) {
                    Avatar(p.shown, vm.api.fileUrl(p.avatar), size = 80.dp, ring = Ink.Ink2, status = if (p.id in vm.state.value.online) (if (p.id in vm.state.value.dnd) "busy" else "online") else null)
                }
                Column(Modifier.padding(horizontal = 16.dp).offset(y = (-24).dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(p.shown, style = MaterialTheme.typography.titleLarge)
                        if (p.staff) {
                            Spacer(Modifier.padding(start = 8.dp))
                            Text("TURTLE", fontSize = 10.sp, fontWeight = FontWeight.ExtraBold, color = Ink.Ink0,
                                modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(Ink.Paper).padding(horizontal = 5.dp, vertical = 1.dp))
                        }
                    }
                    Text("@${p.username}", color = Ink.Muted)
                    p.bio?.takeIf { it.isNotBlank() }?.let {
                        SectionLabel("Sobre mim", Modifier.padding(top = 16.dp, bottom = 4.dp))
                        Text(it, color = Ink.PaperDim)
                    }
                    if (p.createdAt.isNotEmpty()) {
                        SectionLabel("Membro desde", Modifier.padding(top = 16.dp, bottom = 4.dp))
                        Text(runCatching { memberSince.format(Instant.parse(p.createdAt).atZone(ZoneId.systemDefault())) }.getOrDefault(""), color = Ink.PaperDim)
                    }
                    if (p.mutualServers.isNotEmpty()) {
                        SectionLabel("Servidores em comum — ${p.mutualServers.size}", Modifier.padding(top = 16.dp, bottom = 4.dp))
                        Text(p.mutualServers.joinToString(", ") { it.name }, color = Ink.PaperDim)
                    }
                    if (p.mutualFriends.isNotEmpty()) {
                        SectionLabel("Amigos em comum — ${p.mutualFriends.size}", Modifier.padding(top = 16.dp, bottom = 4.dp))
                        Text(p.mutualFriends.joinToString(", ") { it.displayName?.takeIf { n -> n.isNotBlank() } ?: it.username }, color = Ink.PaperDim)
                    }
                    if (p.id != myId) {
                        Row(Modifier.padding(top = 20.dp, bottom = 16.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Button(
                                onClick = { vm.openDm(p.id) { onMessage(it) } },
                                colors = ButtonDefaults.buttonColors(containerColor = Ink.Paper, contentColor = Ink.Ink0),
                            ) { Text("Enviar mensagem") }
                            when (p.friendship) {
                                "none" -> OutlinedButton(onClick = { vm.setFriend(p.id, true) { reload++ } }) { Text("Adicionar amigo", color = Ink.Paper) }
                                "incoming" -> OutlinedButton(onClick = { vm.setFriend(p.id, true) { reload++ } }) { Text("Aceitar pedido", color = Ink.Paper) }
                                "outgoing" -> OutlinedButton(onClick = { vm.setFriend(p.id, false) { reload++ } }) { Text("Cancelar pedido", color = Ink.Paper) }
                                else -> OutlinedButton(onClick = { vm.setFriend(p.id, false) { reload++ } }) { Text("Remover amigo", color = Ink.Paper) }
                            }
                        }
                    } else {
                        Spacer(Modifier.height(16.dp))
                    }
                }
            }
            failed != null -> Text(failed!!, color = Ink.Muted, modifier = Modifier.padding(32.dp))
            else -> Box(Modifier.fillMaxWidth().padding(48.dp), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
        }
    }
}
