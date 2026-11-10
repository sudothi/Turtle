package xyz.ogturtle.turtle.ui

import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Size
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
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

/** Busca o nome do arquivo selecionado pelo ContentResolver ou devolve "arquivo". */
private fun resolveFileName(context: Context, uri: Uri): String = runCatching {
    context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
        if (cursor.moveToFirst()) {
            val idx = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME)
            if (idx >= 0) cursor.getString(idx) else null
        } else null
    }
}.getOrNull()?.takeIf { it.isNotBlank() } ?: "arquivo"

@Composable
fun ChatScreen(state: UiState, vm: AppViewModel, channelId: String, onProfile: (String) -> Unit) {
    val messages = state.messages[channelId]
    val names = remember(state.messages, state.dms, state.friends, state.user) {
        buildMap {
            state.messages.values.flatten().forEach { put(it.userId, it.author) }
            state.dms.flatMap { it.users }.forEach { put(it.id, it.shownName) }
            state.friends.forEach { put(it.user.id, it.user.shownName) }
            state.user?.let { put(it.id, it.shownName) }
        }
    }
    val canModerate = remember(state.channels, state.servers, channelId) {
        val serverId = state.channels.entries.firstOrNull { (_, list) -> list.any { it.id == channelId } }?.key
        val role = serverId?.let { id -> state.servers.firstOrNull { it.id == id }?.role }
        role == "owner" || role == "admin"
    }

    var editingMessage by remember { mutableStateOf<Message?>(null) }
    var deletingMessage by remember { mutableStateOf<Message?>(null) }

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
                    LazyColumn(state = listState, reverseLayout = true, contentPadding = PaddingValues(vertical = 8.dp)) {
                        items(reversed.size, key = { reversed[it].id }) { i ->
                            val m = reversed[i]
                            val older = reversed.getOrNull(i + 1)
                            MessageRow(
                                m = m,
                                header = startsGroup(older, m),
                                names = names,
                                vm = vm,
                                mine = m.userId == state.user?.id,
                                canModerate = canModerate,
                                onProfile = onProfile,
                                onEdit = { editingMessage = m },
                                onDelete = { deletingMessage = m },
                            )
                        }
                    }
                }
            }
        }
        Composer(
            uploading = state.uploading,
            onSend = { text, files -> vm.send(channelId, text, files) },
        )
    }

    editingMessage?.let { msg ->
        EditMessageDialog(
            initial = msg.content,
            onDismiss = { editingMessage = null },
            onSave = { newContent ->
                vm.editMessage(msg.id, newContent)
                editingMessage = null
            },
        )
    }

    deletingMessage?.let { msg ->
        ConfirmDeleteDialog(
            onDismiss = { deletingMessage = null },
            onConfirm = {
                vm.deleteMessage(channelId, msg.id)
                deletingMessage = null
            },
        )
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun MessageRow(
    m: Message,
    header: Boolean,
    names: Map<String, String>,
    vm: AppViewModel,
    mine: Boolean,
    canModerate: Boolean,
    onProfile: (String) -> Unit,
    onEdit: () -> Unit,
    onDelete: () -> Unit,
) {
    val clipboard = LocalClipboardManager.current
    val uriHandler = LocalUriHandler.current
    var menuOpen by remember { mutableStateOf(false) }

    Box(
        Modifier
            .fillMaxWidth()
            // Fixada: trilho à esquerda, como no web.
            .then(if (m.pinned) Modifier.background(Ink.Ink2).drawBehind { drawRect(Ink.Paper, size = Size(3.dp.toPx(), size.height)) } else Modifier)
            .combinedClickable(
                onClick = {},
                onLongClick = { menuOpen = true },
            ),
    ) {
        Row(Modifier.fillMaxWidth().padding(start = 12.dp, end = 12.dp, top = if (header) 10.dp else 1.dp)) {
            if (header) Avatar(m.author, vm.api.fileUrl(m.avatar), size = 38.dp, modifier = Modifier.clickable { onProfile(m.userId) }) else Spacer(Modifier.size(38.dp))
            Spacer(Modifier.width(10.dp))
            Column(Modifier.weight(1f)) {
                if (m.pinned) {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 2.dp)) {
                        Icon(Icons.Filled.PushPin, contentDescription = null, tint = Ink.Muted, modifier = Modifier.size(12.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("FIXADA", fontSize = 10.sp, fontWeight = FontWeight.ExtraBold, color = Ink.Muted)
                    }
                }
                if (header) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(m.author, fontWeight = FontWeight.Bold, color = if (mine) Ink.Paper else Ink.PaperDim, modifier = Modifier.clickable { onProfile(m.userId) })
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
                    val fileUrl = vm.api.fileUrl(a.key)
                    if (a.isImage) {
                        val ratio = if (a.width != null && a.height != null && a.height > 0) a.width.toFloat() / a.height else 1.5f
                        AsyncImage(
                            model = fileUrl,
                            contentDescription = a.name,
                            contentScale = ContentScale.Fit,
                            modifier = Modifier.padding(top = 4.dp).heightIn(max = 320.dp).fillMaxWidth(0.9f)
                                .androidxAspect(ratio).clip(RoundedCornerShape(8.dp)).background(Ink.Ink3)
                                .clickable { fileUrl?.let { uriHandler.openUri(it) } },
                        )
                    } else {
                        Text(
                            "📎 ${a.name}",
                            color = Ink.PaperDim,
                            modifier = Modifier.padding(top = 4.dp)
                                .clip(RoundedCornerShape(8.dp)).background(Ink.Ink3)
                                .clickable { fileUrl?.let { uriHandler.openUri(it) } }
                                .padding(horizontal = 10.dp, vertical = 6.dp),
                        )
                    }
                }
            }
        }

        DropdownMenu(
            expanded = menuOpen,
            onDismissRequest = { menuOpen = false },
            modifier = Modifier.background(Ink.Ink2).border(1.dp, Ink.Line, RoundedCornerShape(4.dp)),
        ) {
            if (m.content.isNotEmpty()) {
                DropdownMenuItem(
                    text = { Text("Copiar texto", color = Ink.Paper) },
                    onClick = {
                        clipboard.setText(AnnotatedString(readable(m.content, names)))
                        menuOpen = false
                    },
                )
            }
            if (mine && m.content.isNotEmpty()) {
                DropdownMenuItem(
                    text = { Text("Editar", color = Ink.Paper) },
                    onClick = {
                        menuOpen = false
                        onEdit()
                    },
                )
            }
            if (mine || canModerate) {
                DropdownMenuItem(
                    text = { Text("Apagar", color = Ink.Paper) },
                    onClick = {
                        menuOpen = false
                        onDelete()
                    },
                )
            }
        }
    }
}

