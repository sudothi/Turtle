package xyz.ogturtle.turtle.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.background
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import xyz.ogturtle.turtle.AppViewModel
import xyz.ogturtle.turtle.UiState
import xyz.ogturtle.turtle.data.Message
import xyz.ogturtle.turtle.data.shownName
import xyz.ogturtle.turtle.ui.theme.Ink
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val hour = DateTimeFormatter.ofPattern("HH:mm")
private val day = DateTimeFormatter.ofPattern("dd/MM/yyyy")

/** "14:05" se foi hoje; senão "05/11/2026 14:05". */
internal fun formatTime(iso: String): String = runCatching {
    val t = Instant.parse(iso).atZone(ZoneId.systemDefault())
    if (t.toLocalDate() == LocalDate.now()) hour.format(t) else day.format(t) + " " + hour.format(t)
}.getOrDefault("")

private val mention = Regex("<@([A-Za-z0-9_-]+)>")

/** Troca os tokens de menção `<@id>` por `@Nome`. */
internal fun readable(content: String, names: Map<String, String>): String =
    mention.replace(content) { "@" + (names[it.groupValues[1]] ?: "alguém") }

/** Mesma pessoa em até 5 minutos: junta as mensagens sem repetir o cabeçalho. */
private fun startsGroup(prev: Message?, m: Message): Boolean {
    if (prev == null || prev.userId != m.userId) return true
    return runCatching { Instant.parse(m.createdAt).epochSecond - Instant.parse(prev.createdAt).epochSecond > 300 }.getOrDefault(true)
}

@Composable
fun ChatScreen(state: UiState, vm: AppViewModel, channelId: String) {
    val messages = state.messages[channelId]
    val names = remember(state.messages, state.dms, state.friends, state.user) {
        buildMap {
            state.messages.values.flatten().forEach { put(it.userId, it.author) }
            state.dms.flatMap { it.users }.forEach { put(it.id, it.shownName) }
            state.friends.forEach { put(it.user.id, it.user.shownName) }
            state.user?.let { put(it.id, it.shownName) }
        }
    }
    val listState = rememberLazyListState()

    // Mensagem nova no fim: rola até ela se já estava lendo as últimas.
    LaunchedEffect(messages?.lastOrNull()?.id) {
        if (listState.firstVisibleItemIndex <= 2) listState.animateScrollToItem(0)
    }
    // Chegou no topo da lista carregada: busca as mais antigas.
    LaunchedEffect(channelId, messages?.size) {
        snapshotFlow { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }.collect { last ->
            val total = listState.layoutInfo.totalItemsCount
            if (total > 0 && last >= total - 3) vm.loadOlder(channelId)
        }
    }

    Column(Modifier.fillMaxSize().imePadding()) {
        Box(Modifier.weight(1f).fillMaxWidth()) {
            when {
                messages == null -> Text("Carregando…", color = Ink.Muted, modifier = Modifier.align(Alignment.Center))
                messages.isEmpty() -> Text("Nenhuma mensagem ainda. Diga oi!", color = Ink.Muted, modifier = Modifier.align(Alignment.Center))
                else -> {
                    // reverseLayout: o item 0 fica embaixo (mensagem mais nova); a lista cresce para cima.
                    val reversed = remember(messages) { messages.asReversed() }
                    LazyColumn(state = listState, reverseLayout = true, contentPadding = androidx.compose.foundation.layout.PaddingValues(vertical = 8.dp)) {
                        items(reversed.size, key = { reversed[it].id }) { i ->
                            val m = reversed[i]
                            val older = reversed.getOrNull(i + 1)
                            MessageRow(m, header = startsGroup(older, m), names = names, vm = vm, mine = m.userId == state.user?.id)
                        }
                    }
                }
            }
        }
        Composer(onSend = { vm.send(channelId, it) })
    }
}

@Composable
private fun MessageRow(m: Message, header: Boolean, names: Map<String, String>, vm: AppViewModel, mine: Boolean) {
    Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = if (header) 10.dp else 1.dp)) {
        if (header) Avatar(m.author, vm.api.fileUrl(m.avatar), size = 38.dp) else Spacer(Modifier.size(38.dp))
        Spacer(Modifier.width(10.dp))
        Column(Modifier.weight(1f)) {
            if (header) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(m.author, fontWeight = FontWeight.Bold, color = if (mine) Ink.Paper else Ink.PaperDim)
                    if (m.staff) {
                        Spacer(Modifier.width(6.dp))
                        Text("TURTLE", fontSize = 9.sp, fontWeight = FontWeight.ExtraBold, color = Ink.Ink0,
                            modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(Ink.Paper).padding(horizontal = 4.dp, vertical = 1.dp))
                    }
                    Spacer(Modifier.width(8.dp))
                    Text(formatTime(m.createdAt), color = Ink.Faint, fontSize = 11.sp)
                }
            }
            if (m.content.isNotEmpty()) {
                Text(
                    readable(m.content, names) + if (m.editedAt != null) "  (editado)" else "",
                    style = MaterialTheme.typography.bodyLarge,
                    color = Ink.Paper,
                )
            }
            m.attachments.forEach { a ->
                if (a.isImage) {
                    val ratio = if (a.width != null && a.height != null && a.height > 0) a.width.toFloat() / a.height else 1.5f
                    AsyncImage(
                        model = vm.api.fileUrl(a.key),
                        contentDescription = a.name,
                        contentScale = ContentScale.Fit,
                        modifier = Modifier.padding(top = 4.dp).heightIn(max = 320.dp).fillMaxWidth(0.9f)
                            .androidxAspect(ratio).clip(RoundedCornerShape(8.dp)).background(Ink.Ink3),
                    )
                } else {
                    Text("📎 ${a.name}", color = Ink.PaperDim, modifier = Modifier.padding(top = 4.dp)
                        .clip(RoundedCornerShape(8.dp)).background(Ink.Ink3).padding(horizontal = 10.dp, vertical = 6.dp))
                }
            }
        }
    }
}

private fun Modifier.androidxAspect(ratio: Float): Modifier = this.then(Modifier.aspectRatio(ratio.coerceIn(0.4f, 4f)))

@Composable
private fun Composer(onSend: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf("") }
    Row(
        Modifier.fillMaxWidth().background(Ink.Ink1).padding(horizontal = 8.dp, vertical = 8.dp),
        verticalAlignment = Alignment.Bottom,
        horizontalArrangement = Arrangement.spacedBy(6.dp),
    ) {
        OutlinedTextField(
            value = text,
            onValueChange = { text = it },
            placeholder = { Text("Mensagem", color = Ink.Faint) },
            maxLines = 5,
            shape = RoundedCornerShape(22.dp),
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = Ink.Paper, unfocusedBorderColor = Ink.Line,
                focusedContainerColor = Ink.Ink3, unfocusedContainerColor = Ink.Ink3, cursorColor = Ink.Paper,
            ),
            modifier = Modifier.weight(1f),
        )
        IconButton(
            onClick = { onSend(text); text = "" },
            enabled = text.isNotBlank(),
            modifier = Modifier.size(52.dp).clip(RoundedCornerShape(26.dp)).background(if (text.isNotBlank()) Ink.Paper else Ink.Ink3),
        ) {
            Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Enviar", tint = if (text.isNotBlank()) Ink.Ink0 else Ink.Faint)
        }
    }
}
