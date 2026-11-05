package xyz.ogturtle.turtle.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.FilterChip
import androidx.compose.material3.FilterChipDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.MenuDefaults
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.compositionLocalOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import xyz.ogturtle.turtle.ui.theme.Ink

/** Erro atual do app (vindo do servidor) e como limpá-lo; os diálogos mostram por dentro. */
data class DialogError(val text: String?, val clear: () -> Unit)

val LocalDialogError = compositionLocalOf { DialogError(null) {} }

/** Diálogo padrão em preto e branco da Turtle. */
@Composable
fun TurtleDialog(
    title: String,
    confirmText: String = "Confirmar",
    confirmEnabled: Boolean = true,
    onDismiss: () -> Unit,
    onConfirm: () -> Unit,
    content: @Composable () -> Unit,
) {
    val error = LocalDialogError.current
    // Erro antigo (de antes de abrir o diálogo) não deve aparecer aqui.
    LaunchedEffect(Unit) { error.clear() }
    AlertDialog(
        onDismissRequest = onDismiss,
        containerColor = Ink.Ink1,
        titleContentColor = Ink.Paper,
        textContentColor = Ink.Paper,
        title = { Text(title, style = MaterialTheme.typography.titleLarge) },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                content()
                error.text?.let { Text(it, color = Ink.Ink0, style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(8.dp)).background(Ink.Paper).padding(horizontal = 12.dp, vertical = 8.dp)) }
            }
        },
        confirmButton = {
            Button(
                onClick = onConfirm,
                enabled = confirmEnabled,
                colors = ButtonDefaults.buttonColors(
                    containerColor = Ink.Paper,
                    contentColor = Ink.Ink0,
                    disabledContainerColor = Ink.Ink3,
                    disabledContentColor = Ink.Faint,
                ),
            ) {
                Text(confirmText, fontWeight = FontWeight.Bold)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancelar", color = Ink.Muted)
            }
        },
    )
}

/** Campo de texto com as mesmas cores de tinta e papel do Composer. */
@Composable
fun TurtleField(
    value: String,
    onValueChange: (String) -> Unit,
    placeholder: String,
    modifier: Modifier = Modifier,
    singleLine: Boolean = true,
    maxLines: Int = if (singleLine) 1 else 5,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        placeholder = { Text(placeholder, color = Ink.Faint) },
        singleLine = singleLine,
        maxLines = maxLines,
        shape = RoundedCornerShape(12.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = Ink.Paper,
            unfocusedBorderColor = Ink.Line,
            focusedContainerColor = Ink.Ink3,
            unfocusedContainerColor = Ink.Ink3,
            focusedTextColor = Ink.Paper,
            unfocusedTextColor = Ink.Paper,
            cursorColor = Ink.Paper,
        ),
        modifier = modifier.fillMaxWidth(),
    )
}

/** Diálogo para editar o texto de uma mensagem enviada. */
@Composable
fun EditMessageDialog(initial: String, onDismiss: () -> Unit, onSave: (String) -> Unit) {
    var text by rememberSaveable { mutableStateOf(initial) }
    TurtleDialog(
        title = "Editar mensagem",
        confirmText = "Salvar",
        confirmEnabled = text.isNotBlank(),
        onDismiss = onDismiss,
        onConfirm = { onSave(text.trim()) },
    ) {
        TurtleField(
            value = text,
            onValueChange = { text = it },
            placeholder = "Mensagem",
            singleLine = false,
            maxLines = 6,
        )
    }
}

/** Confirmação antes de apagar uma mensagem. */
@Composable
fun ConfirmDeleteDialog(onDismiss: () -> Unit, onConfirm: () -> Unit) {
    TurtleDialog(
        title = "Apagar mensagem?",
        confirmText = "Apagar",
        onDismiss = onDismiss,
        onConfirm = onConfirm,
    ) {
        Text("Essa ação não pode ser desfeita.", color = Ink.Muted)
    }
}

/** Diálogo para adicionar amigo pelo nome de usuário. */
@Composable
fun AddFriendDialog(onDismiss: () -> Unit, onAdd: (String) -> Unit) {
    var username by rememberSaveable { mutableStateOf("") }
    TurtleDialog(
        title = "Adicionar amigo",
        confirmText = "Enviar pedido",
        confirmEnabled = username.isNotBlank(),
        onDismiss = onDismiss,
        onConfirm = { onAdd(username.trim()) },
    ) {
        TurtleField(
            value = username,
            onValueChange = { username = it },
            placeholder = "Nome de usuário",
        )
    }
}

