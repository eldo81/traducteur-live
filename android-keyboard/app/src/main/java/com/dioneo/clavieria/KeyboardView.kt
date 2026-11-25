package com.dioneo.clavieria

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.LinearGradient
import android.graphics.Paint
import android.graphics.Path
import android.graphics.Shader
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import kotlin.math.abs
import kotlin.math.max
import kotlin.math.min

enum class Shift { OFF, ONE, LOCK }

/**
 * Clavier dessiné à la main, au comportement calqué sur l'iPhone :
 * - la lettre est validée au relâchement (on peut glisser vers la bonne touche) ;
 * - frappe rapide à plusieurs doigts (rollover) : un nouvel appui valide l'appui en cours ;
 * - bulle d'aperçu en forme de goutte au-dessus de la touche ;
 * - appui long : accents, glisser pour choisir ;
 * - appui long / glissé sur la barre d'espace : déplacement du curseur (trackpad) ;
 * - double appui sur Maj : verrouillage majuscules ;
 * - zone de frappe intelligente : entre deux lettres, la plus probable l'emporte.
 */
@SuppressLint("ViewConstructor")
class KeyboardView(context: Context, private val listener: Listener) : View(context) {

    interface Listener {
        fun onKeyDown(type: KType)
        fun onTick()
        fun onText(text: String)
        fun onBackspace(repeat: Int)
        fun onEnter()
        fun onSpace()
        fun onShiftTapped(state: Shift)
        fun onEmoji()
        fun onEmojiLongPress()
        fun onCursorMove(steps: Int)
        fun onModeChanged(mode: KMode)
        /** null = pas de contexte ; true/false = la lettre prolonge (ou non) un mot connu. */
        fun isLikely(letter: String): Boolean?
    }

    var skin: KbTheme = Themes.get(0)
        set(v) { field = v; layoutKeys(); invalidate() }
    var heightPct = 100
        set(v) { field = v; requestLayout() }
    var enterLabel = "retour"
        set(v) { field = v; invalidate() }
    var enterAccent = false
        set(v) { field = v; invalidate() }
    var smartTouch = true
    var showPreview = true
    var language = "fr"
        private set
    var mode = KMode.ALPHA
        private set
    var shift = Shift.OFF
        private set

    private var rows: List<KRow> = Layouts.alpha("fr")
    private val density = resources.displayMetrics.density
    private fun dp(v: Float) = v * density
    private val uiHandler = Handler(Looper.getMainLooper())

    private val rowH get() = dp(54f) * heightPct / 100f
    private val padTop get() = dp(4f)
    private val padBottom get() = dp(4f)
    private val padH get() = dp(3f)
    private val gapX get() = dp(6f)
    private val gapY get() = dp(11f) * heightPct / 100f

