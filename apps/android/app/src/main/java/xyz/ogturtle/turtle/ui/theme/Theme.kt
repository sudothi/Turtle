package xyz.ogturtle.turtle.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.shape.RoundedCornerShape

/** Tudo é tinta (preto) e papel (branco quente); os cinzas são camadas de tinta (igual ao tokens.css do site). */
object Ink {
    val Ink0 = Color(0xFF000000)
    val Ink1 = Color(0xFF0A0A0A)
    val Ink2 = Color(0xFF111111)
    val Ink3 = Color(0xFF1A1A1A)
    val Ink4 = Color(0xFF242424)
    val Ink5 = Color(0xFF2E2E2E)
    val Paper = Color(0xFFF5F3EE)
    val PaperDim = Color(0xFFC9C6BF)
    val Muted = Color(0xFF9A9790)
    val Faint = Color(0xFF66645F)
    val Line = Color(0xFF2A2A2A)
    val Danger = Color(0xFFE5736B)
}

private val scheme = darkColorScheme(
    primary = Ink.Paper,
    onPrimary = Ink.Ink0,
    secondary = Ink.PaperDim,
    onSecondary = Ink.Ink0,
    background = Ink.Ink0,
    onBackground = Ink.Paper,
    surface = Ink.Ink2,
    onSurface = Ink.Paper,
    surfaceVariant = Ink.Ink3,
    onSurfaceVariant = Ink.Muted,
    outline = Ink.Line,
    error = Ink.Danger,
    onError = Ink.Ink0,
)

private val type = Typography(
    headlineMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.ExtraBold, fontSize = 30.sp),
    titleLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 22.sp),
    titleMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.SemiBold, fontSize = 16.sp),
    bodyLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 16.sp),
    bodyMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 14.sp),
    labelLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 14.sp),
    labelSmall = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 11.sp, letterSpacing = 1.sp),
)

private val shapes = Shapes(
    small = RoundedCornerShape(6.dp),
    medium = RoundedCornerShape(8.dp),
    large = RoundedCornerShape(12.dp),
)

@Composable
fun TurtleTheme(content: @Composable () -> Unit) {
    // O visual é sempre escuro, independente do tema do aparelho.
    @Suppress("UNUSED_VARIABLE") val ignored = isSystemInDarkTheme()
    MaterialTheme(colorScheme = scheme, typography = type, shapes = shapes, content = content)
}