/** Diálogo para criar um canal de texto ou de voz no servidor. */
@Composable
fun CreateChannelDialog(onDismiss: () -> Unit, onCreate: (name: String, kind: String) -> Unit) {
    var name by rememberSaveable { mutableStateOf("") }
    var kind by rememberSaveable { mutableStateOf("text") }
    TurtleDialog(
        title = "Criar canal",
        confirmText = "Criar",
        confirmEnabled = name.isNotBlank(),
        onDismiss = onDismiss,
        onConfirm = { onCreate(name.trim(), kind) },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                 listOf("text" to "Texto", "voice" to "Voz").forEach { (k, label) ->
                    val selected = kind == k
                    FilterChip(
                        selected = selected,
                        onClick = { kind = k },
                        label = { Text(label, fontWeight = FontWeight.SemiBold) },
                        colors = FilterChipDefaults.filterChipColors(
                            containerColor = Ink.Ink3,
                            labelColor = Ink.PaperDim,
                            selectedContainerColor = Ink.Paper,
                            selectedLabelColor = Ink.Ink0,
                        ),
                        border = FilterChipDefaults.filterChipBorder(
                            enabled = true,
                            selected = selected,
                            borderColor = Ink.Line,
                            selectedBorderColor = Ink.Paper,
                        ),
                    )
                }
            }
            TurtleField(
                value = name,
                onValueChange = { name = it },
                placeholder = "Nome do canal",
            )
        }
    }
}

/** Diálogo com alternância entre criar um servidor novo ou entrar com código de convite. */
@Composable
fun CreateOrJoinServerDialog(
    onDismiss: () -> Unit,
    onCreate: (name: String) -> Unit,
    onJoin: (code: String) -> Unit,
) {
    var tab by rememberSaveable { mutableStateOf("create") }
    var input by rememberSaveable { mutableStateOf("") }
    val isCreate = tab == "create"

    TurtleDialog(
        title = if (isCreate) "Criar servidor" else "Entrar com convite",
        confirmText = if (isCreate) "Criar" else "Entrar",
        confirmEnabled = input.isNotBlank(),
        onDismiss = onDismiss,
        onConfirm = {
            if (isCreate) onCreate(input.trim()) else onJoin(input.trim())
        },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Row(
                Modifier
                    .fillMaxWidth()
                    .clip(RoundedCornerShape(8.dp))
                    .background(Ink.Ink3)
                    .padding(4.dp),
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                listOf("create" to "Criar", "join" to "Entrar com convite").forEach { (key, label) ->
                    val selected = tab == key
                    Box(
                        Modifier
                            .weight(1f)
                            .clip(RoundedCornerShape(6.dp))
                            .background(if (selected) Ink.Paper else Ink.Ink3)
                            .clickable { tab = key }
                            .padding(vertical = 8.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            label,
                            color = if (selected) Ink.Ink0 else Ink.PaperDim,
                            style = MaterialTheme.typography.labelLarge,
                        )
                    }
                }
            }
            TurtleField(
                value = input,
                onValueChange = { input = it },
                placeholder = if (isCreate) "Nome do servidor" else "Código ou link do convite",
            )
        }
    }
}

/** Diálogo para editar nome de exibição e bio do próprio perfil. */
@Composable
fun EditProfileDialog(
    initialName: String,
    initialBio: String,
    onDismiss: () -> Unit,
    onSave: (name: String, bio: String) -> Unit,
) {
    var name by rememberSaveable { mutableStateOf(initialName) }
    var bio by rememberSaveable { mutableStateOf(initialBio.take(190)) }

    TurtleDialog(
        title = "Editar perfil",
        confirmText = "Salvar",
        onDismiss = onDismiss,
        onConfirm = { onSave(name.trim(), bio.trim()) },
    ) {
        Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
            TurtleField(
                value = name,
                onValueChange = { name = it },
                placeholder = "Nome de exibição",
            )
            Column {
                TurtleField(
                    value = bio,
                    onValueChange = { if (it.length <= 190) bio = it },
                    placeholder = "Sobre você (bio)",
                    singleLine = false,
                    maxLines = 4,
                )
                Spacer(Modifier.height(4.dp))
                Text(
                    "${bio.length}/190",
                    color = Ink.Muted,
                    style = MaterialTheme.typography.labelSmall,
                    modifier = Modifier.align(Alignment.End),
                )
            }
        }
    }
}

/** Menu suspenso para escolher o status de presença ("online" ou "busy"). */
@Composable
fun StatusPicker(
    expanded: Boolean,
    current: String,
    onDismiss: () -> Unit,
    onPick: (String) -> Unit,
) {
    DropdownMenu(
        expanded = expanded,
        onDismissRequest = onDismiss,
        modifier = Modifier.background(Ink.Ink2).border(1.dp, Ink.Line, RoundedCornerShape(4.dp)),
    ) {
        val options = listOf("online" to "Online", "busy" to "Não perturbe")
        options.forEach { (value, label) ->
            val selected = current == value
            DropdownMenuItem(
                text = {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Box(
                            Modifier
                                .size(10.dp)
                                .clip(CircleShape)
                                .then(
                                    if (value == "busy") Modifier.border(2.dp, Ink.Paper, CircleShape)
                                    else Modifier.background(Ink.Paper),
                                ),
                        )
                        Spacer(Modifier.width(10.dp))
                        Text(
                            label,
                            color = if (selected) Ink.Paper else Ink.PaperDim,
                            fontWeight = if (selected) FontWeight.Bold else FontWeight.Normal,
                        )
                    }
                },
                onClick = {
                    onPick(value)
                    onDismiss()
                },
                colors = MenuDefaults.itemColors(textColor = Ink.Paper),
            )
        }
    }
}
