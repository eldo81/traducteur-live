package com.dioneo.clavieria

import android.content.Context
import org.json.JSONObject

/**
 * Dictionnaire bilingue FR (≈ 49 000 mots) + EN (30 000 mots), classés par fréquence d'usage :
 * complétion, correction automatique, prédiction du mot suivant et apprentissage local.
 * Index en mémoire (tri par forme sans accent + seaux par longueur) : chaque frappe reste instantanée.
 * Rien ne quitte le téléphone.
 */
class Dictionary(private val ctx: Context, private val prefs: Prefs) {

    private class Lex(
        val words: Array<String>,          // par fréquence décroissante (indice = rang)
        val norms: Array<String>,          // forme sans accent, minuscules
        val sorted: Array<String>,         // normes triées alphabétiquement
        val sortedIdx: IntArray,           // rang correspondant à chaque entrée de `sorted`
        val firstByNorm: HashMap<String, Int>, // rang le plus fréquent pour une norme
        val known: HashSet<String>,
        val byLen: HashMap<Int, IntArray>, // candidats à la correction, par longueur
    )

    private val lock = Any()
    private val lexes = HashMap<String, Lex>()
    private var user: HashMap<String, Int>? = null
    private var userNorm: HashMap<String, String>? = null
    private var bigrams: HashMap<String, HashMap<String, Int>>? = null
    private val neighbours = HashMap<String, Map<Char, Set<Char>>>()
    private var dirty = false

    /** Charge les deux dictionnaires en arrière-plan (appelé au démarrage du clavier). */
    fun preload() {
        lex("fr")
        lex("en")
    }

    fun norm(s: String): String {
        var plain = true
        for (ch in s) if (ch.code > 127 || ch.isUpperCase()) { plain = false; break }
        if (plain) return s
        val sb = StringBuilder(s.length)
        for (ch in s) {
            val c = ch.lowercaseChar()
            sb.append(
                when (c) {
                    'à', 'â', 'ä', 'á', 'ã', 'å', 'ā' -> 'a'
                    'é', 'è', 'ê', 'ë', 'ē', 'ė', 'ę' -> 'e'
                    'î', 'ï', 'ì', 'í', 'ī' -> 'i'
                    'ô', 'ö', 'ò', 'ó', 'õ', 'ø', 'ō' -> 'o'
                    'ù', 'û', 'ü', 'ú', 'ū' -> 'u'
                    'ç', 'ć', 'č' -> 'c'
                    'ñ', 'ń' -> 'n'
                    'ÿ', 'ý' -> 'y'
                    'ś', 'š' -> 's'
                    'ž', 'ź', 'ż' -> 'z'
                    'ł' -> 'l'
                    '’' -> '\''
                    else -> c
                }
            )
        }
        return sb.toString()
    }

    private fun lex(lang: String): Lex = synchronized(lock) {
        lexes.getOrPut(lang) { load(lang) }
    }

    private fun load(lang: String): Lex {
        val list = try {
            ctx.assets.open("words_$lang.txt").bufferedReader().readLines()
        } catch (e: Exception) { emptyList() }
        val words = ArrayList<String>(list.size)
        for (l in list) { val w = l.trim(); if (w.isNotEmpty()) words.add(w) }
        val n = words.size
        val norms = Array(n) { norm(words[it]) }
        val order = (0 until n).sortedWith { a, b -> norms[a].compareTo(norms[b]) }.toIntArray()
        val sorted = Array(n) { norms[order[it]] }
        val first = HashMap<String, Int>(n * 2)
        val known = HashSet<String>(n * 2)
        val buckets = HashMap<Int, ArrayList<Int>>()
        for (i in 0 until n) {
            first.putIfAbsent(norms[i], i)
            known.add(words[i].lowercase())
            // Seuls les 25 000 mots les plus courants servent de cible de correction
            if (i < 25000) buckets.getOrPut(norms[i].length) { ArrayList() }.add(i)
        }
        val byLen = HashMap<Int, IntArray>()
        for ((k, v) in buckets) byLen[k] = v.toIntArray()
        return Lex(words.toTypedArray(), norms, sorted, order, first, known, byLen)
    }

    private fun langs(primary: String) = if (primary == "en") listOf("en", "fr") else listOf("fr", "en")

    private fun userMap(): HashMap<String, Int> = user ?: HashMap<String, Int>().also { m ->
        try {
            val j = JSONObject(prefs.sp.getString("dict_user", "{}") ?: "{}")
            j.keys().forEach { k -> m[k] = j.optInt(k, 1) }
        } catch (_: Exception) {}
        user = m
    }

