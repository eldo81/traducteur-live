package com.dioneo.call

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.ContactsContract
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

class MainActivity : ComponentActivity() {
    private val pendingNumber = mutableStateOf("")

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleTel(intent)
        setContent { DioneoTheme { MainScreen(pendingNumber) } }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleTel(intent)
    }

    override fun onResume() {
        super.onResume()
        Sip.refreshRegistration()
    }

    private fun handleTel(intent: Intent?) {
        val data = intent?.data ?: return
        if (data.scheme == "tel") pendingNumber.value = Uri.decode(data.schemeSpecificPart ?: "")
    }
}

private enum class Tab(val label: String) { DIAL("Clavier"), HISTORY("Historique"), RATES("Tarifs"), ACCOUNT("Compte") }

@Composable
fun MainScreen(pendingNumber: MutableState<String>) {
    val ctx = LocalContext.current
    var tab by remember { mutableStateOf(if (Sip.prefs.sip.isComplete) Tab.DIAL else Tab.ACCOUNT) }
    var number by remember { mutableStateOf("") }
    val reg by Sip.registration.collectAsState()

    val perms = buildList {
        add(Manifest.permission.RECORD_AUDIO)
        if (Build.VERSION.SDK_INT >= 33) add(Manifest.permission.POST_NOTIFICATIONS)
        if (Build.VERSION.SDK_INT >= 31) add(Manifest.permission.BLUETOOTH_CONNECT)
    }.toTypedArray()
    val permLauncher = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {}
    LaunchedEffect(Unit) { permLauncher.launch(perms) }

    LaunchedEffect(pendingNumber.value) {
        if (pendingNumber.value.isNotBlank()) { number = pendingNumber.value; pendingNumber.value = ""; tab = Tab.DIAL }
    }

    fun placeCall(raw: String) {
        val parsed = Phone.parse(raw, Sip.prefs.region)
        if (parsed == null) { Toast.makeText(ctx, "Numéro invalide", Toast.LENGTH_SHORT).show(); return }
        val err = Sip.call(parsed.e164)
        if (err != null) Toast.makeText(ctx, err, Toast.LENGTH_LONG).show()
        else ctx.startActivity(Intent(ctx, CallActivity::class.java))
    }

    Scaffold(
        topBar = { StatusBar(reg) },
        bottomBar = {
            NavigationBar {
                Tab.entries.forEach { t ->
                    NavigationBarItem(
                        selected = tab == t, onClick = { tab = t },
                        icon = {
                            Icon(
                                when (t) {
                                    Tab.DIAL -> Icons.Filled.Dialpad; Tab.HISTORY -> Icons.Filled.History
                                    Tab.RATES -> Icons.Filled.Payments; Tab.ACCOUNT -> Icons.Filled.Settings
                                }, t.label
                            )
                        },
                        label = { Text(t.label) },
                    )
                }
            }
        },
    ) { pad ->
        Box(Modifier.padding(pad).fillMaxSize()) {
            when (tab) {
                Tab.DIAL -> DialerScreen(number, { number = it }, ::placeCall)
                Tab.HISTORY -> HistoryScreen { n -> number = n; tab = Tab.DIAL }
                Tab.RATES -> RatesScreen()
                Tab.ACCOUNT -> AccountScreen()
            }
        }
    }
}

@Composable
private fun StatusBar(reg: Registration) {
    Row(
        Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 16.dp, vertical = 10.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("Dioneo Call", fontWeight = FontWeight.Bold, fontSize = 20.sp, modifier = Modifier.weight(1f))
        Surface(color = if (reg.ok) Green else Color(0xFFF2A541), shape = CircleShape, modifier = Modifier.size(10.dp)) {}
        Spacer(Modifier.width(6.dp))
        Text(
            if (reg.ok) "En ligne" else reg.label, fontSize = 12.sp, maxLines = 1,
            color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.widthIn(max = 200.dp),
        )
    }
}

// ---------------------------------------------------------------- Clavier

