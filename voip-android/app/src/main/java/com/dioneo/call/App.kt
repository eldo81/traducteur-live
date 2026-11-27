package com.dioneo.call

import android.app.Application
import android.app.NotificationChannel
import android.app.NotificationManager

class App : Application() {
    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(NotificationManager::class.java)
        nm.createNotificationChannel(
            NotificationChannel(CallService.CHANNEL_ONGOING, "Appel en cours", NotificationManager.IMPORTANCE_LOW)
        )
        nm.createNotificationChannel(
            NotificationChannel(CallService.CHANNEL_INCOMING, "Appels entrants", NotificationManager.IMPORTANCE_HIGH)
        )
        Sip.init(this)
    }
}
