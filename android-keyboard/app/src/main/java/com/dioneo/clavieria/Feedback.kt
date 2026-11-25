package com.dioneo.clavieria

import android.content.Context
import android.media.AudioManager
import android.os.Build
import android.os.VibrationEffect
import android.os.Vibrator
import android.os.VibratorManager

/** Retour haptique « clavier iPhone » : petit clic net, sans traîne. */
class Feedback(ctx: Context) {
    private val vibrator: Vibrator? =
        if (Build.VERSION.SDK_INT >= 31) ctx.getSystemService(VibratorManager::class.java)?.defaultVibrator
        else ctx.getSystemService(Context.VIBRATOR_SERVICE) as? Vibrator
    private val audio: AudioManager? = ctx.getSystemService(AudioManager::class.java)

    fun key(type: KType, p: Prefs) {
        vibrate(p.haptic)
        if (p.sound) {
            val fx = when (type) {
                KType.BACKSPACE -> AudioManager.FX_KEYPRESS_DELETE
                KType.SPACE -> AudioManager.FX_KEYPRESS_SPACEBAR
                KType.ENTER -> AudioManager.FX_KEYPRESS_RETURN
                else -> AudioManager.FX_KEYPRESS_STANDARD
            }
            audio?.playSoundEffect(fx, 0.4f)
        }
    }

    /** Micro-tic (glissé du trackpad, sélection d'accent, boutons). */
    fun tick(p: Prefs) {
        if (p.haptic > 0) vibrate(1)
    }

    fun preview(level: Int) = vibrate(level)

    private fun vibrate(level: Int) {
        val v = vibrator ?: return
        if (level <= 0) return
        try {
            if (!v.hasVibrator()) return
            val amp = v.hasAmplitudeControl()
            val effect = when {
                Build.VERSION.SDK_INT >= 29 && level == 1 -> VibrationEffect.createPredefined(VibrationEffect.EFFECT_TICK)
                Build.VERSION.SDK_INT >= 29 && level == 2 -> VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK)
                level == 1 -> VibrationEffect.createOneShot(8, if (amp) 90 else VibrationEffect.DEFAULT_AMPLITUDE)
                level == 2 -> VibrationEffect.createOneShot(14, if (amp) 170 else VibrationEffect.DEFAULT_AMPLITUDE)
                else -> VibrationEffect.createOneShot(22, if (amp) 255 else VibrationEffect.DEFAULT_AMPLITUDE)
            }
            v.vibrate(effect)
        } catch (_: Exception) {
        }
    }
}
