package xyz.ogturtle.turtle.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import xyz.ogturtle.turtle.AppViewModel
import xyz.ogturtle.turtle.UiState
import xyz.ogturtle.turtle.data.Member
import xyz.ogturtle.turtle.ui.theme.Ink

private val roleLabel = mapOf("owner" to "Dono", "admin" to "Admin")

/** Membros do servidor: online primeiro, depois offline (como na lista lateral do desktop). */
@Composable
fun MembersPanel(state: UiState, vm: AppViewModel, serverId: String?, onProfile: (String) -> Unit) {
    val members = serverId?.let { state.members[it] }.orEmpty()
    val byName = compareBy<Member, String>(String.CASE_INSENSITIVE_ORDER) { it.shown }
    val on = members.filter { it.userId in state.online }.sortedWith(byName)
    val off = members.filter { it.userId !in state.online }.sortedWith(byName)
    Column(Modifier.fillMaxHeight().background(Ink.Ink1).statusBarsPadding()) {
        Text("Membros", style = MaterialTheme.typography.titleMedium, modifier = Modifier.padding(16.dp))
        LazyColumn(contentPadding = PaddingValues(bottom = 24.dp)) {
            if (members.isEmpty()) item { Text("Abra um canal de um servidor para ver os membros.", color = Ink.Muted, modifier = Modifier.padding(16.dp)) }
            if (on.isNotEmpty()) item { SectionLabel("Online — ${on.size}", Modifier.padding(start = 16.dp, end = 16.dp, top = 8.dp, bottom = 6.dp)) }
            items(on, key = { "on-${it.userId}" }) { MemberRow(it, if (it.userId in state.dnd) "busy" else "online", vm, true, onProfile) }
            if (off.isNotEmpty()) item { SectionLabel("Offline — ${off.size}", Modifier.padding(start = 16.dp, end = 16.dp, top = 16.dp, bottom = 6.dp)) }
            items(off, key = { "off-${it.userId}" }) { MemberRow(it, null, vm, false, onProfile) }
        }
    }
}

@Composable
private fun MemberRow(m: Member, status: String?, vm: AppViewModel, online: Boolean, onProfile: (String) -> Unit) {
    Row(
        Modifier.fillMaxWidth().padding(horizontal = 8.dp).clip(RoundedCornerShape(8.dp)).clickable { onProfile(m.userId) }.padding(horizontal = 8.dp, vertical = 7.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(m.shown, vm.api.fileUrl(m.avatar), size = 36.dp, status = status)
        Spacer(Modifier.width(12.dp))
        Text(m.shown, color = if (online) Ink.Paper else Ink.Faint, fontWeight = FontWeight.Medium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
        if (m.staff) {
            Spacer(Modifier.width(6.dp))
            Text("TURTLE", fontSize = 9.sp, fontWeight = FontWeight.ExtraBold, color = Ink.Ink0,
                modifier = Modifier.clip(RoundedCornerShape(4.dp)).background(Ink.Paper).padding(horizontal = 4.dp, vertical = 1.dp))
        }
        roleLabel[m.role]?.let { Text(it, color = Ink.Muted, fontSize = 11.sp, modifier = Modifier.padding(start = 8.dp)) }
    }
}
