package com.dioneo.call

import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat

/** Garde l'appel vivant écran éteint / app en arrière-plan (service premier plan « micro »). */
class CallService : Service() {
    companion object {
        const val CHANNEL_ONGOING = "ongoing_call"
        const val CHANNEL_INCOMING = "incoming_call"
        const val EXTRA_INCOMING = "incoming"
        private const val NOTIF_ID = 42
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val incoming = intent?.getBooleanExtra(EXTRA_INCOMING, false) ?: false
        val open = PendingIntent.getActivity(
            this, 0, Intent(this, CallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val hang = PendingIntent.getBroadcast(
            this, 1, Intent(this, HangupReceiver::class.java),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        val number = Sip.call.value?.number ?: ""
        val builder = NotificationCompat.Builder(this, if (incoming) CHANNEL_INCOMING else CHANNEL_ONGOING)
            .setSmallIcon(R.drawable.ic_stat_call)
            .setContentTitle(if (incoming) "Appel entrant" else "Appel Dioneo Call")
            .setContentText(number)
            .setOngoing(true)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setContentIntent(open)
            .addAction(0, if (incoming) "Refuser" else "Raccrocher", hang)
        if (incoming) {
            builder.setPriority(NotificationCompat.PRIORITY_HIGH).setFullScreenIntent(open, true)
        }
        val type = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE else 0
        ServiceCompat.startForeground(this, NOTIF_ID, builder.build(), type)
        return START_NOT_STICKY
    }
}

class HangupReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        Sip.hangup()
    }
}