@Composable
fun DialerScreen(number: String, onNumber: (String) -> Unit, onCall: (String) -> Unit) {
    val ctx = LocalContext.current
    val prefs = Sip.prefs
    var region by remember { mutableStateOf(prefs.region) }
    var picker by remember { mutableStateOf(false) }
    val country = remember(region) { Phone.country(region) }
    val parsed = remember(number, region) { Phone.parse(number, region) }
    val rate = remember(parsed?.e164) { parsed?.let { prefs.rateFor(it.e164) } }

    val contactLauncher = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { res ->
        val uri = res.data?.data
        if (res.resultCode == Activity.RESULT_OK && uri != null) {
            readPhoneNumber(ctx, uri)?.let(onNumber)
        }
    }

    Column(
        Modifier.fillMaxSize().padding(horizontal = 20.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(Modifier.height(8.dp))
        AssistChip(
            onClick = { picker = true },
            label = { Text("${country.flag}  ${country.name}  +${country.code}") },
            trailingIcon = { Icon(Icons.Filled.ArrowDropDown, null) },
        )
        OutlinedTextField(
            value = number, onValueChange = onNumber, singleLine = true,
            textStyle = LocalTextStyleBig(),
            placeholder = { Text("Numéro (ex. 0470 12 34 56 ou +221 77…)") },
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone),
            trailingIcon = {
                IconButton(onClick = {
                    contactLauncher.launch(Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI))
                }) { Icon(Icons.Filled.Contacts, "Contacts") }
            },
            modifier = Modifier.fillMaxWidth().padding(top = 8.dp),
        )
        Box(Modifier.height(48.dp), contentAlignment = Alignment.Center) {
            if (parsed != null) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(
                        "${flagOf(parsed.region)} ${parsed.international} · ${parsed.typeLabel}" +
                            if (!parsed.valid) " ⚠ à vérifier" else "",
                        fontSize = 14.sp,
                    )
                    Text(
                        rate?.let { "${it.label} : ${formatMoney(it.perMin, prefs.currency)}/min (indicatif)" }
                            ?: "Tarif non renseigné (onglet Tarifs)",
                        fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
        Spacer(Modifier.weight(1f))
        Keypad(
            onKey = { onNumber(number + it) },
            onLong = { if (it == '0') onNumber(number + "+") },
        )
        Spacer(Modifier.height(12.dp))
        Row(verticalAlignment = Alignment.CenterVertically) {
            Spacer(Modifier.size(64.dp))
            Spacer(Modifier.width(24.dp))
            FilledIconButton(
                onClick = { onCall(number) }, enabled = parsed != null,
                modifier = Modifier.size(72.dp), shape = CircleShape,
                colors = IconButtonDefaults.filledIconButtonColors(containerColor = Green, contentColor = Color.White),
            ) { Icon(Icons.Filled.Call, "Appeler", Modifier.size(32.dp)) }
            Spacer(Modifier.width(24.dp))
            IconButton(onClick = { onNumber(number.dropLast(1)) }, modifier = Modifier.size(64.dp)) {
                Icon(Icons.Filled.Backspace, "Effacer")
            }
        }
        Spacer(Modifier.height(16.dp))
    }

    if (picker) {
        CountryPicker(onDismiss = { picker = false }) {
            region = it.region; prefs.region = it.region; picker = false
        }
    }
}

@Composable
private fun LocalTextStyleBig() = MaterialTheme.typography.headlineSmall.copy(textAlign = TextAlign.Center)

/** Lit le numéro choisi dans le sélecteur de contacts (aucune permission Contacts requise). */
private fun readPhoneNumber(ctx: android.content.Context, uri: Uri): String? = runCatching {
    ctx.contentResolver.query(uri, arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER), null, null, null)?.use { c ->
        if (c.moveToFirst()) c.getString(0) else null
    }
}.getOrNull()

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun Keypad(onKey: (Char) -> Unit, onLong: (Char) -> Unit) {
    val rows = listOf("123", "456", "789", "*0#")
    val sub = mapOf('2' to "ABC", '3' to "DEF", '4' to "GHI", '5' to "JKL", '6' to "MNO",
        '7' to "PQRS", '8' to "TUV", '9' to "WXYZ", '0' to "+")
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        rows.forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(22.dp)) {
                row.forEach { k ->
                    Surface(
                        shape = CircleShape, color = MaterialTheme.colorScheme.surfaceVariant,
                        modifier = Modifier.size(68.dp).clip(CircleShape)
                            .combinedClickable(onClick = { onKey(k) }, onLongClick = { onLong(k) }),
                    ) {
                        Column(verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                            Text(k.toString(), fontSize = 26.sp)
                            sub[k]?.let { Text(it, fontSize = 9.sp, color = MaterialTheme.colorScheme.onSurfaceVariant) }
                        }
                    }
                }
            }
        }
    }
}

