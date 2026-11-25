package com.dioneo.clavieria

import android.content.Context
import android.content.SharedPreferences
import org.json.JSONArray

class Prefs(ctx: Context) {
    val sp: SharedPreferences = ctx.applicationContext.getSharedPreferences("clavier_ia", Context.MODE_PRIVATE)

    private fun str(k: String, d: String) = sp.getString(k, d) ?: d
    private fun putStr(k: String, v: String) = sp.edit().putString(k, v).apply()
    private fun bool(k: String, d: Boolean) = sp.getBoolean(k, d)
    private fun putBool(k: String, v: Boolean) = sp.edit().putBoolean(k, v).apply()
    private fun int(k: String, d: Int) = sp.getInt(k, d)
    private fun putInt(k: String, v: Int) = sp.edit().putInt(k, v).apply()

    var apiKey: String
        get() = str("api_key", "")
        set(v) = putStr("api_key", v.trim())
    var model: String
        get() = str("model", "")
        set(v) = putStr("model", v.trim())
    var autoModel: String
        get() = str("auto_model", "")
        set(v) = putStr("auto_model", v)
    var streamOk: Boolean
        get() = bool("stream_ok", true)
        set(v) = putBool("stream_ok", v)

    /** 0 = aucune, 1 = légère, 2 = moyenne, 3 = forte */
    var haptic: Int
        get() = int("haptic", 2)
        set(v) = putInt("haptic", v)
    var sound: Boolean
        get() = bool("sound", false)
        set(v) = putBool("sound", v)
    var autoCap: Boolean
        get() = bool("auto_cap", true)
        set(v) = putBool("auto_cap", v)
    var autoCorrect: Boolean
        get() = bool("auto_correct", true)
        set(v) = putBool("auto_correct", v)
    var doubleSpace: Boolean
        get() = bool("double_space", true)
        set(v) = putBool("double_space", v)
    var suggestions: Boolean
        get() = bool("suggestions", true)
        set(v) = putBool("suggestions", v)
    var smartTouch: Boolean
        get() = bool("smart_touch", true)
        set(v) = putBool("smart_touch", v)
    var clipHistory: Boolean
        get() = bool("clip_history", true)
        set(v) = putBool("clip_history", v)
    var preview: Boolean
        get() = bool("preview", true)
        set(v) = putBool("preview", v)

    var theme: Int
        get() = int("theme", 0)
        set(v) = putInt("theme", v)
    var heightPct: Int
        get() = int("height_pct", 100)
        set(v) = putInt("height_pct", v)
    var lang: String
        get() = str("lang", "fr")
        set(v) = putStr("lang", v)
    var tone: String
        get() = str("tone", "pro")
        set(v) = putStr("tone", v)
    var summary: String
        get() = str("summary", "court")
        set(v) = putStr("summary", v)
    var target: String
        get() = str("target", "en")
        set(v) = putStr("target", v)

    fun effortIdx(model: String) = int("effort_$model", 0)
    fun setEffortIdx(model: String, i: Int) = putInt("effort_$model", i)

    private fun list(k: String): MutableList<String> = try {
        val a = JSONArray(str(k, "[]"))
        MutableList(a.length()) { a.getString(it) }
    } catch (e: Exception) { mutableListOf() }

    private fun saveList(k: String, l: List<String>) = putStr(k, JSONArray(l).toString())

    fun clips(): MutableList<String> = list("clips")
    fun saveClips(l: List<String>) = saveList("clips", l)
    fun addClip(t: String) {
        if (t.isBlank() || t.length > 8000) return
        val l = clips()
        l.remove(t)
        l.add(0, t)
        saveClips(l.take(30))
    }

    fun recentEmoji(): MutableList<String> = list("recent_emoji")
    fun addRecentEmoji(e: String) {
        val l = recentEmoji()
        l.remove(e)
        l.add(0, e)
        saveList("recent_emoji", l.take(32))
    }
}
