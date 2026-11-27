package com.dioneo.call

import android.content.Context
import android.os.Bundle
import android.os.PowerManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

class CallActivity : ComponentActivity() {
    private var proximity: PowerManager.WakeLock? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setShowWhenLocked(true)
        setTurnScreenOn(true)
        val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
        if (pm.isWakeLockLevelSupported(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK)) {
            proximity = pm.newWakeLock(PowerManager.PROXIMITY_SCREEN_OFF_WAKE_LOCK, "dioneo:proximity")
        }
        setContent { DioneoTheme { CallScreen(onClose = { finish() }, onSpeaker = ::onSpeakerChanged) } }
    }

    override fun onResume() {
        super.onResume()
        if (!Sip.isSpeaker()) runCatching { proximity?.acquire(60 * 60 * 1000L) }
    }

    override fun onPause() {
        super.onPause()
        runCatching { if (proximity?.isHeld == true) proximity?.release() }
    }

    private fun onSpeakerChanged(speaker: Boolean) {
        runCatching {
            if (speaker) { if (proximity?.isHeld == true) proximity?.release() }
            else if (proximity?.isHeld == false) proximity?.acquire(60 * 60 * 1000L)
        }
    }
}

@Composable
fun CallScreen(onClose: () -> Unit, onSpeaker: (Boolean) -> Unit) {
    val info by Sip.call.collectAsState()
    val prefs = Sip.prefs
    var seconds by remember { mutableIntStateOf(0) }
    var muted by remember { mutableStateOf(false) }
    var speaker by remember { mutableStateOf(Sip.isSpeaker()) }
    var showPad by remember { mutableStateOf(false) }
    var dtmf by remember { mutableStateOf("") }

    val e164 = if (info?.incoming == true) "" else Sip.lastDialedE164
    val rate = remember(e164) { if (e164.isNotBlank()) prefs.rateFor(e164) else null }
    val parsed = remember(info?.number) { info?.number?.let { Phone.parse(it, prefs.region) } }

    LaunchedEffect(info?.connected, info?.finished) {
        while (info?.connected == true && info?.finished != true) {
            seconds = Sip.current()?.duration ?: seconds
            delay(500)
        }
    }
    LaunchedEffect(info?.finished) {
        if (info?.finished == true) {
            delay(1800)
            Sip.clearCallInfo()
            onClose()
        }
    }
    LaunchedEffect(info) { if (info == null) onClose() }

    Column(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).systemBarsPadding().padding(24.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(32.dp))
        Text(flagOf(parsed?.region), fontSize = 48.sp)
        Text(
            parsed?.international ?: info?.number ?: "",
            fontSize = 28.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
        )
        Spacer(Modifier.height(8.dp))
        Text(info?.state ?: "", color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (info?.connected == true) {
            Spacer(Modifier.height(8.dp))
            Text(formatDuration(seconds), fontSize = 22.sp, color = MaterialTheme.colorScheme.primary)
            if (rate != null) {
                val cost = rate.perMin * maxOf(1, (seconds + 59) / 60)
                Text(
                    "≈ ${formatMoney(cost, prefs.currency)} · ${rate.label} ${formatMoney(rate.perMin, prefs.currency)}/min",
                    fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }

        Spacer(Modifier.weight(1f))

        if (showPad) {
            Text(dtmf, fontSize = 24.sp, modifier = Modifier.padding(8.dp))
            Keypad(onKey = { k -> dtmf += k; Sip.dtmf(k) }, onLong = {})
            Spacer(Modifier.height(16.dp))
        }

        if (info?.incoming == true && info?.connected != true && info?.finished != true) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                RoundButton(Icons.Filled.CallEnd, "Refuser", Red) { Sip.hangup() }
                RoundButton(Icons.Filled.Call, "Répondre", Green) { Sip.answer() }
            }
        } else {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceEvenly) {
                ToggleButton(if (muted) Icons.Filled.MicOff else Icons.Filled.Mic, "Muet", muted) {
                    muted = !muted; Sip.setMuted(muted)
                }
                ToggleButton(Icons.Filled.Dialpad, "Clavier", showPad) { showPad = !showPad }
                ToggleButton(Icons.Filled.VolumeUp, "H-P", speaker) {
                    speaker = Sip.toggleSpeaker(); onSpeaker(speaker)
                }
                ToggleButton(Icons.Filled.Pause, "Attente", info?.paused == true) { Sip.togglePause() }
            }
            Spacer(Modifier.height(28.dp))
            RoundButton(Icons.Filled.CallEnd, "Raccrocher", Red) {
                if (info?.finished == true) { Sip.clearCallInfo(); onClose() } else Sip.hangup()
            }
        }
        Spacer(Modifier.height(24.dp))
    }
}

@Composable
fun RoundButton(icon: ImageVector, label: String, color: Color, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        FilledIconButton(
            onClick = onClick, modifier = Modifier.size(72.dp), shape = CircleShape,
            colors = IconButtonDefaults.filledIconButtonColors(containerColor = color, contentColor = Color.White),
        ) { Icon(icon, label, Modifier.size(32.dp)) }
        Text(label, fontSize = 12.sp, modifier = Modifier.padding(top = 6.dp))
    }
}

@Composable
fun ToggleButton(icon: ImageVector, label: String, active: Boolean, onClick: () -> Unit) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        FilledTonalIconButton(
            onClick = onClick, modifier = Modifier.size(60.dp), shape = CircleShape,
            colors = IconButtonDefaults.filledTonalIconButtonColors(
                containerColor = if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant,
                contentColor = if (active) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSurface,
            ),
        ) { Icon(icon, label) }
        Text(label, fontSize = 12.sp, modifier = Modifier.padding(top = 4.dp))
    }
}
