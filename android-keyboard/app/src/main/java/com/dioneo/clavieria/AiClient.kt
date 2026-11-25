package com.dioneo.clavieria

import android.os.Handler
import android.os.Looper
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.HttpURLConnection
import java.net.SocketTimeoutException
import java.net.URL
import java.net.UnknownHostException
import java.util.concurrent.Executors

/**
 * Client OpenAI (Chat Completions, en streaming).
 * - choisit seul le meilleur modèle « mini » disponible sur le compte (gpt-X.Y-mini le plus récent) ;
 * - s'adapte si le modèle refuse le streaming ou le niveau de raisonnement ;
 * - le texte n'est envoyé qu'à api.openai.com, uniquement quand l'utilisateur touche un bouton IA.
 */
class AiClient(private val prefs: Prefs) {
    class ApiError(val code: Int, msg: String) : Exception(msg)

    private val exec = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    @Volatile private var gen = 0
    @Volatile private var conn: HttpURLConnection? = null

    fun cancel() {
        gen++
        val c = conn
        conn = null
        if (c != null) Thread { try { c.disconnect() } catch (_: Exception) {} }.start()
    }

    fun run(
        system: String,
        user: String,
        onDelta: (String) -> Unit,
        onDone: (String, String) -> Unit,
        onError: (String) -> Unit,
    ) {
        cancel()
        val my = gen
        exec.execute {
            try {
                val (text, model) = complete(system, user, my) { partial ->
                    main.post { if (gen == my) onDelta(partial) }
                }
                main.post { if (gen == my) onDone(text, model) }
            } catch (e: Exception) {
                if (gen == my) {
                    val m = humanError(e)
                    main.post { if (gen == my) onError(m) }
                }
            }
        }
    }

    private fun complete(system: String, user: String, my: Int, onDelta: (String) -> Unit): Pair<String, String> {
        val key = prefs.apiKey
        if (key.isBlank()) throw ApiError(0, "Clé API manquante : ouvrez les réglages du clavier.")
        var model = prefs.model.ifBlank { prefs.autoModel.ifBlank { detectModel(key).also { prefs.autoModel = it } } }
        var redetected = false
        var stream = prefs.streamOk
        var effortIdx = prefs.effortIdx(model)
        repeat(7) {
            try {
                val effort = if (isReasoning(model)) EFFORTS.getOrNull(effortIdx) else null
                return Pair(chat(key, model, system, user, stream, effort, my, onDelta), model)
            } catch (e: ApiError) {
                val m = (e.message ?: "").lowercase()
                when {
                    e.code == 400 && "reasoning" in m && isReasoning(model) && effortIdx < EFFORTS.size -> {
                        effortIdx++
                        prefs.setEffortIdx(model, effortIdx)
                    }
                    e.code == 400 && "stream" in m && stream -> {
                        stream = false
                        prefs.streamOk = false
                    }
                    (e.code == 404 || (e.code == 400 && "model" in m)) && prefs.model.isBlank() && !redetected -> {
                        redetected = true
                        model = detectModel(key, exclude = model)
                        prefs.autoModel = model
                        effortIdx = prefs.effortIdx(model)
                    }
                    else -> throw e
                }
            }
        }
        throw ApiError(0, "Échec après plusieurs essais.")
    }

    private fun isReasoning(model: String) = model.startsWith("gpt-5") || Regex("^o\\d").containsMatchIn(model)

    private fun open(url: String, key: String): HttpURLConnection {
        val c = URL(url).openConnection() as HttpURLConnection
        c.connectTimeout = 15000
        c.readTimeout = 60000
        c.setRequestProperty("Authorization", "Bearer $key")
        return c
    }

