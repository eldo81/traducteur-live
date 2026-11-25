package com.dioneo.clavieria

import android.content.Context
import org.json.JSONObject
import java.text.Normalizer

/**
 * Dictionnaire bilingue FR + EN (comme le clavier bilingue d'iOS 17) :
 * complétion, correction automatique prudente, prédiction du mot suivant
 * et apprentissage local des mots de l'utilisateur. Rien ne quitte le téléphone.
 */
class Dictionary(private val ctx: Context, private val prefs: Prefs) {

    private class Lex(val words: List<String>, val norms: List<String>, val sorted: Array<String>, val known: HashSet<String>)

    private val lexes = HashMap<String, Lex>()
    private var user: HashMap<String, Int>? = null
    private var bigrams: HashMap<String, HashMap<String, Int>>? = null
    private val neighbours = HashMap<String, Map<Char, Set<Char>>>()
    private var dirty = false

    private val marks = Regex("\\p{Mn}+")
    private val normCache = HashMap<String, String>()

    /** Forme sans accents, en minuscules (mise en cache : la frappe reste instantanée). */
    fun norm(s: String): String = normCache[s] ?: Normalizer.normalize(s.lowercase(), Normalizer.Form.NFD)
        .replace(marks, "").replace('’', '\'').also { if (normCache.size < 20000) normCache[s] = it }

    private fun lex(lang: String): Lex = lexes.getOrPut(lang) {
        val words = try {
            ctx.assets.open("words_$lang.txt").bufferedReader().readLines().map { it.trim() }.filter { it.isNotEmpty() }
        } catch (e: Exception) { emptyList() }
        val norms = words.map { norm(it) }
        Lex(words, norms, norms.toTypedArray().also { it.sort() }, words.map { it.lowercase() }.toHashSet())
    }

    private fun langs(primary: String) = if (primary == "en") listOf("en", "fr") else listOf("fr", "en")

    private fun userMap(): HashMap<String, Int> = user ?: HashMap<String, Int>().also { m ->
        try {
            val j = JSONObject(prefs.sp.getString("dict_user", "{}") ?: "{}")
            j.keys().forEach { k -> m[k] = j.optInt(k, 1) }
        } catch (_: Exception) {}
        user = m
    }

    private fun bigramMap(): HashMap<String, HashMap<String, Int>> = bigrams ?: HashMap<String, HashMap<String, Int>>().also { m ->
        try {
            val j = JSONObject(prefs.sp.getString("dict_bigrams", "{}") ?: "{}")
            j.keys().forEach { a ->
                val inner = j.optJSONObject(a) ?: return@forEach
                val h = HashMap<String, Int>()
                inner.keys().forEach { b -> h[b] = inner.optInt(b, 1) }
                m[a] = h
            }
        } catch (_: Exception) {}
        bigrams = m
    }

    fun isKnown(word: String): Boolean {
        val w = word.lowercase().replace('’', '\'')
        return lex("fr").known.contains(w) || lex("en").known.contains(w) || userMap().containsKey(w)
    }

    /** La saisie `prefix` peut-elle encore devenir un mot connu ? (zone de frappe intelligente) */
    fun hasPrefix(prefix: String, primary: String): Boolean {
        val p = norm(prefix)
        if (p.isEmpty()) return true
        for (l in langs(primary)) {
            val arr = lex(l).sorted
            var i = java.util.Arrays.binarySearch(arr, p)
            if (i >= 0) return true
            i = -i - 1
            if (i < arr.size && arr[i].startsWith(p)) return true
        }
        return userMap().keys.any { norm(it).startsWith(p) }
    }