@Composable
fun CountryPicker(onDismiss: () -> Unit, onPick: (Country) -> Unit) {
    var q by remember { mutableStateOf("") }
    val favorites = listOf("BE", "SN", "FR", "NL", "LU", "CI", "MA", "ML", "GN", "CM", "US", "GB")
    val list = remember(q) {
        val all = Phone.countries
        if (q.isBlank()) favorites.map { Phone.country(it) } + all.filter { it.region !in favorites }
        else all.filter { it.name.contains(q, true) || "+${it.code}".contains(q) || it.region.equals(q, true) }
    }
    AlertDialog(
        onDismissRequest = onDismiss,
        confirmButton = { TextButton(onClick = onDismiss) { Text("Fermer") } },
        title = { Text("Pays par défaut") },
        text = {
            Column {
                OutlinedTextField(q, { q = it }, singleLine = true, placeholder = { Text("Rechercher") },
                    modifier = Modifier.fillMaxWidth())
                LazyColumn(Modifier.heightIn(max = 420.dp)) {
                    items(list, key = { it.region }) { c ->
                        Text(
                            "${c.flag}  ${c.name}  +${c.code}",
                            modifier = Modifier.fillMaxWidth().clickable { onPick(c) }.padding(vertical = 12.dp),
                        )
                    }
                }
            }
        },
    )
}

// ---------------------------------------------------------------- Historique

@Composable
fun HistoryScreen(onRedial: (String) -> Unit) {
    val version by Sip.logsVersion.collectAsState()
    val prefs = Sip.prefs
    val logs = remember(version) { Sip.core.callLogs.toList() }
    val fmt = remember { SimpleDateFormat("dd/MM HH:mm", Locale.FRANCE) }
    val totalCost = remember(logs) {
        logs.filter { it.dir == org.linphone.core.Call.Dir.Outgoing && it.duration > 0 }.sumOf { log ->
            val p = Phone.parse(log.remoteAddress.username ?: "", prefs.region)
            val r = p?.let { prefs.rateFor(it.e164) }
            (r?.perMin ?: 0.0) * ((log.duration + 59) / 60)
        }
    }
    Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("Coût estimé total : ${formatMoney(totalCost, prefs.currency)}", modifier = Modifier.weight(1f))
            if (logs.isNotEmpty()) TextButton(onClick = { Sip.clearLogs() }) { Text("Effacer") }
        }
        if (logs.isEmpty()) {
            Text("Aucun appel pour l'instant.", Modifier.padding(16.dp), color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        LazyColumn {
            items(logs) { log ->
                val user = log.remoteAddress.username ?: ""
                val p = Phone.parse(user, prefs.region)
                val out = log.dir == org.linphone.core.Call.Dir.Outgoing
                ListItem(
                    leadingContent = {
                        Icon(
                            if (out) Icons.Filled.CallMade else Icons.Filled.CallReceived, null,
                            tint = if (log.duration > 0) Green else Red,
                        )
                    },
                    headlineContent = { Text("${flagOf(p?.region)} ${p?.international ?: user}") },
                    supportingContent = {
                        Text("${fmt.format(Date(log.startDate * 1000))} · ${formatDuration(log.duration)} · ${log.status.name}")
                    },
                    trailingContent = {
                        IconButton(onClick = { onRedial(p?.e164 ?: user) }) { Icon(Icons.Filled.Call, "Rappeler") }
                    },
                )
            }
        }
    }
}