    private fun chat(
        key: String, model: String, system: String, user: String,
        stream: Boolean, effort: String?, my: Int, onDelta: (String) -> Unit,
    ): String {
        val body = JSONObject()
            .put("model", model)
            .put(
                "messages", JSONArray()
                    .put(JSONObject().put("role", "system").put("content", system))
                    .put(JSONObject().put("role", "user").put("content", user))
            )
        if (stream) body.put("stream", true)
        if (effort != null) body.put("reasoning_effort", effort)

        val c = open("$API/chat/completions", key)
        conn = c
        try {
            c.requestMethod = "POST"
            c.doOutput = true
            c.setRequestProperty("Content-Type", "application/json")
            c.outputStream.use { it.write(body.toString().toByteArray(Charsets.UTF_8)) }
            val code = c.responseCode
            if (code !in 200..299) throw ApiError(code, errorMessage(c))
            val reader = BufferedReader(InputStreamReader(c.inputStream, Charsets.UTF_8))
            if (!stream) {
                val msg = JSONObject(reader.readText()).getJSONArray("choices").getJSONObject(0).getJSONObject("message")
                return if (msg.isNull("content")) "" else msg.optString("content")
            }
            val sb = StringBuilder()
            while (gen == my) {
                val line = reader.readLine() ?: break
                if (!line.startsWith("data:")) continue
                val data = line.substring(5).trim()
                if (data == "[DONE]") break
                val j = try { JSONObject(data) } catch (e: Exception) { continue }
                val d = j.optJSONArray("choices")?.optJSONObject(0)?.optJSONObject("delta") ?: continue
                if (d.isNull("content")) continue
                val piece = d.optString("content")
                if (piece.isNotEmpty()) {
                    sb.append(piece)
                    onDelta(sb.toString())
                }
            }
            return sb.toString()
        } finally {
            if (conn === c) conn = null
            try { c.disconnect() } catch (_: Exception) {}
        }
    }

    private fun errorMessage(c: HttpURLConnection): String {
        val raw = try { c.errorStream?.bufferedReader()?.readText() ?: "" } catch (_: Exception) { "" }
        return try { JSONObject(raw).getJSONObject("error").optString("message", raw) } catch (_: Exception) { raw.take(300) }
    }

    fun listModels(key: String): List<String> {
        val c = open("$API/models", key)
        try {
            val code = c.responseCode
            if (code !in 200..299) throw ApiError(code, errorMessage(c))
            val arr = JSONObject(c.inputStream.bufferedReader().readText()).getJSONArray("data")
            return (0 until arr.length()).map { arr.getJSONObject(it).getString("id") }
        } finally {
            c.disconnect()
        }
    }

    /** Le plus récent gpt-X(.Y)-mini du compte : rapide, bon marché, excellent en rédaction. */
    fun detectModel(key: String, exclude: String? = null): String {
        val ids = try {
            listModels(key).filter { it != exclude }
        } catch (e: ApiError) {
            if (e.code == 401) throw e
            return if (exclude == "gpt-4.1-mini") "gpt-4o-mini" else "gpt-4.1-mini"
        }
        val re = Regex("^gpt-(\\d+)(?:\\.(\\d+))?-mini$")
        val best = ids.mapNotNull { id ->
            re.matchEntire(id)?.let { m -> Triple(id, m.groupValues[1].toInt(), m.groupValues[2].toIntOrNull() ?: 0) }
        }.maxWithOrNull(compareBy<Triple<String, Int, Int>>({ it.second }, { it.third }))
        if (best != null) return best.first
        for (c in listOf("gpt-4.1-mini", "gpt-4o-mini", "gpt-4.1", "gpt-4o")) if (c in ids) return c
        val skip = Regex("realtime|audio|transcribe|tts|search|image|codex|oss|embedding")
        return ids.firstOrNull { it.startsWith("gpt-") && !skip.containsMatchIn(it) } ?: "gpt-4o-mini"
    }

    fun humanError(e: Exception): String = when {
        e is ApiError && e.code == 401 -> "Clé API refusée (401). Vérifiez-la dans les réglages."
        e is ApiError && e.code == 429 ->
            if ("quota" in (e.message ?: "").lowercase()) "Crédit OpenAI épuisé (429) : rechargez le compte."
            else "Trop de requêtes (429), réessayez dans un instant."
        e is ApiError && e.code == 0 -> e.message ?: "Erreur"
        e is ApiError -> "Erreur ${e.code} : ${(e.message ?: "").take(160)}"
        e is UnknownHostException -> "Pas de connexion Internet."
        e is SocketTimeoutException -> "Délai dépassé (réseau lent)."
        else -> e.message ?: e.javaClass.simpleName
    }

    companion object {
        const val API = "https://api.openai.com/v1"
        /** Du plus rapide au plus lent ; la dernière valeur (hors liste) = paramètre omis. */
        val EFFORTS = listOf("none", "minimal", "low")
    }
}
