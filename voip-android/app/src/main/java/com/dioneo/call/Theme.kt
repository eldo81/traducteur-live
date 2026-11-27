package com.dioneo.call

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val Green = Color(0xFF1DB57A)
val Red = Color(0xFFE5484D)

private val scheme = darkColorScheme(
    primary = Green,
    onPrimary = Color(0xFF00210F),
    secondary = Color(0xFFF2A541),
    background = Color(0xFF0F1512),
    surface = Color(0xFF0F1512),
    surfaceVariant = Color(0xFF1B2620),
    onSurface = Color(0xFFE3ECE6),
    onSurfaceVariant = Color(0xFFA7B8AE),
    error = Red,
)

@Composable
fun DioneoTheme(content: @Composable () -> Unit) = MaterialTheme(colorScheme = scheme, content = content)

fun formatDuration(sec: Int): String = "%d:%02d".format(sec / 60, sec % 60)

fun formatMoney(v: Double, currency: String): String =
    if (v < 1) "%.3f %s".format(v, currency) else "%.2f %s".format(v, currency)