// ---------------------------------------------------------------- Tarifs

@Composable
fun RatesScreen() {
    val prefs = Sip.prefs
    var rates by remember { mutableStateOf(prefs.rates.sortedBy { it.label }) }
    var editing by remember { mutableStateOf<Rate?>(null) }
    var adding by remember { mutableStateOf(false) }
    var currency by remember { mutableStateOf(prefs.currency) }

    fun save(list: List<Rate>) { prefs.rates = list; rates = list.sortedBy { it.label } }

    Column(Modifier.fillMaxSize()) {
        Text(
            "Tarifs par minute utilisés pour l'estimation. Copiez ceux de la grille de votre opérateur " +
                "(Telnyx, Zadarma…) : c'est lui qui facture. Préfixe = indicatif sans « + » (324 = mobiles belges).",
            fontSize = 13.sp, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(16.dp),
        )
        Row(Modifier.padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            OutlinedTextField(currency, { currency = it.take(3); prefs.currency = currency }, label = { Text("Devise") },
                singleLine = true, modifier = Modifier.width(110.dp))
            Spacer(Modifier.weight(1f))
            TextButton(onClick = { save(DEFAULT_RATES) }) { Text("Réinitialiser") }
            Button(onClick = { adding = true }) { Text("Ajouter") }
        }
        LazyColumn {
            items(rates, key = { it.prefix + it.label }) { r ->
                ListItem(
                    headlineContent = { Text(r.label) },
                    supportingContent = { Text("+${r.prefix}") },
                    trailingContent = { Text("${formatMoney(r.perMin, prefs.currency)}/min") },
                    modifier = Modifier.clickable { editing = r },
                )
            }
        }
    }
    val target = editing
    if (target != null || adding) {
        RateDialog(
            initial = target,
            onDismiss = { editing = null; adding = false },
            onDelete = target?.let { t -> { save(rates - t); editing = null } },
            onSave = { r ->
                save((if (target != null) rates - target else rates).filter { it.prefix != r.prefix } + r)
                editing = null; adding = false
            },
        )
    }
}

@Composable
private fun RateDialog(initial: Rate?, onDismiss: () -> Unit, onDelete: (() -> Unit)?, onSave: (Rate) -> Unit) {
    var prefix by remember { mutableStateOf(initial?.prefix ?: "") }
    var label by remember { mutableStateOf(initial?.label ?: "") }
    var price by remember { mutableStateOf(initial?.perMin?.toString() ?: "") }
    val value = price.replace(',', '.').toDoubleOrNull()
    val ok = prefix.isNotBlank() && prefix.all { it.isDigit() } && label.isNotBlank() && value != null
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(if (initial == null) "Nouveau tarif" else "Modifier le tarif") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(prefix, { prefix = it.filter(Char::isDigit) }, label = { Text("Préfixe (ex. 2217)") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true)
                OutlinedTextField(label, { label = it }, label = { Text("Libellé") }, singleLine = true)
                OutlinedTextField(price, { price = it }, label = { Text("Prix / minute") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal), singleLine = true)
            }
        },
        confirmButton = { TextButton(enabled = ok, onClick = { onSave(Rate(prefix, label.trim(), value!!)) }) { Text("Enregistrer") } },
        dismissButton = {
            Row {
                if (onDelete != null) TextButton(onClick = onDelete) { Text("Supprimer", color = Red) }
                TextButton(onClick = onDismiss) { Text("Annuler") }
            }
        },
    )
}