    fun suggest(prefix: String, primary: String, n: Int = 3): List<String> {
        if (prefix.isEmpty()) return emptyList()
        val p = norm(prefix)
        val lower = prefix.lowercase()
        val out = LinkedHashSet<String>()
        // 1. même mot avec les bons accents (« deja » → « déjà »)
        for (l in langs(primary)) {
            val lx = lex(l)
            val i = lx.norms.indexOf(p)
            if (i >= 0 && lx.words[i].lowercase() != lower) { out.add(lx.words[i]); break }
        }
        // 2. mots de l'utilisateur, les plus fréquents d'abord
        userMap().entries.filter { it.key != lower && norm(it.key).startsWith(p) }
            .sortedByDescending { it.value }.take(n).forEach { out.add(it.key) }
        // 3. dictionnaires (langue active d'abord), triés par fréquence
        for (l in langs(primary)) {
            val lx = lex(l)
            for (i in lx.words.indices) {
                if (out.size >= n + 2) break
                if (lx.norms[i].startsWith(p) && lx.words[i].lowercase() != lower) out.add(lx.words[i])
            }
        }
        return out.take(n)
    }

    /** Correction automatique prudente : accents manquants, touche voisine, lettres inversées, lettre oubliée. */
    fun correction(word: String, primary: String): String? {
        val lower = word.lowercase()
        if (lower.length < 2 || isKnown(lower) || !lower.all { it.isLetter() }) return null
        val n = norm(lower)
        val hasAccent = n != lower
        var found: String? = null
        if (!hasAccent) {
            for (l in langs(primary)) {
                val lx = lex(l)
                val i = lx.norms.indexOf(n)
                if (i >= 0) { found = lx.words[i]; break }
            }
        }
        if (found == null && lower.length >= 3) {
            val adj = neighbours.getOrPut(primary) { Layouts.neighbours(primary) }
            loop@ for (l in langs(primary)) {
                val lx = lex(l)
                for (i in lx.words.indices) {
                    val c = lx.norms[i]
                    if (c.length == n.length && close(n, c, adj)) { found = lx.words[i]; break@loop }
                    if (n.length >= 5 && c.length == n.length + 1 && oneMissing(n, c)) { found = lx.words[i]; break@loop }
                }
            }
        }
        val f = found ?: return null
        return if (word[0].isUpperCase()) f.replaceFirstChar { it.uppercaseChar() } else f
    }

    private fun close(a: String, b: String, adj: Map<Char, Set<Char>>): Boolean {
        val d = a.indices.filter { a[it] != b[it] }
        if (d.size == 1) return adj[a[d[0]]]?.contains(b[d[0]]) == true
        if (d.size == 2 && d[1] == d[0] + 1) return a[d[0]] == b[d[1]] && a[d[1]] == b[d[0]]
        return false
    }

    private fun oneMissing(typed: String, cand: String): Boolean {
        var i = 0
        while (i < typed.length && typed[i] == cand[i]) i++
        return typed.substring(i) == cand.substring(i + 1)
    }

    fun next(prev: String, n: Int = 3): List<String> {
        val m = bigramMap()[prev.lowercase()] ?: return emptyList()
        return m.entries.sortedByDescending { it.value }.take(n).map { it.key }
    }

    fun learn(word: String, prev: String?) {
        val w = word.lowercase().replace('’', '\'')
        if (w.length < 2 || w.length > 32 || !w.all { it.isLetter() || it == '-' || it == '\'' }) return
        val u = userMap()
        u[w] = (u[w] ?: 0) + 1
        if (u.size > 3000) u.entries.minByOrNull { it.value }?.let { u.remove(it.key) }
        if (!prev.isNullOrEmpty()) {
            val b = bigramMap()
            val p = prev.lowercase()
            val inner = b.getOrPut(p) { HashMap() }
            inner[w] = (inner[w] ?: 0) + 1
            if (b.size > 3000) b.remove(b.keys.first())
        }
        dirty = true
    }

    fun forget(word: String) {
        userMap().remove(word.lowercase())
        dirty = true
    }

    fun save() {
        if (!dirty) return
        val u = JSONObject()
        userMap().forEach { (k, v) -> u.put(k, v) }
        val b = JSONObject()
        bigramMap().forEach { (k, m) -> b.put(k, JSONObject().also { o -> m.forEach { (x, y) -> o.put(x, y) } }) }
        prefs.sp.edit().putString("dict_user", u.toString()).putString("dict_bigrams", b.toString()).apply()
        dirty = false
    }
}