    private fun userNorms(): HashMap<String, String> = userNorm ?: HashMap<String, String>().also { m ->
        userMap().keys.forEach { m[it] = norm(it) }
        userNorm = m
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

    /** Première position de `p` (ou de son point d'insertion) dans les normes triées. */
    private fun lowerBound(arr: Array<String>, p: String): Int {
        var lo = 0
        var hi = arr.size
        while (lo < hi) {
            val mid = (lo + hi) ushr 1
            if (arr[mid] < p) lo = mid + 1 else hi = mid
        }
        return lo
    }

    /** La saisie `prefix` peut-elle encore devenir un mot connu ? (zone de frappe intelligente) */
    fun hasPrefix(prefix: String, primary: String): Boolean {
        val p = norm(prefix)
        if (p.isEmpty()) return true
        for (l in langs(primary)) {
            val arr = lex(l).sorted
            val i = lowerBound(arr, p)
            if (i < arr.size && arr[i].startsWith(p)) return true
        }
        return userNorms().values.any { it.startsWith(p) }
    }

    /** Les `n` mots les plus fréquents qui commencent par `p` (rangs croissants). */
    private fun topWithPrefix(lx: Lex, p: String, n: Int, skip: String): List<String> {
        var i = lowerBound(lx.sorted, p)
        val best = IntArray(n) { Int.MAX_VALUE }
        var scanned = 0
        while (i < lx.sorted.size && lx.sorted[i].startsWith(p) && scanned < 40000) {
            val r = lx.sortedIdx[i]
            if (r < best[n - 1] && lx.words[r].lowercase() != skip) {
                var j = n - 1
                while (j > 0 && best[j - 1] > r) { best[j] = best[j - 1]; j-- }
                best[j] = r
            }
            i++
            scanned++
        }
        return best.filter { it != Int.MAX_VALUE }.map { lx.words[it] }
    }

    fun suggest(prefix: String, primary: String, n: Int = 3): List<String> {
        if (prefix.isEmpty()) return emptyList()
        val p = norm(prefix)
        val lower = prefix.lowercase()
        val out = LinkedHashSet<String>()
        // 1. même mot avec les bons accents (« deja » → « déjà »)
        for (l in langs(primary)) {
            val lx = lex(l)
            val i = lx.firstByNorm[p]
            if (i != null && lx.words[i].lowercase() != lower) { out.add(lx.words[i]); break }
        }
        // 2. mots de l'utilisateur, les plus fréquents d'abord
        val un = userNorms()
        userMap().entries.filter { it.key != lower && (un[it.key] ?: it.key).startsWith(p) }
            .sortedByDescending { it.value }.take(n).forEach { out.add(it.key) }
        // 3. dictionnaires (langue active d'abord), par fréquence d'usage
        for (l in langs(primary)) {
            if (out.size >= n + 1) break
            out.addAll(topWithPrefix(lex(l), p, n + 1, lower))
        }
        return out.filter { it.lowercase() != lower }.take(n)
    }

    /** Correction automatique : accents manquants, touche voisine, lettres inversées, lettre oubliée. */
    fun correction(word: String, primary: String): String? {
        val lower = word.lowercase()
        if (lower.length < 2 || !lower.all { it.isLetter() }) return null
        if (userMap().containsKey(lower) || lex(primary).known.contains(lower)) return null
        val n = norm(lower)
        var found: String? = null
        // Accents manquants dans la langue active d'abord (« deja » → « déjà » même si « deja » existe en anglais)
        if (n == lower) {
            val lx = lex(primary)
            val i = lx.firstByNorm[n]
            if (i != null && lx.words[i].lowercase() != lower) found = lx.words[i]
        }
        if (found == null && isKnown(lower)) return null
        if (found == null && n == lower) {
            for (l in langs(primary)) {
                val i = lex(l).firstByNorm[n]
                if (i != null) { found = lex(l).words[i]; break }
            }
        }
        if (found == null && lower.length >= 3) {
            val adj = neighbours.getOrPut(primary) { Layouts.neighbours(primary) }
            for (l in langs(primary)) {
                val lx = lex(l)
                var bestRank = Int.MAX_VALUE
                lx.byLen[n.length]?.let { ids ->
                    for (r in ids) {
                        if (r >= bestRank) break
                        if (close(n, lx.norms[r], adj)) { bestRank = r; break }
                    }
                }
                if (n.length >= 4) lx.byLen[n.length + 1]?.let { ids ->
                    for (r in ids) {
                        if (r >= bestRank) break
                        if (oneMissing(n, lx.norms[r])) { bestRank = r; break }
                    }
                }
                if (bestRank != Int.MAX_VALUE) { found = lx.words[bestRank]; break }
            }
        }
        val f = found ?: return null
        return if (word[0].isUpperCase()) f.replaceFirstChar { it.uppercaseChar() } else f
    }

    private fun close(a: String, b: String, adj: Map<Char, Set<Char>>): Boolean {
        var d1 = -1
        var d2 = -1
        for (i in a.indices) {
            if (a[i] != b[i]) {
                if (d1 < 0) d1 = i else if (d2 < 0) d2 = i else return false
            }
        }
        if (d1 < 0) return false
        if (d2 < 0) return adj[a[d1]]?.contains(b[d1]) == true
        return d2 == d1 + 1 && a[d1] == b[d2] && a[d2] == b[d1]
    }

    private fun oneMissing(typed: String, cand: String): Boolean {
        var i = 0
        while (i < typed.length && typed[i] == cand[i]) i++
        return typed.regionMatches(i, cand, i + 1, typed.length - i)
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
        userNorms()[w] = norm(w)
        if (u.size > 3000) u.entries.minByOrNull { it.value }?.let { u.remove(it.key); userNorm?.remove(it.key) }
        if (!prev.isNullOrEmpty()) {
            val b = bigramMap()
            val inner = b.getOrPut(prev.lowercase()) { HashMap() }
            inner[w] = (inner[w] ?: 0) + 1
            if (b.size > 3000) b.remove(b.keys.first())
        }
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
