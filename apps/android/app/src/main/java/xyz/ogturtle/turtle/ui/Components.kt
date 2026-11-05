package xyz.ogturtle.turtle.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil.compose.AsyncImage
import xyz.ogturtle.turtle.ui.theme.Ink

/** Foto redonda, ou as iniciais sobre tinta quando não há foto. */
@Composable
fun Avatar(name: String, url: String?, size: Dp = 40.dp, modifier: Modifier = Modifier, square: Boolean = false) {
    val shape = if (square) RoundedCornerShape(size / 4) else CircleShape
    val base = modifier.size(size).clip(shape).background(Ink.Ink4).border(1.dp, Ink.Line, shape)
    if (url != null) {
        AsyncImage(model = url, contentDescription = name, contentScale = ContentScale.Crop, modifier = base)
    } else {
        Box(base, contentAlignment = Alignment.Center) {
            Text(
                name.trim().take(2).uppercase().ifEmpty { "?" },
                color = Ink.Paper,
                fontWeight = FontWeight.Bold,
                fontSize = (size.value * 0.36f).sp,
            )
        }
    }
}

/** Bolinha com o número de não lidas (some quando é zero). */
@Composable
fun Badge(count: Int, modifier: Modifier = Modifier) {
    if (count <= 0) return
    Box(
        modifier.clip(CircleShape).background(Ink.Paper).size(22.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(if (count > 99) "99+" else count.toString(), color = Ink.Ink0, fontSize = 11.sp, fontWeight = FontWeight.ExtraBold)
    }
}

@Composable
fun SectionLabel(text: String, modifier: Modifier = Modifier) {
    Text(text.uppercase(), style = MaterialTheme.typography.labelSmall, color = Ink.Faint, modifier = modifier)
}
