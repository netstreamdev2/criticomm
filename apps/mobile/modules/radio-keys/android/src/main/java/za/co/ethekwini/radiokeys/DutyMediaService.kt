package za.co.ethekwini.radiokeys

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder

/**
 * The camera's standby while on duty (0091).
 *
 * Android lets an app use the camera and microphone with its screen off only
 * from a foreground service of those types, and only one started while the
 * app was on screen. The app starts this one when the officer goes on duty
 * with the app open, so the control room can open the radio's camera later,
 * screen off or not. It does nothing by itself: the camera is opened only
 * when the control room asks, and the officer is told each time.
 *
 * Not restarted by the system (START_NOT_STICKY): Android would refuse it
 * from the background anyway; the app starts it again when next opened.
 */
class DutyMediaService : Service() {
  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val manager = getSystemService(NotificationManager::class.java)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager?.createNotificationChannel(
        NotificationChannel(CHANNEL, intent?.getStringExtra(EXTRA_CHANNEL) ?: "Camera standby", NotificationManager.IMPORTANCE_MIN).apply {
          setShowBadge(false)
        },
      )
    }
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val open = launch?.let { PendingIntent.getActivity(this, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT) }
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
    val notification = builder
      .setSmallIcon(applicationInfo.icon)
      .setContentTitle(intent?.getStringExtra(EXTRA_TITLE) ?: "On duty")
      .setContentText(intent?.getStringExtra(EXTRA_TEXT) ?: "Camera ready for the control room")
      .setOngoing(true)
      .setContentIntent(open)
      .build()

    try {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        startForeground(ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE)
      } else {
        startForeground(ID, notification)
      }
    } catch (e: Exception) {
      // No camera or microphone permission, or started from the background:
      // no standby, nothing else breaks.
      stopSelf()
    }
    return START_NOT_STICKY
  }

  companion object {
    const val CHANNEL = "criticom-camera-standby"
    const val ID = 481757
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val EXTRA_CHANNEL = "channel"
  }
}
