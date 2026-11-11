package xyz.ogturtle.turtle.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Slider
import androidx.compose.material3.SliderDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import xyz.ogturtle.turtle.data.CallSound
import xyz.ogturtle.turtle.data.CallSounds
import xyz.ogturtle.turtle.data.SoundPrefs
import xyz.ogturtle.turtle.ui.theme.Ink
import kotlin.math.roundToInt

/** Configurações de som, iguais a Configurações > Notificações do web/desktop. Salva na hora. */
@Composable
fun SoundSettingsDialog(prefs: SoundPrefs, onChange: (SoundPrefs) -> Unit, onDismiss: () -> Unit) {
    TurtleDialog(title = "Sons", confirmText = "Fechar", onDismiss = onDismiss, onConfirm = onDismiss) {
        Column {
            Toggle("Sons do app", prefs.enabled) { onChange(prefs.copy(enabled = it)) }
            Volume("Volume", prefs.volume, prefs.enabled, { onChange(prefs.copy(volume = it)) }) { CallSounds.play(CallSound.Join, force = true) }
            Toggle("Entrada e saída da chamada", prefs.callPresence, prefs.enabled) { onChange(prefs.copy(callPresence = it)) }
            Toggle("Som de mensagem", prefs.messages, prefs.enabled) { onChange(prefs.copy(messages = it)) }
            Volume("Volume das mensagens", prefs.messageVolume, prefs.enabled && prefs.messages, { onChange(prefs.copy(messageVolume = it)) }) {
                CallSounds.play(CallSound.DmMessage, force = true)
            }
        }
    }
}

@Composable
private fun Toggle(label: String, checked: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(label, style = MaterialTheme.typography.bodyLarge, color = if (enabled) Ink.Paper else Ink.Faint, modifier = Modifier.weight(1f))
        Switch(
            checked = checked, onCheckedChange = onChange, enabled = enabled,
            colors = SwitchDefaults.colors(checkedThumbColor = Ink.Ink0, checkedTrackColor = Ink.Paper, uncheckedThumbColor = Ink.Muted, uncheckedTrackColor = Ink.Ink2),
        )
    }
}

@Composable
private fun Volume(label: String, value: Float, enabled: Boolean, onChange: (Float) -> Unit, onPreview: () -> Unit) {
    Column(Modifier.padding(vertical = 4.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("$label — ${(value * 100).roundToInt()}%", style = MaterialTheme.typography.bodyMedium, color = Ink.Muted, modifier = Modifier.weight(1f))
            TextButton(onClick = onPreview, enabled = enabled) { Text("Ouvir", color = if (enabled) Ink.Paper else Ink.Faint) }
        }
        Slider(
            value = value, onValueChange = onChange, valueRange = 0f..1f, enabled = enabled,
            colors = SliderDefaults.colors(thumbColor = Ink.Paper, activeTrackColor = Ink.Paper, inactiveTrackColor = Ink.Ink2),
        )
    }
}
