package com.dioneo.call

import com.google.i18n.phonenumbers.NumberParseException
import com.google.i18n.phonenumbers.PhoneNumberUtil
import com.google.i18n.phonenumbers.PhoneNumberUtil.PhoneNumberFormat
import com.google.i18n.phonenumbers.PhoneNumberUtil.PhoneNumberType
import java.util.Locale

data class Country(val region: String, val code: Int, val name: String) {
    val flag: String get() = flagOf(region)
}

data class ParsedNumber(
    val e164: String,
    val international: String,
    val region: String?,
    val valid: Boolean,
    val typeLabel: String,
)

fun flagOf(region: String?): String {
    if (region == null || region.length != 2) return "🌐"
    val base = 0x1F1E6 - 'A'.code
    return String(Character.toChars(base + region[0].uppercaseChar().code)) +
        String(Character.toChars(base + region[1].uppercaseChar().code))
}

object Phone {
    private val util: PhoneNumberUtil = PhoneNumberUtil.getInstance()

    val countries: List<Country> by lazy {
        util.supportedRegions.map {
            Country(it, util.getCountryCodeForRegion(it), Locale("", it).getDisplayCountry(Locale.FRENCH))
        }.sortedBy { it.name }
    }

    fun country(region: String): Country =
        countries.firstOrNull { it.region == region } ?: Country(region, util.getCountryCodeForRegion(region), region)

    /** Accepte 0470 12 34 56, +32 470…, 0032 470…, 00221 77… */
    fun parse(input: String, defaultRegion: String): ParsedNumber? {
        var s = input.trim().replace(Regex("[^0-9+*#]"), "")
        if (s.isEmpty()) return null
        if (s.startsWith("00")) s = "+" + s.drop(2)
        return try {
            val n = util.parse(s, defaultRegion)
            if (!util.isPossibleNumber(n)) return null
            val type = when (util.getNumberType(n)) {
                PhoneNumberType.MOBILE -> "Mobile"
                PhoneNumberType.FIXED_LINE -> "Fixe"
                PhoneNumberType.FIXED_LINE_OR_MOBILE -> "Fixe ou mobile"
                PhoneNumberType.TOLL_FREE -> "Numéro gratuit"
                PhoneNumberType.PREMIUM_RATE -> "Surtaxé ⚠"
                PhoneNumberType.VOIP -> "VoIP"
                else -> "Inconnu"
            }
            ParsedNumber(
                e164 = util.format(n, PhoneNumberFormat.E164),
                international = util.format(n, PhoneNumberFormat.INTERNATIONAL),
                region = util.getRegionCodeForNumber(n),
                valid = util.isValidNumber(n),
                typeLabel = type,
            )
        } catch (e: NumberParseException) {
            null
        }
    }
}