// ---------------------------------------------------------------- Compte SIP

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AccountScreen() {
    val ctx = LocalContext.current
    val prefs = Sip.prefs
    var cfg by remember { mutableStateOf(prefs.sip) }
    var showPwd by remember { mutableStateOf(false) }
    val reg by Sip.registration.collectAsState()
    val provider = PROVIDERS.firstOrNull { it.name == cfg.provider } ?: PROVIDERS.last()

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(10.dp),
    ) {
        Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)) {
            Text(
                (if (reg.ok) "✅ " else "⏳ ") + reg.label,
                Modifier.padding(12.dp), fontSize = 14.sp,
            )
        }

        Text("Opérateur SIP", fontWeight = FontWeight.SemiBold)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
            PROVIDERS.forEach { p ->
                FilterChip(
                    selected = cfg.provider == p.name,
                    onClick = {
                        cfg = cfg.copy(
                            provider = p.name, transport = p.transport, format = p.format,
                            domain = when {
                                p.domain.isNotBlank() -> p.domain
                                cfg.provider == p.name -> cfg.domain
                                else -> ""
                            },
                        )
                    },
                    label = { Text(p.name.substringBefore(" (")) },
                )
            }
        }
        Text(provider.note, fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant)

        OutlinedTextField(cfg.username, { cfg = cfg.copy(username = it) }, label = { Text("Identifiant SIP") },
            singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(
            cfg.password, { cfg = cfg.copy(password = it) }, label = { Text("Mot de passe SIP") }, singleLine = true,
            visualTransformation = if (showPwd) androidx.compose.ui.text.input.VisualTransformation.None else PasswordVisualTransformation(),
            trailingIcon = {
                IconButton(onClick = { showPwd = !showPwd }) {
                    Icon(if (showPwd) Icons.Filled.VisibilityOff else Icons.Filled.Visibility, null)
                }
            },
            modifier = Modifier.fillMaxWidth(),
        )
        OutlinedTextField(cfg.domain, { cfg = cfg.copy(domain = it.trim()) }, label = { Text("Domaine SIP") },
            singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(cfg.proxy, { cfg = cfg.copy(proxy = it.trim()) },
            label = { Text("Proxy sortant (optionnel, ex. sip.monpbx.com:5061)") },
            singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(cfg.authId, { cfg = cfg.copy(authId = it.trim()) },
            label = { Text("Auth ID (optionnel, si différent de l'identifiant)") },
            singleLine = true, modifier = Modifier.fillMaxWidth())

        Text("Transport", fontWeight = FontWeight.SemiBold)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Transport.entries.forEach { t ->
                FilterChip(selected = cfg.transport == t, onClick = { cfg = cfg.copy(transport = t) }, label = { Text(t.label) })
            }
        }
        Text("Format du numéro envoyé", fontWeight = FontWeight.SemiBold)
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.horizontalScroll(rememberScrollState())) {
            DialFormat.entries.forEach { f ->
                FilterChip(selected = cfg.format == f, onClick = { cfg = cfg.copy(format = f) }, label = { Text(f.label) })
            }
        }
        SwitchRow("Chiffrer la voix (SRTP) — exige le support opérateur", cfg.srtp) { cfg = cfg.copy(srtp = it) }
        SwitchRow("STUN (traversée NAT 4G / box)", cfg.stun) { cfg = cfg.copy(stun = it) }

        Button(
            onClick = {
                prefs.sip = cfg
                Sip.applyAccount(cfg)
                Toast.makeText(ctx, "Compte enregistré, connexion…", Toast.LENGTH_SHORT).show()
            },
            enabled = cfg.isComplete,
            modifier = Modifier.fillMaxWidth().height(52.dp),
            shape = RoundedCornerShape(12.dp),
        ) { Text("Enregistrer et se connecter") }

        Text(
            "Les identifiants sont chiffrés sur l'appareil (Android Keystore) et envoyés uniquement à votre opérateur SIP.",
            fontSize = 12.sp, color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun SwitchRow(label: String, checked: Boolean, onChange: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.fillMaxWidth()) {
        Text(label, Modifier.weight(1f), fontSize = 14.sp)
        Switch(checked, onChange)
    }
}
