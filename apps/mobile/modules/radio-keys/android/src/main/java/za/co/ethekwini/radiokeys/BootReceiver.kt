package za.co.ethekwini.radiokeys

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.app.Notification

/**
 * A radio or smart hard hat switched on: the app opens by itself, so it
 * signs in to dispatch, the camera and Talk without anyone opening it (a hard
 * hat has no one to). Only where the app asked for it (setOpenOnBoot, on the
 * radios and hard hats). Android 10 and later may not let an app open itself
 * at start-up: then one notification says "Tap to connect", which opens it.
 */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    val action = intent?.action ?: return
    if (action !in STARTS) return
    val prefs = context.getSharedPreferences(RadioKeysModule.PREFS, Context.MODE_PRIVATE)
    if (!prefs.getBoolean(RadioKeysModule.PREF_OPEN_ON_BOOT, false)) return
    val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
      ?: return
    var opened = false
    try {
      context.startActivity(open)
      opened = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
    } catch (_: Exception) {
      opened = false
    }
    if (!opened) tapToConnect(context, open)
  }

  private fun tapToConnect(context: Context, open: Intent) {
    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(NotificationChannel(CHANNEL, "Start-up", NotificationManager.IMPORTANCE_HIGH))
    }
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
    val tap = PendingIntent.getActivity(context, 0, open, flags)
    val icon = context.applicationInfo.icon.takeIf { it != 0 } ?: android.R.drawable.ic_dialog_info
    @Suppress("DEPRECATION")
    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) Notification.Builder(context, CHANNEL) else Notification.Builder(context)
    val note = builder
      .setSmallIcon(icon)
      .setContentTitle("HikTech")
      .setContentText("Tap to connect")
      .setCategory(Notification.CATEGORY_REMINDER)
      .setContentIntent(tap)
      .setFullScreenIntent(tap, true)
      .setAutoCancel(true)
      .build()
    try {
      manager.notify(NOTE_ID, note)
    } catch (_: SecurityException) {
      // Notifications refused: nothing more to do until someone opens the app.
    }
  }

  companion object {
    const val CHANNEL = "hiktech-startup"
    const val NOTE_ID = 7301
    val STARTS = setOf(
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_MY_PACKAGE_REPLACED,
      "android.intent.action.QUICKBOOT_POWERON",
      "com.htc.intent.action.QUICKBOOT_POWERON",
    )
  }
}
