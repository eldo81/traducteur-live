package com.dioneo.clavieria

import android.graphics.RectF

enum class KType { CHAR, SHIFT, BACKSPACE, ENTER, SPACE, TO_SYM, TO_ALPHA, TO_SYM2, EMOJI }
enum class KMode { ALPHA, SYM, SYM2, NUM }

class Key(
    val type: KType,
    val label: String = "",
    val width: Float = 1f,
    val popup: String? = null,
    val sub: String? = null,
) {
    val rect = RectF()
    var hitLeft = 0f
    var hitRight = 0f
    var cx = 0f // centre en unités de touche, pour la carte des touches voisines
    val isChar get() = type == KType.CHAR
}

class KRow(val keys: List<Key>, val indent: Float = 0f)

/** Dispositions calquées sur le clavier iPhone (AZERTY français, QWERTY anglais). */
object Layouts {
    private val ACCENTS = mapOf(
        "a" to "àâæáäãåā", "e" to "éèêëēėę", "i" to "îïìíī", "o" to "ôœöòóõøō",
        "u" to "ùûüúū", "c" to "çćč", "n" to "ñń", "y" to "ÿý", "s" to "ßśš",
        "z" to "žźż", "l" to "ł", "g" to "ğ", "r" to "ř", "t" to "ţ",
        "’" to ",.?!'\"«»‘“”", "." to "…", "," to ";", "-" to "–—•", "/" to "\\",
        "?" to "¿", "!" to "¡", "'" to "’‘`", "\"" to "«»“”„", "€" to "\$£¥¢",
        "\$" to "€£¥¢", "&" to "§", "0" to "°", "%" to "‰", "*" to "★",
        "(" to "[{<", ")" to "]}>", "1" to "¹½¼", "2" to "²", "3" to "³¾",
    )

    private fun ch(c: String) = Key(KType.CHAR, c, 1f, ACCENTS[c])
    private fun chars(s: String, w: Float = 1f) = s.map { Key(KType.CHAR, it.toString(), w, ACCENTS[it.toString()]) }

    private fun bottom(toggle: Key) = KRow(
        listOf(toggle, Key(KType.EMOJI, "", 1.25f), Key(KType.SPACE, "", 5f), Key(KType.ENTER, "", 2.5f))
    )

    fun alpha(lang: String): List<KRow> = if (lang == "en") listOf(
        KRow(chars("qwertyuiop")),
        KRow(chars("asdfghjkl"), indent = 0.5f),
        KRow(listOf(Key(KType.SHIFT, "", 1.5f)) + chars("zxcvbnm") + Key(KType.BACKSPACE, "", 1.5f)),
        bottom(Key(KType.TO_SYM, "123", 1.25f)),
    ) else listOf(
        KRow(chars("azertyuiop")),
        KRow(chars("qsdfghjklm")),
        KRow(listOf(Key(KType.SHIFT, "", 1.5f)) + chars("wxcvbn") + ch("’") + Key(KType.BACKSPACE, "", 1.5f)),
        bottom(Key(KType.TO_SYM, "123", 1.25f)),
    )

    fun sym(lang: String): List<KRow> = listOf(
        KRow(chars("1234567890")),
        KRow(chars(if (lang == "en") "-/:;()\$&@\"" else "-/:;()€&@\"")),
        KRow(listOf(Key(KType.TO_SYM2, "#+=", 1.5f)) + chars(".,?!’", 1.4f) + Key(KType.BACKSPACE, "", 1.5f)),
        bottom(Key(KType.TO_ALPHA, "ABC", 1.25f)),
    )

    fun sym2(lang: String): List<KRow> = listOf(
        KRow(chars("[]{}#%^*+=")),
        KRow(chars(if (lang == "en") "_\\|~<>€£¥•" else "_\\|~<>\$£¥•")),
        KRow(listOf(Key(KType.TO_SYM, "123", 1.5f)) + chars(".,?!’", 1.4f) + Key(KType.BACKSPACE, "", 1.5f)),
        bottom(Key(KType.TO_ALPHA, "ABC", 1.25f)),
    )

    /** Pavé numérique grand format (montants, téléphones, codes) pour les applis wallet et bancaires. */
    fun num(lang: String, phone: Boolean): List<KRow> {
        fun d(c: String, sub: String, pop: String? = null) = Key(KType.CHAR, c, 2.5f, pop, sub)
        val dec = if (lang == "en") "." else ","
        val decPop = if (phone) "*#,." else if (lang == "en") "," else "."
        return listOf(
            KRow(listOf(d("1", ""), d("2", "ABC"), d("3", "DEF"), Key(KType.CHAR, if (phone) "+" else "-", 2.5f, if (phone) "-()" else "+")) ),
            KRow(listOf(d("4", "GHI"), d("5", "JKL"), d("6", "MNO"), Key(KType.SPACE, "", 2.5f))),
            KRow(listOf(d("7", "PQRS"), d("8", "TUV"), d("9", "WXYZ"), Key(KType.BACKSPACE, "", 2.5f))),
            KRow(listOf(Key(KType.TO_ALPHA, "ABC", 2.5f), d("0", "+", "+"), Key(KType.CHAR, if (phone) "*" else dec, 2.5f, decPop), Key(KType.ENTER, "", 2.5f))),
        )
    }

    /** Touches voisines (pour la correction automatique des fautes de frappe). */
    fun neighbours(lang: String): Map<Char, Set<Char>> {
        val pos = HashMap<Char, Pair<Int, Float>>()
        alpha(lang).forEachIndexed { r, row ->
            var x = row.indent
            for (k in row.keys) {
                if (k.isChar && k.label.length == 1 && k.label[0].isLetter()) pos[k.label[0]] = r to (x + k.width / 2)
                x += k.width
            }
        }
        val out = HashMap<Char, Set<Char>>()
        for ((c, p) in pos) {
            out[c] = pos.filter { (o, q) -> o != c && kotlin.math.abs(q.first - p.first) <= 1 && kotlin.math.abs(q.second - p.second) <= 1.1f }.keys
        }
        return out
    }
}
