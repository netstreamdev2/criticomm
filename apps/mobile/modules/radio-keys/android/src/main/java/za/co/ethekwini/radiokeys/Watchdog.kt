package za.co.ethekwini.radiokeys

import android.app.AlarmManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.PowerManager
import android.os.SystemClock
import android.provider.Telephony

/**
 * Keeping a radio or hard hat on the air with nobody to look after it.
 *
 *   * The watchdog: an alarm every few minutes that Android delivers even in
 *     deep sleep. The app's code checks in (beat) every time it reports to
 *     the Radio Desk; when it has been quiet too long (crashed, killed for
 *     memory, frozen by the maker's power saver), the alarm wakes the device
 *     and opens the app, which starts everything again.
 *   * Wake by SMS: a text that says HIKTECH WAKE opens the app the same way.
 *     A text gets through deep sleep when nothing else does.
 *   * The home screen: on a radio or hard hat, HikTech can be the device's
 *     home screen (the HikTechHome alias), so Android itself brings it back.
 *     Ordinary phones never see it: the alias is off unless switched on.
 *
 * Only on devices where the app switched the watchdog on (radios and hard
 * hats, on duty). Nothing here can change the device beyond this app.
 */
object Watchdog {
  private const val PREF_ARMED = "watchdogArmed"
  private const val PREF_BEAT = "watchdogBeat"
  /** How often the alarm comes (Android allows about one every 9 minutes in deep sleep). */
  private const val EVERY_MS = 5 * 60_000L
  /** Quiet this long, and the app is opened again. */
  private const val QUIET_MS = 4 * 60_000L
  const val HOME_ALIAS = "za.co.ethekwini.criticom.HikTechHome"

  private fun prefs(context: Context) = context.getSharedPreferences(RadioKeysModule.PREFS, Context.MODE_PRIVATE)

  fun beat(context: Context) {
    prefs(context).edit().putLong(PREF_BEAT, System.currentTimeMillis()).apply()
  }

  fun arm(context: Context, on: Boolean) {
    prefs(context).edit().putBoolean(PREF_ARMED, on).apply()
    if (on) {
      beat(context)
      schedule(context)
    } else {
      alarms(context)?.cancel(pending(context))
    }
  }

  fun armed(context: Context) = prefs(context).getBoolean(PREF_ARMED, false)

  private fun alarms(context: Context) = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager

  private fun pending(context: Context): PendingIntent {
    val flags = PendingIntent.FLAG_UPDATE_CURRENT or (if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) PendingIntent.FLAG_IMMUTABLE else 0)
    return PendingIntent.getBroadcast(context, 7302, Intent(context, WatchdogReceiver::class.java), flags)
  }

  fun schedule(context: Context) {
    val am = alarms(context) ?: return
    val at = SystemClock.elapsedRealtime() + EVERY_MS
    try {
      when {
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !am.canScheduleExactAlarms() ->
          am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pending(context))
        Build.VERSION.SDK_INT >= Build.VERSION_CODES.M ->
          am.setExactAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pending(context))
        else -> am.setExact(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pending(context))
      }
    } catch (_: SecurityException) {
      am.setAndAllowWhileIdle(AlarmManager.ELAPSED_REALTIME_WAKEUP, at, pending(context))
    }
  }

  /** Quiet too long: wake the screen briefly and open the app, which starts everything again. */
  fun checkAndRevive(context: Context, force: Boolean = false) {
    val quiet = System.currentTimeMillis() - prefs(context).getLong(PREF_BEAT, 0L)
    if (!force && quiet < QUIET_MS) return
    wakeAndOpen(context)
  }

  @Suppress("DEPRECATION")
  fun wakeAndOpen(context: Context) {
    try {
      val power = context.getSystemService(Context.POWER_SERVICE) as PowerManager
      power.newWakeLock(
        PowerManager.FULL_WAKE_LOCK or PowerManager.ACQUIRE_CAUSES_WAKEUP or PowerManager.ON_AFTER_RELEASE,
        "hiktech:revive",
      ).acquire(10_000L)
    } catch (_: Exception) { /* opening the app still helps */ }
    val open = context.packageManager.getLaunchIntentForPackage(context.packageName)
      ?.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED) ?: return
    try {
      context.startActivity(open)
    } catch (_: Exception) { /* Android refused; the next alarm tries again */ }
  }

  /** HikTech as the device's home screen (radios and hard hats only). */
  fun setHome(context: Context, on: Boolean) {
    context.packageManager.setComponentEnabledSetting(
      ComponentName(context.packageName, HOME_ALIAS),
      if (on) PackageManager.COMPONENT_ENABLED_STATE_ENABLED else PackageManager.COMPONENT_ENABLED_STATE_DISABLED,
      PackageManager.DONT_KILL_APP,
    )
  }

  fun isHome(context: Context): Boolean =
    context.packageManager.getComponentEnabledSetting(ComponentName(context.packageName, HOME_ALIAS)) ==
      PackageManager.COMPONENT_ENABLED_STATE_ENABLED
}

/** The watchdog's alarm: check, revive if quiet, and come again. */
class WatchdogReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (!Watchdog.armed(context)) return
    Watchdog.schedule(context)
    Watchdog.checkAndRevive(context)
  }
}

/** A text that says HIKTECH WAKE opens the app: it gets through deep sleep when nothing else does. */
class SmsWakeReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (intent?.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
    if (!Watchdog.armed(context)) return
    val body = try {
      Telephony.Sms.Intents.getMessagesFromIntent(intent).joinToString("") { it.messageBody ?: "" }
    } catch (_: Exception) {
      ""
    }
    if (body.uppercase().contains("HIKTECH WAKE")) Watchdog.wakeAndOpen(context)
  }
}
