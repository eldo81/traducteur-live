package com.dioneo.call

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import org.json.JSONArray
import org.json.JSONObject

enum class Transport(val label: String) { UDP("UDP"), TCP("TCP"), TLS("TLS (chiffré)") }

/** Format du numéro envoyé à l'opérateur SIP (chaque opérateur a sa convention). */
enum class DialFormat(val label: String) {
    PLUS_E164("+32470123456"),
    E164("32470123456"),
    DOUBLE_ZERO("0032470123456");

    fun apply(e164: String): String {
        val digits = e164.removePrefix("+")
        return when (this) {
            PLUS_E164 -> "+$digits"
            E164 -> digits
            DOUBLE_ZERO -> "00$digits"
        }
    }
}

data class Provider(
    val name: String,
    val domain: String,
    val transport: Transport,
    val format: DialFormat,
    val note: String,
)

val PROVIDERS = listOf(
    Provider(
        "Telnyx", "sip.telnyx.com", Transport.TLS, DialFormat.PLUS_E164,
        "Portail Telnyx → SIP Connections → type Credentials. Associez un Outbound Voice Profile " +
            "et autorisez les pays de destination (Belgique, Sénégal…)."
    ),
    Provider(
        "Zadarma", "sip.zadarma.com", Transport.UDP, DialFormat.E164,
        "Espace client Zadarma → Paramètres → Numéros SIP : identifiant à 6 chiffres + mot de passe SIP."
    ),
    Provider(
        "Serveur perso (Asterisk / FreeSWITCH / FusionPBX)", "", Transport.TLS, DialFormat.PLUS_E164,
        "Votre PBX route les appels vers le trunk le moins cher (LCR)."
    ),
)

data class SipConfig(
    val provider: String = PROVIDERS[0].name,
    val username: String = "",
    val password: String = "",
    val domain: String = PROVIDERS[0].domain,
    val proxy: String = "",
    val authId: String = "",
    val transport: Transport = Transport.TLS,
    val format: DialFormat = DialFormat.PLUS_E164,
    val srtp: Boolean = false,
    val stun: Boolean = true,
) {
    val isComplete get() = username.isNotBlank() && password.isNotBlank() && domain.isNotBlank()
}

data class Rate(val prefix: String, val label: String, val perMin: Double)

/**
 * Tarifs INDICATIFS par minute, à aligner sur la grille réelle de votre opérateur
 * (onglet « Tarifs » de l'app). Correspondance par préfixe le plus long.
 */
val DEFAULT_RATES = listOf(
    Rate("32", "Belgique fixe", 0.015),
    Rate("324", "Belgique mobile", 0.06),
    Rate("33", "France fixe", 0.012),
    Rate("336", "France mobile", 0.025),
    Rate("337", "France mobile", 0.025),
    Rate("31", "Pays-Bas fixe", 0.015),
    Rate("316", "Pays-Bas mobile", 0.06),
    Rate("352", "Luxembourg fixe", 0.02),
    Rate("3526", "Luxembourg mobile", 0.09),
    Rate("221", "Sénégal fixe", 0.18),
    Rate("2217", "Sénégal mobile", 0.22),
    Rate("225", "Côte d'Ivoire", 0.20),
    Rate("212", "Maroc fixe", 0.10),
    Rate("2126", "Maroc mobile", 0.30),
    Rate("2127", "Maroc mobile", 0.30),
    Rate("223", "Mali", 0.30),
    Rate("224", "Guinée", 0.30),
    Rate("237", "Cameroun", 0.20),
    Rate("1", "USA / Canada", 0.01),
    Rate("44", "Royaume-Uni fixe", 0.012),
    Rate("447", "Royaume-Uni mobile", 0.03),
    Rate("49", "Allemagne fixe", 0.015),
    Rate("491", "Allemagne mobile", 0.05),
    Rate("86", "Chine", 0.02),
    Rate("971", "Émirats arabes unis", 0.15),
)

class Prefs(context: Context) {
    private val sp: SharedPreferences = try {
        val key = MasterKey.Builder(context).setKeyScheme(MasterKey.KeyScheme.AES256_GCM).build()
        EncryptedSharedPreferences.create(
            context, "dioneo_secure", key,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    } catch (e: Exception) {
        context.getSharedPreferences("dioneo_plain", Context.MODE_PRIVATE)
    }

    var sip: SipConfig
        get() = SipConfig(
            provider = sp.getString("provider", PROVIDERS[0].name)!!,
            username = sp.getString("username", "")!!,
            password = sp.getString("password", "")!!,
            domain = sp.getString("domain", PROVIDERS[0].domain)!!,
            proxy = sp.getString("proxy", "")!!,
            authId = sp.getString("authId", "")!!,
            transport = runCatching { Transport.valueOf(sp.getString("transport", "TLS")!!) }.getOrDefault(Transport.TLS),
            format = runCatching { DialFormat.valueOf(sp.getString("format", "PLUS_E164")!!) }.getOrDefault(DialFormat.PLUS_E164),
            srtp = sp.getBoolean("srtp", false),
            stun = sp.getBoolean("stun", true),
        )
        set(c) {
            sp.edit()
                .putString("provider", c.provider).putString("username", c.username.trim())
                .putString("password", c.password).putString("domain", c.domain.trim())
                .putString("proxy", c.proxy.trim()).putString("authId", c.authId.trim())
                .putString("transport", c.transport.name).putString("format", c.format.name)
                .putBoolean("srtp", c.srtp).putBoolean("stun", c.stun)
                .apply()
        }

    var region: String
        get() = sp.getString("region", "BE")!!
        set(v) = sp.edit().putString("region", v).apply()

    var currency: String
        get() = sp.getString("currency", "€")!!
        set(v) = sp.edit().putString("currency", v).apply()

    var rates: List<Rate>
        get() {
            val raw = sp.getString("rates", null) ?: return DEFAULT_RATES
            return runCatching {
                val arr = JSONArray(raw)
                (0 until arr.length()).map {
                    val o = arr.getJSONObject(it)
                    Rate(o.getString("p"), o.getString("l"), o.getDouble("r"))
                }
            }.getOrDefault(DEFAULT_RATES)
        }
        set(list) {
            val arr = JSONArray()
            list.forEach { arr.put(JSONObject().put("p", it.prefix).put("l", it.label).put("r", it.perMin)) }
            sp.edit().putString("rates", arr.toString()).apply()
        }

    fun rateFor(e164: String): Rate? {
        val digits = e164.removePrefix("+")
        return rates.filter { digits.startsWith(it.prefix) }.maxByOrNull { it.prefix.length }
    }
}