private fun Modifier.androidxAspect(ratio: Float): Modifier = this.then(Modifier.aspectRatio(ratio.coerceIn(0.4f, 4f)))

@Composable
private fun Composer(uploading: Boolean, onSend: (String, List<Uri>) -> Unit) {
    val context = LocalContext.current
    var text by rememberSaveable { mutableStateOf("") }
    var files by remember { mutableStateOf<List<Uri>>(emptyList()) }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetMultipleContents()) { picked ->
        if (picked.isNotEmpty()) files = files + picked
    }
    val canSend = (text.isNotBlank() || files.isNotEmpty()) && !uploading

    Column(Modifier.fillMaxWidth().background(Ink.Ink1)) {
        if (uploading) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 12.dp, vertical = 6.dp)) {
                Text("Enviando arquivos…", color = Ink.Muted, style = MaterialTheme.typography.bodyMedium)
                LinearProgressIndicator(
                    color = Ink.Paper,
                    trackColor = Ink.Ink3,
                    modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                )
            }
        }
        if (files.isNotEmpty()) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(start = 8.dp, end = 8.dp, top = 8.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp),
            ) {
                files.forEach { uri ->
                    val name = remember(uri) { resolveFileName(context, uri) }
                    Row(
                        Modifier
                            .clip(RoundedCornerShape(16.dp))
                            .background(Ink.Ink3)
                            .border(1.dp, Ink.Line, RoundedCornerShape(16.dp))
                            .padding(start = 10.dp, end = 6.dp, top = 4.dp, bottom = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Text(name, color = Ink.Paper, style = MaterialTheme.typography.bodyMedium, maxLines = 1, overflow = TextOverflow.Ellipsis)
                        Spacer(Modifier.width(4.dp))
                        Icon(
                            Icons.Filled.Close,
                            contentDescription = "Remover arquivo",
                            tint = Ink.Muted,
                            modifier = Modifier.size(16.dp).clickable { files = files - uri },
                        )
                    }
                }
            }
        }
        Row(
            Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp),
            verticalAlignment = Alignment.Bottom,
            horizontalArrangement = Arrangement.spacedBy(6.dp),
        ) {
            IconButton(
                onClick = { picker.launch("*/*") },
                enabled = !uploading,
                modifier = Modifier.size(52.dp).clip(RoundedCornerShape(26.dp)).background(Ink.Ink3),
            ) {
                Icon(Icons.Filled.AttachFile, contentDescription = "Anexar arquivo", tint = Ink.PaperDim)
            }
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
                onClick = {
                    val sentText = text
                    val sentFiles = files
                    text = ""
                    files = emptyList()
                    onSend(sentText, sentFiles)
                },
                enabled = canSend,
                modifier = Modifier.size(52.dp).clip(RoundedCornerShape(26.dp)).background(if (canSend) Ink.Paper else Ink.Ink3),
            ) {
                Icon(Icons.AutoMirrored.Filled.Send, contentDescription = "Enviar", tint = if (canSend) Ink.Ink0 else Ink.Faint)
            }
        }
    }
}
