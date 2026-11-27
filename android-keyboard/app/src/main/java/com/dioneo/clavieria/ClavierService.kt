package com.dioneo.clavieria

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.inputmethodservice.InputMethodService
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.text.InputType
import android.text.TextUtils
import android.view.Gravity
import android.view.KeyEvent
import android.view.View
import android.view.WindowInsets
import android.view.inputmethod.EditorInfo
import android.view.inputmethod.InputMethodManager
import android.widget.FrameLayout
import android.widget.HorizontalScrollView
import android.widget.ImageView
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import kotlin.math.abs
import kotlin.math.max

class ClavierService : InputMethodService(), KeyboardView.Listener {

    private enum class Ai { CORRECT, REPHRASE, SUMMARY, TRANSLATE, ASSIST }

    private lateinit var prefs: Prefs
    private lateinit var feedback: Feedback
    private lateinit var ai: AiClient
    private lateinit var dict: Dictionary
    private lateinit var clipboard: ClipboardManager
    private val main = Handler(Looper.getMainLooper())
    private var skin = Themes.get(0)
    private var builtTheme = -1
    private var builtHeight = -1
    private var builtLand = false
    private var numberField = false
    private lateinit var toolbar: View
    private val landscape get() = resources.configuration.orientation == Configuration.ORIENTATION_LANDSCAPE

    private var root: LinearLayout? = null
    private lateinit var panelHost: FrameLayout
    private lateinit var strip: LinearLayout
    private lateinit var kbHost: FrameLayout
    private lateinit var kb: KeyboardView
    private val stripViews = ArrayList<TextView>()
    private var overlay: View? = null

    private var sensitive = false
    private var noLearn = false
    private var lastSpaceAt = 0L
    private var autoShift = false
    private var prefix = ""
    private var correctionPreview: String? = null
    private var lastCorrection: Pair<String, String>? = null // (mot corrigé, mot tapé)

    private var aiMode: Ai? = null
    private var internal: StringBuilder? = null
    private var inputBox: TextView? = null
    private var resultBox: TextView? = null
    private var statusBox: TextView? = null
    private var actionsRow: LinearLayout? = null
    private var resultText = ""
    private var resultSource = ""
    private var resultFromField = false
    private var aiBusy = false
    private var insertWhenDone = false
    private var lastAction: (() -> Unit)? = null

    private var recognizer: SpeechRecognizer? = null
    private var voicePanel = false
    private var voiceBox: TextView? = null

    private val clipListener = ClipboardManager.OnPrimaryClipChangedListener { onClipChanged() }
    private val liveTranslate = Runnable { translateBuffer() }
    private val suggestRun = Runnable { updateSuggestions() }

    // =====================================================================
    // Cycle de vie
    // =====================================================================
    override fun onCreate() {
        super.onCreate()
        prefs = Prefs(this)
        feedback = Feedback(this)
        ai = AiClient(prefs)
        dict = Dictionary(this, prefs)
        Thread { try { dict.preload() } catch (_: Exception) {} }.start()
        clipboard = getSystemService(ClipboardManager::class.java)
        clipboard.addPrimaryClipChangedListener(clipListener)
    }

    override fun onDestroy() {
        clipboard.removePrimaryClipChangedListener(clipListener)
        releaseRecognizer()
        ai.cancel()
        dict.save()
        super.onDestroy()
    }

    override fun onEvaluateFullscreenMode(): Boolean = false

