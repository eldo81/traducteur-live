package com.dioneo.clavieria

import android.Manifest
import android.app.Activity
import android.content.ClipboardManager
import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Typeface
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
import android.view.Gravity
import android.view.View
import android.view.WindowInsets
import android.view.inputmethod.InputMethodManager
import android.widget.EditText
import android.widget.HorizontalScrollView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.SeekBar
import android.widget.Switch
import android.widget.TextView

/** Écran d'installation et de réglages (icône « Clavier IA »). */
class SettingsActivity : Activity() {
    private lateinit var prefs: Prefs
    private lateinit var col: LinearLayout
    private lateinit var stEnabled: TextView
    private lateinit var stSelected: TextView
    private lateinit var stMic: TextView
    private lateinit var keyStatus: TextView
    private lateinit var keyEdit: EditText
    private lateinit var modelEdit: EditText
    private var ai: AiClient? = null

    private val cBg = 0xFF121214.toInt()
    private val cCard = 0xFF1D1D20.toInt()
    private val cField = 0xFF2A2A2E.toInt()
    private val cText = 0xFFF2F2F5.toInt()
    private val cSub = 0xFF9A9AA2.toInt()
    private val cAccent = 0xFF0A84FF.toInt()
    private val cOk = 0xFF34C759.toInt()
    private val cErr = 0xFFFF453A.toInt()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        prefs = Prefs(this)
        val scroll = ScrollView(this).apply { setBackgroundColor(cBg); isFillViewport = true }
        col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(dp(18), dp(14), dp(18), dp(40)) }
        scroll.addView(col)
        setContentView(scroll)
        scroll.setOnApplyWindowInsetsListener { v, insets ->
            if (Build.VERSION.SDK_INT >= 30) {
                val b = insets.getInsets(WindowInsets.Type.systemBars() or WindowInsets.Type.ime())
                v.setPadding(b.left, b.top, b.right, b.bottom)
            } else {
                @Suppress("DEPRECATION")
                v.setPadding(insets.systemWindowInsetLeft, insets.systemWindowInsetTop, insets.systemWindowInsetRight, insets.systemWindowInsetBottom)
            }
            insets
        }
        build()
        if (intent?.getBooleanExtra("ask_mic", false) == true) askMic()
    }

    override fun onResume() {
        super.onResume()
        refreshStatus()
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) refreshStatus()
    }

    override fun onPause() {
        super.onPause()
        if (this::modelEdit.isInitialized) prefs.model = modelEdit.text.toString()
    }

    // ------------------------------------------------------------------
    private fun build() {
        col.addView(TextView(this).apply {
            text = "Clavier IA"
            textSize = 30f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(cText)
        })
        col.addView(sub("Le clavier façon iPhone, avec correction, reformulation, résumé, traduction instantanée et assistant de rédaction intégrés."))

        // 1. Activation
        val c1 = card("1 · Activer le clavier")
        stEnabled = line()
        stSelected = line()
        c1.addView(stEnabled)
        c1.addView(stSelected)
        c1.addView(buttons(
            "Activer" to { startActivity(Intent(Settings.ACTION_INPUT_METHOD_SETTINGS)) },
            "Choisir Clavier IA" to { getSystemService(InputMethodManager::class.java)?.showInputMethodPicker() },
        ))
        c1.addView(sub("Android affiche un avertissement standard (« ce clavier peut collecter le texte saisi ») pour tout clavier tiers. Clavier IA n'envoie rien, sauf quand vous touchez un bouton IA."))

        // 2. Clé API
        val c2 = card("2 · Clé API OpenAI (pour l'IA)")
        keyEdit = edit("sk-proj-…", prefs.apiKey, password = true)
        c2.addView(keyEdit)
        modelEdit = edit("Modèle (vide = choix automatique du meilleur « mini »)", prefs.model, password = false)
        c2.addView(modelEdit)
        c2.addView(buttons(
            "Coller" to {
                val cm = getSystemService(ClipboardManager::class.java)
                val t = cm?.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(this)?.toString()?.trim()
                if (!t.isNullOrEmpty()) keyEdit.setText(t)
            },
            "Enregistrer et tester" to { saveAndTest() },
        ))
        keyStatus = line()
        c2.addView(keyStatus)
        c2.addView(sub("Créez la clé sur platform.openai.com → API keys. Mettez un crédit prépayé avec la recharge automatique désactivée : c'est un plafond de dépense réel. Une correction ou une traduction coûte en général moins de 0,001 $."))
        c2.addView(buttons("Ouvrir platform.openai.com" to {
            try { startActivity(Intent(Intent.ACTION_VIEW, Uri.parse("https://platform.openai.com/api-keys"))) } catch (_: Exception) {}
        }))

        // 3. Micro
        val c3 = card("3 · Dictée vocale")
        stMic = line()
        c3.addView(stMic)
        c3.addView(buttons("Autoriser le micro" to { askMic() }))

        // Saisie
        val c4 = card("Frappe (comme sur iPhone)")
        c4.addView(label("Retour haptique"))
        c4.addView(chips(listOf("0" to "Aucun", "1" to "Léger", "2" to "Moyen", "3" to "Fort"), prefs.haptic.toString()) {
            prefs.haptic = it.toInt()
            Feedback(this).preview(prefs.haptic)
        })
        c4.addView(toggle("Son des touches", prefs.sound) { prefs.sound = it })
        c4.addView(toggle("Bulle d'aperçu des lettres", prefs.preview) { prefs.preview = it })
        c4.addView(toggle("Zone de frappe intelligente (vise la lettre probable)", prefs.smartTouch) { prefs.smartTouch = it })
        c4.addView(toggle("Correction automatique (⌫ juste après pour annuler)", prefs.autoCorrect) { prefs.autoCorrect = it })
        c4.addView(toggle("Suggestions et mot suivant", prefs.suggestions) { prefs.suggestions = it })
        c4.addView(toggle("Majuscule automatique", prefs.autoCap) { prefs.autoCap = it })
        c4.addView(toggle("Double espace → point", prefs.doubleSpace) { prefs.doubleSpace = it })
        c4.addView(toggle("Historique du presse-papiers", prefs.clipHistory) { prefs.clipHistory = it })
        c4.addView(label("Disposition (appui long sur 😀 pour basculer)"))
        c4.addView(chips(listOf("fr" to "Français · AZERTY", "en" to "English · QWERTY"), prefs.lang) { prefs.lang = it })

        // Apparence
        val c5 = card("Apparence")
        c5.addView(chips(Themes.list.mapIndexed { i, t -> i.toString() to t.name }, prefs.theme.toString()) { prefs.theme = it.toInt() })
        val hLabel = label("Hauteur des touches : ${prefs.heightPct} %")
        c5.addView(hLabel)
        c5.addView(SeekBar(this).apply {
            max = 50
            progress = prefs.heightPct - 80
            setOnSeekBarChangeListener(object : SeekBar.OnSeekBarChangeListener {
                override fun onProgressChanged(s: SeekBar?, p: Int, fromUser: Boolean) {
                    hLabel.text = "Hauteur des touches : ${p + 80} %"
                    if (fromUser) prefs.heightPct = p + 80
                }
                override fun onStartTrackingTouch(s: SeekBar?) {}
                override fun onStopTrackingTouch(s: SeekBar?) {}
            })
        })

        // Traduction
        val c6 = card("Traduction")
        c6.addView(label("Langue cible par défaut"))
        c6.addView(chips(Prompts.LANGS.map { it.code to it.label }, prefs.target) { prefs.target = it })

        // Essai
        val c7 = card("Essayer ici")
        c7.addView(EditText(this).apply {
            hint = "Touchez ici, puis testez la frappe et la barre IA…"
            setHintTextColor(cSub)
            setTextColor(cText)
            minLines = 3
            gravity = Gravity.TOP
            background = round(cField, dp(12).toFloat())
            setPadding(dp(12), dp(10), dp(12), dp(10))
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_MULTI_LINE or InputType.TYPE_TEXT_FLAG_CAP_SENTENCES
        }, LinearLayout.LayoutParams(MATCH, WRAP))

        // Mode d'emploi
        val c8 = card("Mode d'emploi express")
        c8.addView(sub(
            "• ✦ IA : écrivez une consigne (« réponds que je valide le devis ») → ↵ → Insérer.\n" +
                "• ✓ Corriger, ✎ Reformuler, ≡ Résumer : agissent sur la sélection, sinon sur tout le champ → Remplacer.\n" +
                "• 文A Traduire : tapez dans la zone du traducteur, la traduction s'affiche en direct ; ↵ l'insère. « Traduire le champ » traduit le texte déjà écrit.\n" +
                "• Appui long sur une lettre : accents (é è ê ë…). Appui long sur ’ : , . ? ! « ».\n" +
                "• Glissez le doigt sur la barre d'espace (ou appui long) : déplacer le curseur.\n" +
                "• Double appui sur ⇧ : verrouillage majuscules. Double espace : point.\n" +
                "• ⌫ juste après une correction automatique : retour au mot tapé.\n" +
                "• Appui long sur 😀 : AZERTY ⇄ QWERTY. 🎤 : dictée vocale."
        ))
        col.addView(sub("Confidentialité : le dictionnaire personnel, l'historique du presse-papiers et la clé restent sur le téléphone. Le texte n'est envoyé à OpenAI (api.openai.com) que lorsque vous touchez un bouton IA. L'IA est désactivée dans les champs de mot de passe.").apply { setPadding(dp(4), dp(18), dp(4), 0) })
    }

    // ------------------------------------------------------------------
    private fun refreshStatus() {
        if (!this::stEnabled.isInitialized) return
        val imm = getSystemService(InputMethodManager::class.java)
        val me = ComponentName(this, ClavierService::class.java)
        val enabled = imm?.enabledInputMethodList?.any { it.component == me } == true
        val current = Settings.Secure.getString(contentResolver, Settings.Secure.DEFAULT_INPUT_METHOD)
        val selected = current != null && ComponentName.unflattenFromString(current) == me
        status(stEnabled, enabled, "Clavier IA activé", "Clavier IA pas encore activé → « Activer »")
        status(stSelected, selected, "Clavier IA est le clavier actuel", "Pas sélectionné → « Choisir Clavier IA »")
        val mic = checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED
        status(stMic, mic, "Micro autorisé", "Micro non autorisé")
        if (keyStatus.text.isNullOrEmpty()) {
            if (prefs.apiKey.isBlank()) { keyStatus.text = "Aucune clé enregistrée : les fonctions IA sont inactives."; keyStatus.setTextColor(cSub) }
            else { keyStatus.text = "Clé enregistrée" + (prefs.autoModel.takeIf { it.isNotBlank() }?.let { " · modèle $it" } ?: ""); keyStatus.setTextColor(cOk) }
        }
    }

    private fun status(tv: TextView, ok: Boolean, yes: String, no: String) {
        tv.text = if (ok) "✓ $yes" else "○ $no"
        tv.setTextColor(if (ok) cOk else cSub)
    }

    private fun saveAndTest() {
        prefs.apiKey = keyEdit.text.toString()
        prefs.model = modelEdit.text.toString()
        prefs.autoModel = ""
        prefs.streamOk = true
        if (prefs.apiKey.isBlank()) { keyStatus.text = "Collez d'abord votre clé."; keyStatus.setTextColor(cErr); return }
        keyStatus.text = "Test en cours…"
        keyStatus.setTextColor(cSub)
        val client = ai ?: AiClient(prefs).also { ai = it }
        client.run("Reply with exactly: OK", "ping", {}, { _, model ->
            keyStatus.text = "✓ Clé valide · modèle utilisé : $model"
            keyStatus.setTextColor(cOk)
        }, { msg ->
            keyStatus.text = "✗ $msg"
            keyStatus.setTextColor(cErr)
        })
    }

    private fun askMic() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) { refreshStatus(); return }
        if (!shouldShowRequestPermissionRationale(Manifest.permission.RECORD_AUDIO) && prefs.sp.getBoolean("mic_asked", false)) {
            // Refus définitif : on ouvre la fiche de l'application
            startActivity(Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null)))
            return
        }
        prefs.sp.edit().putBoolean("mic_asked", true).apply()
        requestPermissions(arrayOf(Manifest.permission.RECORD_AUDIO), 7)
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        refreshStatus()
    }

    // ------------------------------------------------------------------
    private fun card(title: String): LinearLayout {
        val c = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            background = round(cCard, dp(16).toFloat())
            setPadding(dp(14), dp(12), dp(14), dp(14))
        }
        c.addView(TextView(this).apply {
            text = title
            textSize = 17f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(cText)
            setPadding(0, 0, 0, dp(6))
        })
        col.addView(c, LinearLayout.LayoutParams(MATCH, WRAP).apply { topMargin = dp(14) })
        return c
    }

    private fun sub(t: String) = TextView(this).apply {
        text = t
        textSize = 13.5f
        setTextColor(cSub)
        setPadding(0, dp(6), 0, dp(2))
        setLineSpacing(0f, 1.15f)
    }

    private fun label(t: String) = TextView(this).apply {
        text = t
        textSize = 14.5f
        setTextColor(cText)
        setPadding(0, dp(10), 0, dp(6))
    }

    private fun line() = TextView(this).apply {
        textSize = 15f
        setTextColor(cSub)
        setPadding(0, dp(3), 0, dp(3))
    }

    private fun edit(hintText: String, value: String, password: Boolean) = EditText(this).apply {
        hint = hintText
        setText(value)
        setHintTextColor(cSub)
        setTextColor(cText)
        textSize = 15f
        isSingleLine = true
        background = round(cField, dp(12).toFloat())
        setPadding(dp(12), dp(11), dp(12), dp(11))
        inputType = if (password) InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        else InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_FLAG_NO_SUGGESTIONS
        layoutParams = LinearLayout.LayoutParams(MATCH, WRAP).apply { topMargin = dp(8) }
    }

    private fun buttons(vararg items: Pair<String, () -> Unit>): View {
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(0, dp(10), 0, dp(2)) }
        items.forEachIndexed { i, (t, action) ->
            row.addView(TextView(this).apply {
                text = t
                textSize = 14.5f
                gravity = Gravity.CENTER
                typeface = Typeface.DEFAULT_BOLD
                setTextColor(if (i == items.size - 1) 0xFFFFFFFF.toInt() else cText)
                background = round(if (i == items.size - 1) cAccent else cField, dp(20).toFloat())
                setPadding(dp(14), dp(10), dp(14), dp(10))
                setOnClickListener { action() }
            }, LinearLayout.LayoutParams(0, WRAP, 1f).apply { if (i > 0) marginStart = dp(8) })
        }
        return row
    }

    private fun toggle(t: String, value: Boolean, onChange: (Boolean) -> Unit) = Switch(this).apply {
        text = t
        textSize = 15f
        setTextColor(cText)
        isChecked = value
        setPadding(0, dp(8), 0, dp(8))
        setOnCheckedChangeListener { _, b -> onChange(b) }
    }

    private fun chips(options: List<Pair<String, String>>, selected: String, onPick: (String) -> Unit): View {
        val hs = HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false }
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val views = ArrayList<Pair<String, TextView>>()
        fun style(tv: TextView, on: Boolean) {
            tv.setTextColor(if (on) 0xFFFFFFFF.toInt() else cText)
            tv.background = round(if (on) cAccent else cField, dp(18).toFloat())
        }
        for ((k, l) in options) {
            val tv = TextView(this).apply {
                text = l
                textSize = 14f
                setPadding(dp(14), dp(8), dp(14), dp(8))
            }
            style(tv, k == selected)
            tv.setOnClickListener {
                views.forEach { (kk, v) -> style(v, kk == k) }
                onPick(k)
            }
            views.add(k to tv)
            row.addView(tv, LinearLayout.LayoutParams(WRAP, WRAP).apply { marginEnd = dp(8) })
        }
        hs.addView(row)
        return hs
    }
}