    // ---------- Peinture ----------
    private val keyPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val shadowPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val borderPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { style = Paint.Style.STROKE; strokeWidth = 1.2f }
    private val labelPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER }
    private val smallPaint = Paint(Paint.ANTI_ALIAS_FLAG).apply { textAlign = Paint.Align.CENTER }
    private val balloonPaint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val charShaders = ArrayList<Shader>()
    private val modShaders = ArrayList<Shader>()
    private val icons = HashMap<Int, Drawable>()
    private val balloonPath = Path()
    private val fontRegular: Typeface = Typeface.create("sans-serif", Typeface.NORMAL)
    private val fontLight: Typeface = Typeface.create("sans-serif-light", Typeface.NORMAL)

    // ---------- Doigts ----------
    private inner class Ptr(val id: Int, var key: Key, val downX: Float, val downY: Float) {
        var lastX = downX
        var handled = false
        var popup: String? = null
        var popupLeft = 0f
        var popupCell = 0f
        var popupSel = 0
        var trackpad = false
        var anchorX = 0f
    }

    private val ptrs = LinkedHashMap<Int, Ptr>()
    private var longPtr: Ptr? = null
    private val longRun = Runnable { longPtr?.let { onLongPress(it) } }
    private var repeatPtr: Ptr? = null
    private var repeatCount = 0
    private val repeatRun = object : Runnable {
        override fun run() {
            if (repeatPtr == null) return
            repeatCount++
            listener.onBackspace(repeatCount)
            listener.onTick()
            uiHandler.postDelayed(this, if (repeatCount > 14) 45L else 85L)
        }
    }
    private var lastShiftTap = 0L

    // ---------- API ----------
    fun setLanguage(l: String) {
        language = l
        rebuild()
    }

    fun setMode(m: KMode) {
        if (m == mode) return
        mode = m
        rebuild()
        listener.onModeChanged(m)
    }

    fun setShift(s: Shift) {
        if (s != shift) { shift = s; invalidate() }
    }

    fun cancelAll() {
        ptrs.clear()
        cancelLong()
        uiHandler.removeCallbacks(repeatRun)
        repeatPtr = null
        invalidateAll()
    }

    private fun rebuild() {
        rows = when (mode) {
            KMode.ALPHA -> Layouts.alpha(language)
            KMode.SYM -> Layouts.sym(language)
            KMode.SYM2 -> Layouts.sym2(language)
        }
        ptrs.clear()
        layoutKeys()
        invalidateAll()
    }

    // ---------- Mise en page ----------
    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val w = MeasureSpec.getSize(widthMeasureSpec)
        setMeasuredDimension(w, (padTop + padBottom + rowH * rows.size).toInt())
    }

    override fun onSizeChanged(w: Int, h: Int, oldw: Int, oldh: Int) {
        super.onSizeChanged(w, h, oldw, oldh)
        layoutKeys()
    }

    private fun layoutKeys() {
        if (width == 0) return
        val unit = (width - 2 * padH) / 10f
        var y = padTop
        charShaders.clear(); modShaders.clear()
        for (row in rows) {
            var x = padH + row.indent * unit
            var ux = row.indent
            row.keys.forEachIndexed { i, k ->
                val w = k.width * unit
                k.hitLeft = if (i == 0) 0f else x
                k.hitRight = if (i == row.keys.size - 1) width.toFloat() else x + w
                k.rect.set(x + gapX / 2, y + gapY / 2, x + w - gapX / 2, y + rowH - gapY / 2)
                k.cx = ux + k.width / 2
                x += w
                ux += k.width
            }
            val top = y + gapY / 2
            val bottom = y + rowH - gapY / 2
            charShaders.add(LinearGradient(0f, top, 0f, bottom, skin.keyTop, skin.keyBottom, Shader.TileMode.CLAMP))
            modShaders.add(LinearGradient(0f, top, 0f, bottom, skin.modTop, skin.modBottom, Shader.TileMode.CLAMP))
            y += rowH
        }
    }

    /** Touche sous le doigt, sans zone morte, avec correction prédictive entre deux lettres. */
    private fun keyAt(x: Float, yRaw: Float): Key? {
        if (rows.isEmpty()) return null
        // Comme sur iPhone : on vise légèrement au-dessus du point de contact.
        val y = yRaw - dp(3f)
        val r = ((y - padTop) / rowH).toInt().coerceIn(0, rows.size - 1)
        val row = rows[r]
        val k = row.keys.firstOrNull { x >= it.hitLeft && x < it.hitRight }
            ?: row.keys.minByOrNull { abs((it.hitLeft + it.hitRight) / 2 - x) } ?: return null
        if (!smartTouch || mode != KMode.ALPHA || !k.isChar) return k
        val idx = row.keys.indexOf(k)
        val cellW = k.hitRight - k.hitLeft
        val frac = (x - k.hitLeft) / cellW
        val neighbour = when {
            frac < 0.28f && idx > 0 -> row.keys[idx - 1]
            frac > 0.72f && idx < row.keys.size - 1 -> row.keys[idx + 1]
            else -> null
        }
        if (neighbour == null || !neighbour.isChar) return k
        val mine = listener.isLikely(k.label) ?: return k
        if (mine) return k
        return if (listener.isLikely(neighbour.label) == true) neighbour else k
    }

    // ---------- Dessin ----------
    override fun onDraw(canvas: Canvas) {
        // Fond limité à la zone des touches : la vue n'est pas découpée (pour que la bulle
        // déborde au-dessus), un drawColor recouvrirait la barre IA et les suggestions.
        keyPaint.shader = null
        keyPaint.color = skin.bg
        canvas.drawRect(0f, 0f, width.toFloat(), height.toFloat(), keyPaint)
        val pressed = HashSet<Key>()
        for (p in ptrs.values) pressed.add(p.key)
        rows.forEachIndexed { ri, row ->
            for (k in row.keys) drawKey(canvas, k, ri, k in pressed)
        }
        for (p in ptrs.values) {
            if (p.popup != null) drawPopup(canvas, p)
            else if (showPreview && p.key.isChar && !p.handled) drawBalloon(canvas, p.key)
        }
    }

    private fun drawKey(c: Canvas, k: Key, ri: Int, pressed: Boolean) {
        val r = k.rect
        val rad = dp(skin.radiusDp)
        val isMod = k.type != KType.CHAR && k.type != KType.SPACE
        val shiftOn = k.type == KType.SHIFT && shift != Shift.OFF
        val accentFill = k.type == KType.ENTER && enterAccent

        shadowPaint.color = skin.shadow
        c.drawRoundRect(r.left, r.top + dp(1.2f), r.right, r.bottom + dp(1.2f), rad, rad, shadowPaint)

        keyPaint.shader = null
        when {
            accentFill -> keyPaint.color = if (pressed) skin.pressedMod else skin.accent
            pressed && isMod -> keyPaint.color = skin.pressedMod
            pressed && k.type == KType.SPACE -> keyPaint.color = skin.pressedChar
            pressed && !showPreview -> keyPaint.color = skin.pressedChar
            shiftOn -> keyPaint.color = skin.pressedMod
            else -> {
                keyPaint.color = if (isMod) skin.modBottom else skin.keyBottom
                keyPaint.shader = (if (isMod) modShaders else charShaders).getOrNull(ri)
            }
        }
        c.drawRoundRect(r, rad, rad, keyPaint)
        keyPaint.shader = null
        if (skin.border != 0) {
            borderPaint.color = skin.border
            c.drawRoundRect(r, rad, rad, borderPaint)
        }

        val h = r.height()
        val fg = when {
            accentFill -> skin.onAccent
            isMod -> skin.modText
            else -> skin.text
        }
        when (k.type) {
            KType.CHAR -> {
                val label = display(k.label)
                labelPaint.color = skin.text
                labelPaint.typeface = fontRegular
                labelPaint.textSize = if (label.length > 1) h * 0.36f else h * 0.52f
                // iOS : les minuscules sont un peu plus hautes dans la touche
                drawCentered(c, label, r.centerX(), r.centerY() - h * 0.04f, labelPaint)
            }
            KType.SHIFT -> {
                val col = if (shift == Shift.OFF) fg else skin.text
                drawIcon(c, if (shift == Shift.OFF) R.drawable.ic_shift else R.drawable.ic_shift_on, r.centerX(), r.centerY() - if (shift == Shift.LOCK) h * 0.06f else 0f, h * 0.5f, col)
                if (shift == Shift.LOCK) {
                    keyPaint.color = col
                    c.drawRoundRect(r.centerX() - h * 0.16f, r.centerY() + h * 0.24f, r.centerX() + h * 0.16f, r.centerY() + h * 0.29f, 2f, 2f, keyPaint)
                }
            }
            KType.BACKSPACE -> drawIcon(c, R.drawable.ic_backspace, r.centerX(), r.centerY(), h * 0.46f, fg)
            KType.EMOJI -> drawIcon(c, R.drawable.ic_emoji, r.centerX(), r.centerY(), h * 0.5f, fg)
            KType.ENTER -> {
                labelPaint.color = fg
                labelPaint.typeface = fontRegular
                labelPaint.textSize = h * 0.34f
                drawCentered(c, enterLabel, r.centerX(), r.centerY(), labelPaint)
            }
            KType.SPACE -> {
                // Indicateur bilingue « FR EN » discret en bas à droite, comme iOS 17
                smallPaint.typeface = fontLight
                smallPaint.textSize = h * 0.2f
                smallPaint.textAlign = Paint.Align.RIGHT
                val y = r.bottom - h * 0.12f
                val other = if (language == "fr") "EN" else "FR"
                val active = language.uppercase()
                smallPaint.color = skin.hint
                c.drawText(" $other", r.right - h * 0.2f, y, smallPaint)
                val wOther = smallPaint.measureText(" $other")
                smallPaint.color = skin.text
                c.drawText(active, r.right - h * 0.2f - wOther, y, smallPaint)
                smallPaint.textAlign = Paint.Align.CENTER
            }
            else -> {
                labelPaint.color = fg
                labelPaint.typeface = fontRegular
                labelPaint.textSize = h * 0.36f
                drawCentered(c, k.label, r.centerX(), r.centerY(), labelPaint)
            }
        }
    }

    /** Bulle iOS : la touche s'étire vers le haut en goutte, avec la lettre en grand. */
    private fun drawBalloon(c: Canvas, k: Key) {
        val r = k.rect
        val h = r.height()
        val w = max(r.width() * 1.55f, dp(46f))
        val bh = h * 1.12f
        val bx = (r.centerX() - w / 2).coerceIn(dp(1f), width - w - dp(1f))
        val bBottom = r.top - h * 0.02f
        val by = bBottom - bh
        val neckY = r.top + h * 0.3f
        val rad = dp(skin.radiusDp)
        val br = dp(11f)
        val p = balloonPath
        p.reset()
        p.moveTo(r.left, r.bottom - rad)
        p.lineTo(r.left, neckY)
        p.cubicTo(r.left, neckY - h * 0.22f, bx, bBottom + h * 0.18f, bx, bBottom)
        p.lineTo(bx, by + br)
        p.quadTo(bx, by, bx + br, by)
        p.lineTo(bx + w - br, by)
        p.quadTo(bx + w, by, bx + w, by + br)
        p.lineTo(bx + w, bBottom)
        p.cubicTo(bx + w, bBottom + h * 0.18f, r.right, neckY - h * 0.22f, r.right, neckY)
        p.lineTo(r.right, r.bottom - rad)
        p.quadTo(r.right, r.bottom, r.right - rad, r.bottom)
        p.lineTo(r.left + rad, r.bottom)
        p.quadTo(r.left, r.bottom, r.left, r.bottom - rad)
        p.close()
        c.save()
        c.translate(0f, dp(1.2f))
        balloonPaint.color = skin.shadow
        c.drawPath(p, balloonPaint)
        c.restore()
        balloonPaint.color = skin.balloon
        c.drawPath(p, balloonPaint)
        labelPaint.color = skin.text
        labelPaint.typeface = fontRegular
        labelPaint.textSize = bh * 0.62f
        drawCentered(c, display(k.label), bx + w / 2, by + bh * 0.5f, labelPaint)
    }

    private fun drawPopup(c: Canvas, p: Ptr) {
        val pop = p.popup ?: return
        val h = p.key.rect.height() * 1.05f
        val bottom = p.key.rect.top - dp(6f)
        val top = bottom - h
        val total = p.popupCell * pop.length
        val left = p.popupLeft - dp(4f)
        val right = p.popupLeft + total + dp(4f)
        c.save(); c.translate(0f, dp(1.5f))
        balloonPaint.color = skin.shadow
        c.drawRoundRect(left, top - dp(4f), right, bottom + dp(4f), dp(11f), dp(11f), balloonPaint)
        c.restore()
        balloonPaint.color = skin.balloon
        c.drawRoundRect(left, top - dp(4f), right, bottom + dp(4f), dp(11f), dp(11f), balloonPaint)
        for (i in pop.indices) {
            val l = p.popupLeft + i * p.popupCell
            if (i == p.popupSel) {
                balloonPaint.color = skin.accent
                c.drawRoundRect(l + dp(1f), top, l + p.popupCell - dp(1f), bottom, dp(7f), dp(7f), balloonPaint)
            }
            labelPaint.color = if (i == p.popupSel) skin.onAccent else skin.text
            labelPaint.typeface = fontRegular
            labelPaint.textSize = h * 0.46f
            drawCentered(c, display(pop[i].toString()), l + p.popupCell / 2, (top + bottom) / 2, labelPaint)
        }
    }

    private fun drawCentered(c: Canvas, s: String, cx: Float, cy: Float, p: Paint) {
        c.drawText(s, cx, cy - (p.descent() + p.ascent()) / 2, p)
    }

    private fun drawIcon(c: Canvas, res: Int, cx: Float, cy: Float, size: Float, color: Int) {
        val d = icons.getOrPut(res) { context.getDrawable(res)!!.mutate() }
        val half = (size / 2).toInt()
        d.setBounds(cx.toInt() - half, cy.toInt() - half, cx.toInt() + half, cy.toInt() + half)
        d.setTint(color)
        d.draw(c)
    }

    private fun display(s: String): String =
        if (mode == KMode.ALPHA && shift != Shift.OFF) buildString { s.forEach { append(Character.toUpperCase(it)) } } else s

    // ---------- Tactile ----------
    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(e: MotionEvent): Boolean {
        when (e.actionMasked) {
            MotionEvent.ACTION_DOWN, MotionEvent.ACTION_POINTER_DOWN -> {
                val i = e.actionIndex
                down(e.getPointerId(i), e.getX(i), e.getY(i))
            }
            MotionEvent.ACTION_MOVE -> for (i in 0 until e.pointerCount) move(e.getPointerId(i), e.getX(i), e.getY(i))
            MotionEvent.ACTION_UP, MotionEvent.ACTION_POINTER_UP -> {
                val i = e.actionIndex
                up(e.getPointerId(i))
            }
            MotionEvent.ACTION_CANCEL -> cancelAll()
        }
        return true
    }

    private fun down(id: Int, x: Float, y: Float) {
        // Rollover : un nouvel appui valide immédiatement la lettre encore sous l'autre doigt.
        for (p in ptrs.values) {
            if (p.key.isChar && !p.handled && p.popup == null) {
                commitChar(p.key)
                p.handled = true
            }
        }
        cancelLong()
        val k = keyAt(x, y) ?: return
        val p = Ptr(id, k, x, y)
        ptrs[id] = p
        listener.onKeyDown(k.type)
        when (k.type) {
            KType.CHAR -> if (k.popup != null) scheduleLong(p, 380L)
            KType.BACKSPACE -> {
                listener.onBackspace(0)
                repeatPtr = p
                repeatCount = 0
                uiHandler.postDelayed(repeatRun, 420L)
            }
            KType.SHIFT -> shiftTap()
            KType.SPACE -> scheduleLong(p, 450L)
            KType.EMOJI -> scheduleLong(p, 450L)
            else -> {}
        }
        invalidateAll()
    }

    private fun move(id: Int, x: Float, y: Float) {
        val p = ptrs[id] ?: return
        p.lastX = x
        if (p.handled && !p.trackpad) return
        val k = p.key
        when {
            p.popup != null -> {
                val pop = p.popup!!
                val s = ((x - p.popupLeft) / p.popupCell).toInt().coerceIn(0, pop.length - 1)
                if (s != p.popupSel) { p.popupSel = s; listener.onTick(); invalidateAll() }
            }
            k.type == KType.SPACE -> {
                if (!p.trackpad && abs(x - p.downX) > dp(14f)) startTrackpad(p, x)
                if (p.trackpad) {
                    val step = dp(10f)
                    val n = ((x - p.anchorX) / step).toInt()
                    if (n != 0) {
                        listener.onCursorMove(n)
                        listener.onTick()
                        p.anchorX += n * step
                    }
                }
            }
            k.isChar -> {
                // Glisser vers une autre lettre avant de relâcher corrige la touche (comme iOS).
                val nk = keyAt(x, y)
                if (nk != null && nk !== k && nk.isChar && (abs(x - p.downX) > dp(8f) || abs(y - p.downY) > dp(10f))) {
                    p.key = nk
                    cancelLong()
                    if (nk.popup != null) scheduleLong(p, 380L)
                    invalidateAll()
                }
            }
        }
    }

    private fun up(id: Int) {
        val p = ptrs.remove(id) ?: return
        if (longPtr === p) cancelLong()
        if (repeatPtr === p) {
            uiHandler.removeCallbacks(repeatRun)
            repeatPtr = null
        }
        if (!p.handled) {
            val k = p.key
            when (k.type) {
                KType.CHAR -> {
                    val pop = p.popup
                    if (pop != null) emitChar(pop[p.popupSel].toString()) else commitChar(k)
                }
                KType.SPACE -> if (!p.trackpad) listener.onSpace()
                KType.ENTER -> listener.onEnter()
                KType.TO_SYM -> setMode(KMode.SYM)
                KType.TO_SYM2 -> setMode(KMode.SYM2)
                KType.TO_ALPHA -> setMode(KMode.ALPHA)
                KType.EMOJI -> listener.onEmoji()
                else -> {}
            }
        }
        invalidateAll()
    }

    private fun startTrackpad(p: Ptr, x: Float) {
        p.trackpad = true
        p.handled = true
        p.anchorX = x
        if (longPtr === p) cancelLong()
        listener.onTick()
    }

    private fun scheduleLong(p: Ptr, delay: Long) {
        cancelLong()
        longPtr = p
        uiHandler.postDelayed(longRun, delay)
    }

    private fun cancelLong() {
        uiHandler.removeCallbacks(longRun)
        longPtr = null
    }

    private fun onLongPress(p: Ptr) {
        longPtr = null
        if (!ptrs.containsValue(p) || p.handled) return
        val k = p.key
        when (k.type) {
            KType.SPACE -> { startTrackpad(p, p.lastX); invalidateAll(); return }
            KType.EMOJI -> { p.handled = true; listener.onEmojiLongPress(); invalidateAll(); return }
            else -> {}
        }
        val pop = k.popup ?: return
        // Le caractère de base reste en première position (comme iOS).
        val chars = k.label + pop
        val n = chars.length
        var cell = max(k.rect.width(), dp(30f))
        if (cell * n > width - dp(12f)) cell = (width - dp(12f)) / n
        val total = cell * n
        p.popupCell = cell
        p.popupLeft = min(max(k.rect.centerX() - cell / 2, dp(6f)), width - total - dp(6f))
        p.popup = chars
        p.popupSel = ((p.lastX - p.popupLeft) / cell).toInt().coerceIn(0, n - 1)
        listener.onTick()
        invalidateAll()
    }

    private fun shiftTap() {
        val now = SystemClock.uptimeMillis()
        val next = when (shift) {
            Shift.LOCK -> Shift.OFF
            Shift.ONE -> if (now - lastShiftTap < 380) Shift.LOCK else Shift.OFF
            Shift.OFF -> Shift.ONE
        }
        lastShiftTap = now
        setShift(next)
        listener.onShiftTapped(next)
    }

    private fun commitChar(k: Key) = emitChar(k.label)

    private fun emitChar(s: String) {
        val out = display(s)
        if (mode == KMode.ALPHA && shift == Shift.ONE && s[0].isLetter()) setShift(Shift.OFF)
        listener.onText(out)
    }

    private fun invalidateAll() {
        invalidate()
        // La bulle déborde au-dessus de la vue : on redessine toute la fenêtre du clavier.
        rootView?.invalidate()
    }
}
