package com.dioneo.clavieria

/** Palette d'un thème de clavier. Les couleurs sont en ARGB. */
data class KbTheme(
    val name: String,
    val bg: Int,
    val keyTop: Int, val keyBottom: Int,
    val modTop: Int, val modBottom: Int,
    val pressedChar: Int, val pressedMod: Int,
    val shadow: Int, val border: Int,
    val text: Int, val modText: Int, val hint: Int,
    val accent: Int, val onAccent: Int,
    val panel: Int, val panelText: Int, val field: Int,
    val balloon: Int, val pill: Int,
    val radiusDp: Float,
)

object Themes {
    val list = listOf(
        // Clavier iPhone clair (iOS 17/18)
        KbTheme(
            "iPhone clair", bg = 0xFFD1D3D9.toInt(),
            keyTop = 0xFFFFFFFF.toInt(), keyBottom = 0xFFFFFFFF.toInt(),
            modTop = 0xFFABB0BA.toInt(), modBottom = 0xFFABB0BA.toInt(),
            pressedChar = 0xFFABB0BA.toInt(), pressedMod = 0xFFFFFFFF.toInt(),
            shadow = 0xFF8A8C91.toInt(), border = 0,
            text = 0xFF000000.toInt(), modText = 0xFF000000.toInt(), hint = 0xFF6E7179.toInt(),
            accent = 0xFF0A84FF.toInt(), onAccent = 0xFFFFFFFF.toInt(),
            panel = 0xFFE4E6EA.toInt(), panelText = 0xFF111114.toInt(), field = 0xFFFFFFFF.toInt(),
            balloon = 0xFFFFFFFF.toInt(), pill = 0xFFEBECEF.toInt(), radiusDp = 6f,
        ),
        // Clavier iPhone sombre
        KbTheme(
            "iPhone sombre", bg = 0xFF2B2B2E.toInt(),
            keyTop = 0xFF6B6B70.toInt(), keyBottom = 0xFF6B6B70.toInt(),
            modTop = 0xFF46464A.toInt(), modBottom = 0xFF46464A.toInt(),
            pressedChar = 0xFF46464A.toInt(), pressedMod = 0xFF6B6B70.toInt(),
            shadow = 0xFF0E0E10.toInt(), border = 0,
            text = 0xFFFFFFFF.toInt(), modText = 0xFFFFFFFF.toInt(), hint = 0xFFA0A0A6.toInt(),
            accent = 0xFF0A84FF.toInt(), onAccent = 0xFFFFFFFF.toInt(),
            panel = 0xFF1F1F22.toInt(), panelText = 0xFFF2F2F5.toInt(), field = 0xFF3A3A3E.toInt(),
            balloon = 0xFF6B6B70.toInt(), pill = 0xFF505055.toInt(), radiusDp = 6f,
        ),
        // Néon : touches noires brillantes, accents verts
        KbTheme(
            "Néon", bg = 0xFF2C2C2E.toInt(),
            keyTop = 0xFF26262A.toInt(), keyBottom = 0xFF050506.toInt(),
            modTop = 0xFF26262A.toInt(), modBottom = 0xFF050506.toInt(),
            pressedChar = 0xFF3C3C42.toInt(), pressedMod = 0xFF3C3C42.toInt(),
            shadow = 0xFF000000.toInt(), border = 0x22FFFFFF,
            text = 0xFFFFFFFF.toInt(), modText = 0xFF3DDC5A.toInt(), hint = 0xFF9A9AA0.toInt(),
            accent = 0xFF3DDC5A.toInt(), onAccent = 0xFF07140A.toInt(),
            panel = 0xFF202022.toInt(), panelText = 0xFFEDEDED.toInt(), field = 0xFF111113.toInt(),
            balloon = 0xFF34343A.toInt(), pill = 0xFF3A3A3E.toInt(), radiusDp = 9f,
        ),
        // Océan
        KbTheme(
            "Océan", bg = 0xFF0F1724.toInt(),
            keyTop = 0xFF223047.toInt(), keyBottom = 0xFF16202F.toInt(),
            modTop = 0xFF16202F.toInt(), modBottom = 0xFF0E1622.toInt(),
            pressedChar = 0xFF2E4260.toInt(), pressedMod = 0xFF2E4260.toInt(),
            shadow = 0xFF04070C.toInt(), border = 0x1838BDF8,
            text = 0xFFF1F6FF.toInt(), modText = 0xFF38BDF8.toInt(), hint = 0xFF8CA0BC.toInt(),
            accent = 0xFF38BDF8.toInt(), onAccent = 0xFF04121C.toInt(),
            panel = 0xFF131D2C.toInt(), panelText = 0xFFE8F0FF.toInt(), field = 0xFF0A111B.toInt(),
            balloon = 0xFF2A3B57.toInt(), pill = 0xFF263650.toInt(), radiusDp = 8f,
        ),
        // Améthyste
        KbTheme(
            "Améthyste", bg = 0xFF1B1624.toInt(),
            keyTop = 0xFF2D2440.toInt(), keyBottom = 0xFF1C1629.toInt(),
            modTop = 0xFF1C1629.toInt(), modBottom = 0xFF140F1E.toInt(),
            pressedChar = 0xFF3D3157.toInt(), pressedMod = 0xFF3D3157.toInt(),
            shadow = 0xFF07050A.toInt(), border = 0x18C084FC,
            text = 0xFFF7F2FF.toInt(), modText = 0xFFC084FC.toInt(), hint = 0xFFA699BC.toInt(),
            accent = 0xFFC084FC.toInt(), onAccent = 0xFF16081F.toInt(),
            panel = 0xFF1F1929.toInt(), panelText = 0xFFF1EAFB.toInt(), field = 0xFF120E19.toInt(),
            balloon = 0xFF3A2E52.toInt(), pill = 0xFF33284A.toInt(), radiusDp = 8f,
        ),
    )

    fun get(i: Int): KbTheme = list.getOrElse(i) { list[0] }
}