    override fun onCreateInputView(): View {
        skin = Themes.get(prefs.theme)
        builtTheme = prefs.theme
        builtHeight = prefs.heightPct
        builtLand = landscape
        val r = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(skin.bg)
            clipChildren = false
            clipToPadding = false
        }
        toolbar = buildToolbar()
        r.addView(toolbar, LinearLayout.LayoutParams(MATCH, dp(if (builtLand) 36 else 46)))
        panelHost = FrameLayout(this).apply { visibility = View.GONE; setBackgroundColor(skin.panel) }
        r.addView(panelHost, LinearLayout.LayoutParams(MATCH, WRAP))
        strip = buildStrip()
        r.addView(strip, LinearLayout.LayoutParams(MATCH, dp(if (builtLand) 32 else 44)))
        kbHost = FrameLayout(this).apply { clipChildren = false; clipToPadding = false }
        kb = KeyboardView(this, this).apply {
            skin = this@ClavierService.skin
            heightPct = prefs.heightPct
            compact = builtLand
        }
        kb.setLanguage(prefs.lang)
        kbHost.addView(kb, FrameLayout.LayoutParams(MATCH, WRAP))
        r.addView(kbHost, LinearLayout.LayoutParams(MATCH, WRAP))
        r.setOnApplyWindowInsetsListener { v, insets ->
            val b = if (Build.VERSION.SDK_INT >= 30) insets.getInsets(WindowInsets.Type.navigationBars()).bottom else 0
            v.setPadding(0, 0, 0, b)
            insets
        }
        root = r
        overlay = null
        aiMode = null
        internal = null
        voicePanel = false
        return r
    }

    override fun onStartInputView(info: EditorInfo, restarting: Boolean) {
        super.onStartInputView(info, restarting)
        if (root == null || prefs.theme != builtTheme || prefs.heightPct != builtHeight || landscape != builtLand) setInputView(onCreateInputView())
        sensitive = isSensitive(info)
        noLearn = sensitive || (info.imeOptions and EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING) != 0
        kb.smartTouch = prefs.smartTouch
        kb.showPreview = prefs.preview
        if (kb.language != prefs.lang) kb.setLanguage(prefs.lang)
        hideOverlay()
        closePanel()
        val cls = info.inputType and InputType.TYPE_MASK_CLASS
        // Montants, numéros, codes (Wave, Orange Money, banques) : pavé numérique grand format, sans barre IA
        numberField = cls == InputType.TYPE_CLASS_NUMBER || cls == InputType.TYPE_CLASS_PHONE || cls == InputType.TYPE_CLASS_DATETIME
        kb.numberField = numberField
        kb.phonePad = cls == InputType.TYPE_CLASS_PHONE
        if (numberField) kb.setMode(KMode.ALPHA)
        kb.setMode(if (numberField) KMode.NUM else KMode.ALPHA)
        toolbar.visibility = if (numberField || builtLand) View.GONE else View.VISIBLE
        strip.visibility = if (numberField) View.GONE else View.VISIBLE
        applyEnterKey(info)
        kb.setShift(Shift.OFF)
        lastCorrection = null
        refreshPrefix()
        updateShift()
        updateSuggestions()
    }

    override fun onFinishInputView(finishingInput: Boolean) {
        super.onFinishInputView(finishingInput)
        if (root != null) {
            kb.cancelAll()
            closePanel()
            hideOverlay()
        }
        dict.save()
    }

    override fun onUpdateSelection(oldSelStart: Int, oldSelEnd: Int, newSelStart: Int, newSelEnd: Int, candidatesStart: Int, candidatesEnd: Int) {
        super.onUpdateSelection(oldSelStart, oldSelEnd, newSelStart, newSelEnd, candidatesStart, candidatesEnd)
        if (root == null || internal != null) return
        // Curseur déplacé par l'utilisateur (et non par notre frappe) : on recalcule le contexte.
        if (abs(newSelStart - oldSelStart) > 1 || newSelStart != newSelEnd) {
            lastCorrection = null
            refreshPrefix()
        }
        updateShift()
        scheduleSuggestions()
    }

    // =====================================================================
    // Construction de l'interface
    // =====================================================================
    private fun buildToolbar(): LinearLayout {
        val t = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(6), dp(2), dp(6), 0)
        }
        // Bouton IA principal
        val pill = TextView(this).apply {
            text = "✦ IA"
            textSize = 14f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(0xFFFFFFFF.toInt())
            gravity = Gravity.CENTER
            setPadding(dp(12), 0, dp(12), 0)
            background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(skin.accent, 0xFF8E5CF7.toInt())).apply {
                cornerRadius = dp(15).toFloat()
            }
            contentDescription = "Assistant IA"
            setOnClickListener { feedback.tick(prefs); toggleAi(Ai.ASSIST) }
        }
        t.addView(pill, LinearLayout.LayoutParams(WRAP, dp(30)).apply { marginEnd = dp(4) })
        t.addView(toolButton(R.drawable.ic_spellcheck, "Corriger") { toggleAi(Ai.CORRECT) })
        t.addView(toolButton(R.drawable.ic_rephrase, "Reformuler") { toggleAi(Ai.REPHRASE) })
        t.addView(toolButton(R.drawable.ic_summary, "Résumer") { toggleAi(Ai.SUMMARY) })
        t.addView(toolButton(R.drawable.ic_translate, "Traduire") { toggleAi(Ai.TRANSLATE) })
        t.addView(toolButton(R.drawable.ic_mic, "Dictée vocale") { toggleVoice() })
        t.addView(toolButton(R.drawable.ic_clipboard, "Presse-papiers") { toggleClipboard() })
        t.addView(toolButton(R.drawable.ic_settings, "Réglages") { openSettings() })
        return t
    }

    private fun toolButton(icon: Int, desc: String, onClick: () -> Unit): View {
        val iv = ImageView(this).apply {
            setImageResource(icon)
            imageTintList = ColorStateList.valueOf(skin.modText)
            val pad = dp(7)
            setPadding(pad, pad, pad, pad)
            contentDescription = desc
            background = round(0, dp(17).toFloat())
        }
        val f = FrameLayout(this)
        f.addView(iv, FrameLayout.LayoutParams(dp(34), dp(34), Gravity.CENTER))
        f.setOnClickListener { feedback.tick(prefs); onClick() }
        f.layoutParams = LinearLayout.LayoutParams(0, MATCH, 1f)
        return f
    }

    private fun buildStrip(): LinearLayout {
        val s = LinearLayout(this).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(4), dp(4), dp(4), dp(4))
        }
        stripViews.clear()
        if (builtLand) {
            // Paysage : la barre IA est repliée ; ✦ la déplie ou la replie
            s.addView(TextView(this).apply {
                text = "✦"
                textSize = 17f
                gravity = Gravity.CENTER
                setTextColor(skin.onAccent)
                background = GradientDrawable(GradientDrawable.Orientation.TL_BR, intArrayOf(skin.accent, 0xFF8E5CF7.toInt())).apply { cornerRadius = dp(12).toFloat() }
                contentDescription = "Afficher la barre IA"
                setOnClickListener {
                    feedback.tick(prefs)
                    toolbar.visibility = if (toolbar.visibility == View.VISIBLE) View.GONE else View.VISIBLE
                }
            }, LinearLayout.LayoutParams(dp(40), MATCH).apply { marginEnd = dp(4) })
        }
        for (i in 0 until 3) {
            if (i > 0) s.addView(View(this).apply { setBackgroundColor((skin.hint and 0x00FFFFFF) or 0x55000000) }, LinearLayout.LayoutParams(dp(1), dp(22)))
            val tv = TextView(this).apply {
                gravity = Gravity.CENTER
                setTextColor(skin.text)
                textSize = if (builtLand) 15f else 17f
                isSingleLine = true
                ellipsize = TextUtils.TruncateAt.END
            }
            val idx = i
            tv.setOnClickListener { pickSuggestion(idx) }
            stripViews.add(tv)
            s.addView(tv, LinearLayout.LayoutParams(0, MATCH, 1f).apply { marginStart = dp(2); marginEnd = dp(2) })
        }
        return s
    }

    // =====================================================================
    // Frappe
    // =====================================================================
    override fun onKeyDown(type: KType) = feedback.key(type, prefs)
    override fun onTick() = feedback.tick(prefs)

    override fun onText(text: String) {
        val buf = internal
        if (buf != null) {
            buf.append(text)
            onInternalChanged()
            return
        }
        val ic = currentInputConnection ?: return
        lastCorrection = null
        val c = text[0]
        if (text.length == 1 && !c.isLetterOrDigit() && c != '-' && c != '’' && c != '\'') {
            learnCurrent()
            // « ok . » → « ok. » : la ponctuation forte se colle au mot si l'espace vient d'une suggestion
            if (c == '.' || c == ',') {
                val b = ic.getTextBeforeCursor(2, 0)
                if (b != null && b.length == 2 && b[1] == ' ' && b[0].isLetterOrDigit() && SystemClock.uptimeMillis() - lastSpaceAt > 0 && autoSpaceAfterPick) {
                    ic.deleteSurroundingText(1, 0)
                }
            }
        }
        autoSpaceAfterPick = false
        ic.commitText(text, 1)
        if (c.isLetter() || c == '-') prefix += text
        else if (c == '’' || c == '\'') prefix += text
        else prefix = ""
        if (!c.isLetter()) updateShift()
        scheduleSuggestions()
    }

    private var autoSpaceAfterPick = false

    override fun onBackspace(repeat: Int) {
        val buf = internal
        if (buf != null) {
            if (buf.isNotEmpty()) {
                if (repeat > 18) deleteWordIn(buf)
                else {
                    val cp = Character.codePointBefore(buf, buf.length)
                    buf.setLength(buf.length - Character.charCount(cp))
                }
            }
            onInternalChanged()
            return
        }
        val ic = currentInputConnection ?: return
        autoSpaceAfterPick = false
        // Annuler la correction automatique juste appliquée (comme sur iPhone)
        val lc = lastCorrection
        if (lc != null && repeat == 0) {
            lastCorrection = null
            val before = ic.getTextBeforeCursor(lc.first.length + 1, 0)?.toString()
            if (before == lc.first + " ") {
                ic.beginBatchEdit()
                ic.deleteSurroundingText(lc.first.length + 1, 0)
                ic.commitText(lc.second, 1)
                ic.endBatchEdit()
                dict.learn(lc.second, null) // l'utilisateur a refusé la correction : on retient son mot
                prefix = lc.second
                scheduleSuggestions()
                return
            }
        }
        val sel = ic.getSelectedText(0)
        if (!sel.isNullOrEmpty()) {
            ic.commitText("", 1)
        } else if (repeat > 18) {
            val before = ic.getTextBeforeCursor(64, 0)?.toString() ?: ""
            var i = before.length
            while (i > 0 && before[i - 1].isWhitespace()) i--
            while (i > 0 && !before[i - 1].isWhitespace()) i--
            val n = before.length - i
            if (n > 0) ic.deleteSurroundingText(n, 0) else sendDownUpKeyEvents(KeyEvent.KEYCODE_DEL)
        } else {
            val before = ic.getTextBeforeCursor(1, 0)
            if (before.isNullOrEmpty()) sendDownUpKeyEvents(KeyEvent.KEYCODE_DEL)
            else ic.deleteSurroundingTextInCodePoints(1, 0)
        }
        prefix = if (prefix.isNotEmpty()) prefix.dropLast(1) else ""
        if (prefix.isEmpty()) refreshPrefix()
        updateShift()
        scheduleSuggestions()
    }

    override fun onSpace() {
        val now = SystemClock.uptimeMillis()
        val buf = internal
        if (buf != null) {
            if (prefs.doubleSpace && now - lastSpaceAt < 650 && buf.length >= 2 && buf.last() == ' ' && buf[buf.length - 2].isLetterOrDigit()) {
                buf.setLength(buf.length - 1)
                buf.append(". ")
            } else buf.append(' ')
            lastSpaceAt = now
            onInternalChanged()
            return
        }
        val ic = currentInputConnection ?: return
        autoSpaceAfterPick = false
        // Double espace → « . » (point + espace + majuscule)
        if (prefs.doubleSpace && now - lastSpaceAt < 650) {
            val b = ic.getTextBeforeCursor(2, 0)
            if (b != null && b.length == 2 && b[1] == ' ' && b[0].isLetterOrDigit()) {
                ic.beginBatchEdit()
                ic.deleteSurroundingText(1, 0)
                ic.commitText(". ", 1)
                ic.endBatchEdit()
                lastSpaceAt = 0
                lastCorrection = null
                prefix = ""
                updateShift()
                scheduleSuggestions()
                return
            }
        }
        lastSpaceAt = now
        val word = currentWord()
        val prev = previousWord(word.length)
        // Correction automatique prudente
        if (prefs.autoCorrect && !noLearn && !sensitive && word.length >= 2) {
            val fix = dict.correction(word, prefs.lang)
            if (fix != null && fix != word) {
                ic.beginBatchEdit()
                ic.deleteSurroundingText(word.length, 0)
                ic.commitText("$fix ", 1)
                ic.endBatchEdit()
                lastCorrection = fix to word
                if (!noLearn) dict.learn(fix, prev)
                prefix = ""
                updateShift()
                scheduleSuggestions()
                return
            }
        }
        if (!noLearn && word.length >= 2) dict.learn(word, prev)
        lastCorrection = null
        ic.commitText(" ", 1)
        prefix = ""
        updateShift()
        scheduleSuggestions()
    }

    override fun onEnter() {
        if (internal != null) {
            when (aiMode) {
                Ai.TRANSLATE -> enterTranslate()
                Ai.ASSIST -> if (resultText.isNotEmpty() && !aiBusy) doInsert() else generateAssist()
                else -> {}
            }
            return
        }
        val ic = currentInputConnection ?: return
        learnCurrent()
        lastCorrection = null
        prefix = ""
        val ei = currentInputEditorInfo
        val action = ei.imeOptions and EditorInfo.IME_MASK_ACTION
        if ((ei.imeOptions and EditorInfo.IME_FLAG_NO_ENTER_ACTION) == 0 && action != EditorInfo.IME_ACTION_NONE && action != EditorInfo.IME_ACTION_UNSPECIFIED) {
            ic.performEditorAction(action)
        } else {
            sendKeyChar('\n')
        }
        updateShift()
        scheduleSuggestions()
    }

    override fun onShiftTapped(state: Shift) {
        autoShift = false
    }

    override fun onEmoji() = toggleEmoji()

    override fun onEmojiLongPress() {
        // Appui long sur 😀 : bascule FR (AZERTY) ⇄ EN (QWERTY)
        prefs.lang = if (prefs.lang == "fr") "en" else "fr"
        kb.setLanguage(prefs.lang)
        applyEnterKey(currentInputEditorInfo)
        feedback.preview(2)
    }

    override fun onCursorMove(steps: Int) {
        if (internal != null) return
        val code = if (steps > 0) KeyEvent.KEYCODE_DPAD_RIGHT else KeyEvent.KEYCODE_DPAD_LEFT
        repeat(abs(steps)) { sendDownUpKeyEvents(code) }
        lastCorrection = null
    }

    override fun onModeChanged(mode: KMode) {}

    override fun isLikely(letter: String): Boolean? {
        if (internal != null || prefix.isEmpty() || !letter[0].isLetter()) return null
        return dict.hasPrefix(prefix + letter, prefs.lang)
    }

    private fun deleteWordIn(b: StringBuilder) {
        var i = b.length
        while (i > 0 && b[i - 1].isWhitespace()) i--
        while (i > 0 && !b[i - 1].isWhitespace()) i--
        b.setLength(i)
    }

    private fun learnCurrent() {
        if (noLearn) return
        val w = currentWord()
        if (w.length >= 2) dict.learn(w, previousWord(w.length))
    }

    // =====================================================================
    // Contexte, majuscules, suggestions
    // =====================================================================
    private fun currentWord(): String {
        val ic = currentInputConnection ?: return ""
        val before = ic.getTextBeforeCursor(48, 0) ?: return ""
        var i = before.length
        while (i > 0 && (before[i - 1].isLetter() || before[i - 1] == '-')) i--
        return before.substring(i)
    }

    private fun previousWord(skip: Int): String? {
        val ic = currentInputConnection ?: return null
        val before = ic.getTextBeforeCursor(80, 0)?.toString() ?: return null
        val s = before.dropLast(skip).trimEnd()
        if (s.isEmpty() || !s.last().isLetter()) return null
        var i = s.length
        while (i > 0 && s[i - 1].isLetter()) i--
        return s.substring(i).lowercase()
    }

    private fun refreshPrefix() {
        prefix = if (internal == null) currentWord() else ""
    }

    private fun updateShift() {
        if (root == null) return
        if (kb.shift == Shift.LOCK) return
        val buf = internal
        val caps = if (buf != null) {
            prefs.autoCap && (buf.isEmpty() || Regex("[.!?]\\s+$").containsMatchIn(buf))
        } else {
            val ic = currentInputConnection
            val ei = currentInputEditorInfo
            prefs.autoCap && ic != null && ei != null &&
                (ei.inputType and InputType.TYPE_MASK_CLASS) == InputType.TYPE_CLASS_TEXT &&
                ic.getCursorCapsMode(ei.inputType) != 0
        }
        if (caps) {
            if (kb.shift == Shift.OFF) { kb.setShift(Shift.ONE); autoShift = true }
        } else if (kb.shift == Shift.ONE && autoShift) {
            kb.setShift(Shift.OFF)
        }
    }

    private fun scheduleSuggestions() {
        main.removeCallbacks(suggestRun)
        main.post(suggestRun)
    }

    private fun setStrip(slots: List<String>, highlight: Int = -1) {
        for (i in 0 until 3) {
            val tv = stripViews.getOrNull(i) ?: continue
            tv.text = slots.getOrElse(i) { "" }
            tv.typeface = if (i == highlight) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
            tv.background = if (i == highlight && tv.text.isNotEmpty()) round(skin.pill, dp(8).toFloat()) else null
        }
    }

    private fun updateSuggestions() {
        if (root == null) return
        correctionPreview = null
        val show = prefs.suggestions && !sensitive && internal == null && aiMode == null && overlay == null
        if (!show) { setStrip(emptyList()); return }
        val w = currentWord()
        if (w.isEmpty()) {
            // Prédiction du mot suivant (apprise de vos habitudes)
            val prev = previousWord(0)
            val next = if (prev != null) dict.next(prev) else emptyList()
            val caps = kb.shift != Shift.OFF
            val n = next.map { if (caps) it.replaceFirstChar { c -> c.uppercaseChar() } else it }
            setStrip(listOf(n.getOrElse(1) { "" }, n.getOrElse(0) { "" }, n.getOrElse(2) { "" }), if (n.isNotEmpty()) -1 else -1)
            return
        }
        val upper = w[0].isUpperCase()
        fun cap(s: String) = if (upper) s.replaceFirstChar { it.uppercaseChar() } else s
        val fix = if (prefs.autoCorrect && !noLearn) dict.correction(w, prefs.lang) else null
        val list = dict.suggest(w, prefs.lang, 3).map { cap(it) }.filter { it != fix }
        if (fix != null) {
            // iOS : « tapé » | correction qui sera appliquée à l'espace | autre suggestion
            correctionPreview = fix
            setStrip(listOf("«$w»", fix, list.getOrElse(0) { "" }), 1)
        } else {
            setStrip(listOf("«$w»", list.getOrElse(0) { "" }, list.getOrElse(1) { "" }), 1)
        }
    }

    private fun pickSuggestion(idx: Int) {
        val tv = stripViews.getOrNull(idx) ?: return
        var s = tv.text.toString()
        if (s.isEmpty()) return
        feedback.tick(prefs)
        val ic = currentInputConnection ?: return
        val literal = s.startsWith("«") && s.endsWith("»")
        if (literal) s = s.substring(1, s.length - 1)
        val w = currentWord()
        val prev = previousWord(w.length)
        ic.beginBatchEdit()
        if (w.isNotEmpty()) ic.deleteSurroundingText(w.length, 0)
        ic.commitText("$s ", 1)
        ic.endBatchEdit()
        if (!noLearn) dict.learn(s, prev)
        autoSpaceAfterPick = true
        lastCorrection = null
        prefix = ""
        lastSpaceAt = SystemClock.uptimeMillis()
        updateShift()
        scheduleSuggestions()
    }

    // =====================================================================
    // Panneaux IA
    // =====================================================================
    private fun toggleAi(mode: Ai) {
        if (aiMode == mode) closePanel() else openAi(mode)
    }

    private fun openAi(mode: Ai) {
        if (root == null) return
        if (sensitive) { flash("L'IA est désactivée dans les champs de mot de passe."); return }
        hideOverlay()
        releaseRecognizer()
        ai.cancel()
        if (prefs.apiKey.isBlank()) {
            showMessage("Ajoutez votre clé API OpenAI pour activer l'IA : correction, reformulation, résumé, traduction et assistant.", "Ouvrir les réglages") { openSettings() }
            return
        }
        aiMode = mode
        voicePanel = false
        resultText = ""
        resultSource = ""
        aiBusy = false
        insertWhenDone = false
        lastAction = null
        internal = if (mode == Ai.TRANSLATE || mode == Ai.ASSIST) StringBuilder() else null
        buildAiPanel(mode)
        kbHost.visibility = if (internal != null) View.VISIBLE else View.GONE
        strip.visibility = View.GONE
        when (mode) {
            Ai.CORRECT -> runOnField(Prompts.correct())
            Ai.REPHRASE -> runOnField(Prompts.rephrase(prefs.tone))
            Ai.SUMMARY -> runOnField(Prompts.summary(prefs.summary))
            Ai.TRANSLATE -> status(
                if (fieldText().first.isNotBlank()) "Tapez ici pour traduire en direct, ou touchez « Traduire le champ »."
                else "Tapez votre texte : la traduction s'affiche en direct. ↵ = insérer."
            )
            Ai.ASSIST -> status("Écrivez une consigne, ex. « réponds que je confirme le RDV de jeudi 10 h », puis ↵.")
        }
        kb.setShift(Shift.OFF)
        updateShift()
    }

    private fun closePanel() {
        main.removeCallbacks(liveTranslate)
        if (this::ai.isInitialized) ai.cancel()
        releaseRecognizer()
        aiMode = null
        internal = null
        inputBox = null
        resultBox = null
        statusBox = null
        actionsRow = null
        voiceBox = null
        voicePanel = false
        aiBusy = false
        if (root != null) {
            panelHost.removeAllViews()
            panelHost.visibility = View.GONE
            kbHost.visibility = View.VISIBLE
            strip.visibility = if (numberField) View.GONE else View.VISIBLE
            kb.setShift(Shift.OFF)
            refreshPrefix()
            updateShift()
            scheduleSuggestions()
        }
    }

    private fun panelColumn(title: String): LinearLayout {
        panelHost.removeAllViews()
        val col = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(10), dp(4), dp(10), dp(8))
        }
        val head = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        head.addView(TextView(this).apply {
            text = title
            textSize = 15f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(skin.panelText)
        }, LinearLayout.LayoutParams(0, WRAP, 1f))
        head.addView(ImageView(this).apply {
            setImageResource(R.drawable.ic_close)
            imageTintList = ColorStateList.valueOf(skin.panelText)
            setPadding(dp(8), dp(8), dp(8), dp(8))
            contentDescription = "Fermer"
            setOnClickListener { feedback.tick(prefs); closePanel() }
        }, LinearLayout.LayoutParams(dp(38), dp(38)))
        col.addView(head)
        panelHost.addView(col, FrameLayout.LayoutParams(MATCH, WRAP))
        panelHost.visibility = View.VISIBLE
        return col
    }

    private fun buildAiPanel(mode: Ai) {
        val title = when (mode) {
            Ai.CORRECT -> "Correction orthographe & grammaire"
            Ai.REPHRASE -> "Reformuler"
            Ai.SUMMARY -> "Résumer"
            Ai.TRANSLATE -> "Traducteur"
            Ai.ASSIST -> "✦ Assistant IA"
        }
        val col = panelColumn(title)
        val chips: List<Pair<String, String>> = when (mode) {
            Ai.REPHRASE -> Prompts.TONES.map { it.key to it.value }
            Ai.SUMMARY -> Prompts.SUMMARIES.map { it.key to it.value }
            Ai.TRANSLATE -> listOf("@field" to "⇪ Traduire le champ") + Prompts.LANGS.map { it.code to it.label }
            Ai.ASSIST -> Prompts.ASSIST
            Ai.CORRECT -> emptyList()
        }
        val selected = when (mode) {
            Ai.REPHRASE -> prefs.tone
            Ai.SUMMARY -> prefs.summary
            Ai.TRANSLATE -> prefs.target
            else -> ""
        }
        if (chips.isNotEmpty()) col.addView(chipRow(chips, selected) { onChip(mode, it) }, LinearLayout.LayoutParams(MATCH, WRAP).apply { bottomMargin = dp(6) })
        if (internal != null) {
            inputBox = TextView(this).apply {
                textSize = 16f
                setPadding(dp(12), dp(9), dp(12), dp(9))
                background = round(skin.field, dp(12).toFloat(), dp(1), skin.accent)
                maxLines = 3
                ellipsize = TextUtils.TruncateAt.START
            }
            col.addView(inputBox, LinearLayout.LayoutParams(MATCH, WRAP).apply { bottomMargin = dp(6) })
        }
        val sc = ScrollView(this).apply { background = round(skin.field, dp(12).toFloat()) }
        resultBox = TextView(this).apply {
            textSize = 16f
            setTextColor(skin.panelText)
            setPadding(dp(12), dp(9), dp(12), dp(9))
            setTextIsSelectable(false)
        }
        sc.addView(resultBox)
        col.addView(sc, LinearLayout.LayoutParams(MATCH, dp(if (builtLand) (if (internal != null) 48 else 96) else if (internal != null) 78 else 176)))
        statusBox = TextView(this).apply {
            textSize = 12.5f
            setTextColor(skin.hint)
            setPadding(dp(4), dp(4), dp(4), dp(2))
            maxLines = 2
        }
        col.addView(statusBox)
        actionsRow = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.END or Gravity.CENTER_VERTICAL }
        col.addView(actionsRow, LinearLayout.LayoutParams(MATCH, WRAP).apply { topMargin = dp(4) })
        refreshInternal()
        renderActions()
    }

    private fun chipRow(options: List<Pair<String, String>>, selected: String, onPick: (String) -> Unit): View {
        val hs = HorizontalScrollView(this).apply { isHorizontalScrollBarEnabled = false }
        val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val views = ArrayList<Pair<String, TextView>>()
        fun style(tv: TextView, on: Boolean) {
            tv.setTextColor(if (on) skin.onAccent else skin.panelText)
            tv.background = round(if (on) skin.accent else skin.field, dp(16).toFloat())
        }
        for ((key, label) in options) {
            val tv = TextView(this).apply {
                text = label
                textSize = 13.5f
                isSingleLine = true
                setPadding(dp(12), dp(7), dp(12), dp(7))
            }
            style(tv, key == selected)
            tv.setOnClickListener {
                feedback.tick(prefs)
                if (!key.startsWith("@")) views.forEach { (k, v) -> style(v, k == key) }
                onPick(key)
            }
            views.add(key to tv)
            row.addView(tv, LinearLayout.LayoutParams(WRAP, WRAP).apply { marginEnd = dp(6) })
        }
        hs.addView(row)
        hs.post { views.firstOrNull { it.first == selected }?.second?.let { hs.scrollTo(max(0, it.left - dp(40)), 0) } }
        return hs
    }

    private fun onChip(mode: Ai, key: String) {
        when (mode) {
            Ai.REPHRASE -> { prefs.tone = key; runOnField(Prompts.rephrase(key)) }
            Ai.SUMMARY -> { prefs.summary = key; runOnField(Prompts.summary(key)) }
            Ai.TRANSLATE -> when {
                key == "@field" -> runOnField(Prompts.translate(prefs.target))
                else -> {
                    prefs.target = key
                    if (internal?.isNotBlank() == true) translateBuffer()
                    else if (resultFromField) runOnField(Prompts.translate(key))
                }
            }
            Ai.ASSIST -> assistChip(key)
            else -> {}
        }
    }

    /** (texte, est-ce une sélection ?) */
    private fun fieldText(): Pair<String, Boolean> {
        val ic = currentInputConnection ?: return "" to false
        val sel = ic.getSelectedText(0)
        if (!sel.isNullOrEmpty()) return sel.toString() to true
        val before = ic.getTextBeforeCursor(10000, 0) ?: ""
        val after = ic.getTextAfterCursor(10000, 0) ?: ""
        return (before.toString() + after.toString()) to false
    }

    private fun runOnField(system: String) {
        val (text, _) = fieldText()
        if (text.isBlank()) {
            status("Le champ est vide : écrivez (ou sélectionnez) d'abord un texte.")
            setResult("")
            return
        }
        resultFromField = true
        lastAction = { runOnField(system) }
        runAi(system, Prompts.wrap(text), text)
    }

    private fun translateBuffer() {
        val t = internal?.toString()?.trim() ?: return
        if (t.isEmpty()) return
        resultFromField = false
        lastAction = { translateBuffer() }
        runAi(Prompts.translate(prefs.target), Prompts.wrap(t), t)
    }

    private fun enterTranslate() {
        val t = internal?.toString()?.trim().orEmpty()
        if (t.isEmpty()) {
            if (resultText.isNotEmpty()) doInsert()
            return
        }
        if (!aiBusy && resultText.isNotEmpty() && resultSource == t) doInsert()
        else {
            main.removeCallbacks(liveTranslate)
            insertWhenDone = true
            translateBuffer()
        }
    }

    private fun generateAssist() {
        val instr = internal?.toString()?.trim().orEmpty()
        if (instr.isEmpty()) { status("Écrivez d'abord une consigne."); return }
        val ctx = fieldText().first.trim()
        val user = buildString {
            append("Consigne : ").append(instr)
            if (ctx.isNotEmpty()) append("\n\nTexte déjà présent dans le champ (contexte) :\n").append(ctx.take(4000))
        }
        resultFromField = false
        lastAction = { generateAssist() }
        runAi(Prompts.ASSISTANT, user, instr)
    }

    private fun assistChip(key: String) {
        val instr = internal?.toString()?.trim().orEmpty()
        when (key) {
            "@reply" -> {
                val clip = latestClip()
                if (clip.isBlank()) { status("Copiez d'abord le message reçu (appui long → Copier), puis touchez à nouveau."); return }
                val user = "Message reçu :\n" + Prompts.wrap(clip) + "\n\nMon intention : " + instr.ifEmpty { "réponse naturelle, adaptée et concise" }
                resultFromField = false
                lastAction = { assistChip(key) }
                runAi(Prompts.REPLY, user, clip)
            }
            "@email" -> {
                val (field, _) = fieldText()
                val src = field.ifBlank { instr }
                if (src.isBlank()) { status("Écrivez le contenu (dans le champ ou ici), puis touchez « En e-mail pro »."); return }
                resultFromField = field.isNotBlank()
                lastAction = { assistChip(key) }
                runAi(Prompts.transform(key), Prompts.wrap(src), src)
            }
            else -> runOnField(Prompts.transform(key))
        }
    }

    private fun runAi(system: String, user: String, source: String) {
        val mode = aiMode
        aiBusy = true
        resultText = ""
        resultSource = source.trim()
        setResult("…")
        status("L'IA écrit…")
        renderActions()
        ai.run(system, user,
            onDelta = { t -> if (aiMode == mode) setResult(t) },
            onDone = { t, model ->
                if (aiMode == mode) {
                    aiBusy = false
                    resultText = Prompts.clean(t, source)
                    setResult(resultText)
                    status("✓ Prêt · $model")
                    renderActions()
                    if (insertWhenDone) { insertWhenDone = false; if (resultText.isNotEmpty()) doInsert() }
                }
            },
            onError = { msg ->
                if (aiMode == mode) {
                    aiBusy = false
                    insertWhenDone = false
                    setResult("")
                    status("⚠ $msg")
                    renderActions()
                }
            })
    }

    private fun setResult(t: String) {
        resultBox?.text = t
    }

    private fun status(t: String) {
        if (voicePanel) voiceBox?.text = t else statusBox?.text = t
    }

    private fun pill(text: String, primary: Boolean, onClick: () -> Unit): TextView = TextView(this).apply {
        this.text = text
        textSize = 14f
        gravity = Gravity.CENTER
        typeface = if (primary) Typeface.DEFAULT_BOLD else Typeface.DEFAULT
        setPadding(dp(14), dp(8), dp(14), dp(8))
        setTextColor(if (primary) skin.onAccent else skin.panelText)
        background = round(if (primary) skin.accent else skin.field, dp(18).toFloat())
        setOnClickListener { feedback.tick(prefs); onClick() }
    }

    private fun renderActions() {
        val row = actionsRow ?: return
        row.removeAllViews()
        val lp = { LinearLayout.LayoutParams(WRAP, WRAP).apply { marginStart = dp(6) } }
        if (aiBusy) {
            row.addView(pill("Arrêter", false) { ai.cancel(); aiBusy = false; status("Arrêté."); renderActions() }, lp())
            return
        }
        if (resultText.isNotEmpty()) {
            if (lastAction != null) row.addView(pill("↻", false) { lastAction?.invoke() }, lp())
            row.addView(pill("Copier", false) { doCopy() }, lp())
            if (resultFromField) {
                row.addView(pill("Insérer", false) { doInsert() }, lp())
                row.addView(pill("Remplacer", true) { doReplace() }, lp())
            } else {
                row.addView(pill("Insérer ➤", true) { doInsert() }, lp())
            }
        } else if (aiMode == Ai.ASSIST) {
            row.addView(pill("Générer ✦", true) { generateAssist() }, lp())
        } else if (aiMode == Ai.TRANSLATE) {
            row.addView(pill("Traduire", true) { if (internal?.isNotBlank() == true) translateBuffer() else runOnField(Prompts.translate(prefs.target)) }, lp())
        } else if (lastAction != null) {
            row.addView(pill("↻ Réessayer", true) { lastAction?.invoke() }, lp())
        }
    }

    private fun doReplace() {
        val ic = currentInputConnection ?: return
        ic.beginBatchEdit()
        val sel = ic.getSelectedText(0)
        if (sel.isNullOrEmpty()) {
            val b = ic.getTextBeforeCursor(10000, 0)?.length ?: 0
            val a = ic.getTextAfterCursor(10000, 0)?.length ?: 0
            ic.deleteSurroundingText(b, a)
        }
        ic.commitText(resultText, 1)
        ic.endBatchEdit()
        afterApply("✓ Remplacé.")
    }

    private fun doInsert() {
        val ic = currentInputConnection ?: return
        val before = ic.getTextBeforeCursor(1, 0)
        val sep = if (!before.isNullOrEmpty() && !before[0].isWhitespace()) " " else ""
        ic.commitText(sep + resultText, 1)
        afterApply("✓ Inséré.")
    }

    private fun doCopy() {
        clipboard.setPrimaryClip(ClipData.newPlainText("Clavier IA", resultText))
        status("✓ Copié dans le presse-papiers.")
    }

    private fun afterApply(msg: String) {
        if (aiMode == Ai.TRANSLATE || aiMode == Ai.ASSIST) {
            internal?.setLength(0)
            resultText = ""
            resultSource = ""
            setResult("")
            refreshInternal()
            renderActions()
            status("$msg Tapez un nouveau texte, ou ✕ pour revenir au clavier.")
            updateShift()
        } else {
            closePanel()
            flash(msg)
        }
    }

    private fun onInternalChanged() {
        refreshInternal()
        updateShift()
        if (aiMode == Ai.TRANSLATE) {
            main.removeCallbacks(liveTranslate)
            if (internal?.isNotBlank() == true) main.postDelayed(liveTranslate, 700)
        }
    }

    private fun refreshInternal() {
        val b = inputBox ?: return
        val s = internal?.toString() ?: ""
        if (s.isEmpty()) {
            b.text = if (aiMode == Ai.TRANSLATE) "Tapez ici le texte à traduire…" else "Votre consigne pour l'IA…"
            b.setTextColor(skin.hint)
        } else {
            b.text = "$s│"
            b.setTextColor(skin.panelText)
        }
    }

    private fun showMessage(text: String, button: String?, action: (() -> Unit)?) {
        if (root == null) return
        closePanel()
        val col = panelColumn("Clavier IA")
        col.addView(TextView(this).apply {
            this.text = text
            textSize = 15f
            setTextColor(skin.panelText)
            setPadding(dp(4), dp(2), dp(4), dp(8))
        })
        if (button != null && action != null) {
            val row = LinearLayout(this).apply { gravity = Gravity.END }
            row.addView(pill(button, true) { closePanel(); action() })
            col.addView(row, LinearLayout.LayoutParams(MATCH, WRAP))
        }
        strip.visibility = View.GONE
    }

    private fun flash(text: String) {
        if (root == null) return
        val tv = stripViews.getOrNull(1) ?: return
        setStrip(listOf("", text, ""))
        tv.typeface = Typeface.DEFAULT
        main.postDelayed({ scheduleSuggestions() }, 1800)
    }

    // =====================================================================
    // Emojis
    // =====================================================================
    private fun toggleEmoji() {
        if (overlay?.tag == "emoji") hideOverlay() else { closePanel(); showOverlay(buildEmojiView(), "emoji") }
    }

    private fun showOverlay(v: View, tag: String) {
        hideOverlay()
        kb.cancelAll()
        kb.visibility = View.INVISIBLE
        v.tag = tag
        kbHost.addView(v, FrameLayout.LayoutParams(MATCH, MATCH))
        overlay = v
        updateSuggestions()
    }

    private fun hideOverlay() {
        val o = overlay ?: return
        kbHost.removeView(o)
        overlay = null
        kb.visibility = View.VISIBLE
        scheduleSuggestions()
    }

    private fun buildEmojiView(): View {
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(skin.bg) }
        val tabs = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val scroll = ScrollView(this)
        val grid = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        scroll.addView(grid)
        val cats = listOf("🕘" to prefs.recentEmoji().joinToString(" ")) + Emojis.CATEGORIES
        val tabViews = ArrayList<TextView>()
        fun fill(i: Int) {
            grid.removeAllViews()
            tabViews.forEachIndexed { j, t -> t.background = if (j == i) round(skin.pill, dp(8).toFloat()) else null }
            val list = cats[i].second.split(" ").filter { it.isNotBlank() }
            if (list.isEmpty()) {
                grid.addView(TextView(this).apply {
                    text = "Vos emojis récents apparaîtront ici."
                    setTextColor(skin.hint)
                    setPadding(dp(16), dp(16), dp(16), dp(16))
                })
                return
            }
            list.chunked(8).forEach { chunk ->
                val row = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
                for (e in chunk) {
                    row.addView(TextView(this).apply {
                        text = e
                        textSize = 26f
                        gravity = Gravity.CENTER
                        setOnClickListener {
                            feedback.key(KType.CHAR, prefs)
                            onText(e)
                            prefs.addRecentEmoji(e)
                        }
                    }, LinearLayout.LayoutParams(0, dp(46), 1f))
                }
                repeat(8 - chunk.size) { row.addView(View(this), LinearLayout.LayoutParams(0, dp(46), 1f)) }
                grid.addView(row)
            }
            scroll.scrollTo(0, 0)
        }
        cats.forEachIndexed { i, (icon, _) ->
            val t = TextView(this).apply {
                text = icon
                textSize = 18f
                gravity = Gravity.CENTER
                setOnClickListener { feedback.tick(prefs); fill(i) }
            }
            tabViews.add(t)
            tabs.addView(t, LinearLayout.LayoutParams(0, dp(36), 1f))
        }
        col.addView(tabs, LinearLayout.LayoutParams(MATCH, WRAP))
        col.addView(scroll, LinearLayout.LayoutParams(MATCH, 0, 1f))
        val bottom = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; setPadding(dp(4), dp(4), dp(4), dp(6)) }
        fun key(label: String, weight: Float, onClick: () -> Unit) = TextView(this).apply {
            text = label
            textSize = 16f
            gravity = Gravity.CENTER
            setTextColor(skin.modText)
            background = round(skin.modBottom, dp(skin.radiusDp.toInt()).toFloat())
            setOnClickListener { feedback.key(KType.SPACE, prefs); onClick() }
            layoutParams = LinearLayout.LayoutParams(0, dp(42), weight).apply { marginStart = dp(3); marginEnd = dp(3) }
        }
        bottom.addView(key("ABC", 1.3f) { hideOverlay() })
        bottom.addView(key("espace", 5f) { onSpace() }.apply { setTextColor(skin.text); background = round(skin.keyBottom, dp(skin.radiusDp.toInt()).toFloat()) })
        bottom.addView(key("⌫", 1.3f) { onBackspace(0) })
        col.addView(bottom, LinearLayout.LayoutParams(MATCH, WRAP))
        fill(if (prefs.recentEmoji().isEmpty()) 1 else 0)
        return col
    }

    // =====================================================================
    // Presse-papiers
    // =====================================================================
    private fun onClipChanged() {
        if (!prefs.clipHistory) return
        try {
            val desc = clipboard.primaryClipDescription
            if (desc?.extras?.getBoolean("android.content.extra.IS_SENSITIVE", false) == true) return
            val clip = clipboard.primaryClip ?: return
            if (clip.itemCount == 0) return
            val t = clip.getItemAt(0).coerceToText(this)?.toString() ?: return
            prefs.addClip(t)
        } catch (_: Exception) {
        }
    }

    private fun latestClip(): String {
        val live = try {
            clipboard.primaryClip?.takeIf { it.itemCount > 0 }?.getItemAt(0)?.coerceToText(this)?.toString()
        } catch (_: Exception) { null }
        return live?.takeIf { it.isNotBlank() } ?: prefs.clips().firstOrNull().orEmpty()
    }

    private fun toggleClipboard() {
        if (overlay?.tag == "clip") { hideOverlay(); return }
        closePanel()
        showOverlay(buildClipView(), "clip")
    }

    private fun buildClipView(): View {
        val col = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setBackgroundColor(skin.panel); setPadding(dp(8), dp(4), dp(8), dp(6)) }
        val head = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL; gravity = Gravity.CENTER_VERTICAL }
        head.addView(TextView(this).apply {
            text = "Presse-papiers"
            textSize = 15f
            typeface = Typeface.DEFAULT_BOLD
            setTextColor(skin.panelText)
        }, LinearLayout.LayoutParams(0, WRAP, 1f))
        val list = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        fun render() {
            list.removeAllViews()
            val clips = prefs.clips()
            if (!prefs.clipHistory) {
                list.addView(TextView(this).apply { text = "Historique désactivé dans les réglages."; setTextColor(skin.hint); setPadding(dp(8), dp(12), dp(8), dp(12)) })
                return
            }
            if (clips.isEmpty()) {
                list.addView(TextView(this).apply {
                    text = "Rien de copié pour l'instant. Copiez un texte : il apparaîtra ici.\nAppui = coller · appui long = supprimer."
                    setTextColor(skin.hint)
                    setPadding(dp(8), dp(12), dp(8), dp(12))
                })
                return
            }
            for (c in clips) {
                list.addView(TextView(this).apply {
                    text = c
                    textSize = 15f
                    maxLines = 2
                    ellipsize = TextUtils.TruncateAt.END
                    setTextColor(skin.panelText)
                    setPadding(dp(12), dp(9), dp(12), dp(9))
                    background = round(skin.field, dp(10).toFloat())
                    setOnClickListener {
                        feedback.key(KType.CHAR, prefs)
                        val ic = currentInputConnection
                        if (ic != null) ic.commitText(c, 1)
                        hideOverlay()
                    }
                    setOnLongClickListener {
                        feedback.tick(prefs)
                        val l = prefs.clips(); l.remove(c); prefs.saveClips(l); render(); true
                    }
                }, LinearLayout.LayoutParams(MATCH, WRAP).apply { bottomMargin = dp(6) })
            }
        }
        head.addView(pill("Tout effacer", false) { prefs.saveClips(emptyList()); render() })
        head.addView(pill("ABC", true) { hideOverlay() }, LinearLayout.LayoutParams(WRAP, WRAP).apply { marginStart = dp(6) })
        col.addView(head, LinearLayout.LayoutParams(MATCH, WRAP).apply { bottomMargin = dp(6) })
        val sc = ScrollView(this)
        sc.addView(list)
        col.addView(sc, LinearLayout.LayoutParams(MATCH, 0, 1f))
        render()
        return col
    }

    // =====================================================================
    // Dictée vocale
    // =====================================================================
    private fun toggleVoice() {
        if (recognizer != null) {
            releaseRecognizer()
            if (voicePanel) closePanel() else status("Dictée arrêtée.")
            return
        }
        startVoice()
    }

    private fun startVoice() {
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
            showMessage("La dictée vocale a besoin de l'autorisation micro (une seule fois).", "Autoriser le micro") { openSettings(askMic = true) }
            return
        }
        if (!SpeechRecognizer.isRecognitionAvailable(this)) {
            showMessage("Aucun service de reconnaissance vocale sur ce téléphone. Installez ou activez l'application Google.", null, null)
            return
        }
        releaseRecognizer()
        hideOverlay()
        if (aiMode == null) showVoicePanel()
        val r = SpeechRecognizer.createSpeechRecognizer(this)
        recognizer = r
        r.setRecognitionListener(object : RecognitionListener {
            override fun onReadyForSpeech(params: Bundle?) { status("🎤 Parlez maintenant…") }
            override fun onBeginningOfSpeech() {}
            override fun onRmsChanged(rmsdB: Float) {}
            override fun onBufferReceived(buffer: ByteArray?) {}
            override fun onEndOfSpeech() { status("Transcription…") }
            override fun onError(error: Int) {
                val m = when (error) {
                    SpeechRecognizer.ERROR_NO_MATCH, SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "Rien entendu. Touchez 🎤 pour réessayer."
                    SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Autorisation micro manquante."
                    SpeechRecognizer.ERROR_NETWORK, SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Problème réseau."
                    else -> "Erreur de dictée ($error)."
                }
                releaseRecognizer()
                status("⚠ $m")
            }
            override fun onResults(results: Bundle?) {
                val t = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                releaseRecognizer()
                if (t.isNotBlank()) commitDictation(t)
                if (voicePanel) closePanel() else status("✓ Dicté.")
            }
            override fun onPartialResults(partialResults: Bundle?) {
                val t = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)?.firstOrNull().orEmpty()
                if (t.isNotBlank()) status("🎤 $t")
            }
            override fun onEvent(eventType: Int, params: Bundle?) {}
        })
        val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
            putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
            putExtra(RecognizerIntent.EXTRA_LANGUAGE, if (prefs.lang == "en") "en-US" else "fr-FR")
            putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
            putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, packageName)
        }
        try {
            r.startListening(intent)
        } catch (e: Exception) {
            releaseRecognizer()
            status("⚠ Dictée indisponible : ${e.message}")
        }
    }

    private fun showVoicePanel() {
        val col = panelColumn("Dictée vocale · " + if (prefs.lang == "en") "English" else "Français")
        voiceBox = TextView(this).apply {
            text = "Préparation du micro…"
            textSize = 17f
            setTextColor(skin.panelText)
            setPadding(dp(4), dp(4), dp(4), dp(10))
        }
        col.addView(voiceBox)
        val row = LinearLayout(this).apply { gravity = Gravity.END }
        row.addView(pill("Arrêter", true) { releaseRecognizer(); closePanel() })
        col.addView(row, LinearLayout.LayoutParams(MATCH, WRAP))
        voicePanel = true
        strip.visibility = View.GONE
    }

    private fun releaseRecognizer() {
        val r = recognizer ?: return
        recognizer = null
        try { r.cancel() } catch (_: Exception) {}
        try { r.destroy() } catch (_: Exception) {}
    }

    private fun commitDictation(t: String) {
        val buf = internal
        if (buf != null) {
            if (buf.isNotEmpty() && !buf.last().isWhitespace()) buf.append(' ')
            buf.append(if (buf.isEmpty()) t.replaceFirstChar { it.uppercaseChar() } else t)
            onInternalChanged()
            return
        }
        val ic = currentInputConnection ?: return
        val before = ic.getTextBeforeCursor(1, 0)
        val sep = if (!before.isNullOrEmpty() && !before[0].isWhitespace()) " " else ""
        val ei = currentInputEditorInfo
        val caps = ei != null && ic.getCursorCapsMode(ei.inputType) != 0
        ic.commitText(sep + (if (caps) t.replaceFirstChar { it.uppercaseChar() } else t), 1)
        prefix = ""
        updateShift()
    }

    // =====================================================================
    // Divers
    // =====================================================================
    private fun openSettings(askMic: Boolean = false) {
        val i = Intent(this, SettingsActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        if (askMic) i.putExtra("ask_mic", true)
        try {
            startActivity(i)
            requestHideSelf(0)
        } catch (_: Exception) {
        }
    }

    private fun isSensitive(ei: EditorInfo): Boolean {
        val cls = ei.inputType and InputType.TYPE_MASK_CLASS
        val v = ei.inputType and InputType.TYPE_MASK_VARIATION
        return (cls == InputType.TYPE_CLASS_TEXT && (v == InputType.TYPE_TEXT_VARIATION_PASSWORD ||
            v == InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD || v == InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD)) ||
            (cls == InputType.TYPE_CLASS_NUMBER && v == InputType.TYPE_NUMBER_VARIATION_PASSWORD)
    }

    private fun applyEnterKey(ei: EditorInfo?) {
        if (root == null) return
        val en = prefs.lang == "en"
        val action = if (ei == null || (ei.imeOptions and EditorInfo.IME_FLAG_NO_ENTER_ACTION) != 0) EditorInfo.IME_ACTION_NONE
        else ei.imeOptions and EditorInfo.IME_MASK_ACTION
        val (label, accent) = when (action) {
            EditorInfo.IME_ACTION_SEARCH -> (if (en) "search" else "rechercher") to true
            EditorInfo.IME_ACTION_SEND -> (if (en) "send" else "envoyer") to true
            EditorInfo.IME_ACTION_GO -> (if (en) "go" else "aller") to true
            EditorInfo.IME_ACTION_NEXT -> (if (en) "next" else "suivant") to false
            EditorInfo.IME_ACTION_DONE -> (if (en) "done" else "OK") to true
            EditorInfo.IME_ACTION_PREVIOUS -> (if (en) "previous" else "précédent") to false
            else -> (if (en) "return" else "retour") to false
        }
        kb.enterLabel = label
        kb.enterAccent = accent
    }

    @Suppress("unused")
    private fun switchKeyboard() {
        getSystemService(InputMethodManager::class.java)?.showInputMethodPicker()
    }
}
