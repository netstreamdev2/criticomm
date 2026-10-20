package za.co.ethekwini.radiokeys

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The push-to-talk radio's own buttons, heard by the HikTech app.
 *
 * The Estalky E977's system sends "android.intent.action.SOS.down" when the
 * orange SOS key is pressed and "...SOS.up" when it is let go (found on the
 * radio itself; PocStar's app listens for the same). Listened for only while
 * the app asks (the SOS button is on screen), so nothing runs when it is not.
 *
 * Also the radio's battery, for the Radio Desk (0087): read from the
 * system's last battery report when asked, so nothing runs in between.
 *
 * And the camera's standby while on duty (DutyMediaService, 0091).
 */
class RadioKeysModule : Module() {
  private var receiver: BroadcastReceiver? = null

  override fun definition() = ModuleDefinition {
    Name("RadioKeys")
    Events(EVENT)

    // {"level": 0-100 or -1, "charging": true/false}; null when the system has not said.
    Function("battery") {
      val context = appContext.reactContext ?: return@Function null
      val status = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED)) ?: return@Function null
      val level = status.getIntExtra(BatteryManager.EXTRA_LEVEL, -1)
      val scale = status.getIntExtra(BatteryManager.EXTRA_SCALE, -1)
      val state = status.getIntExtra(BatteryManager.EXTRA_STATUS, -1)
      mapOf(
        "level" to if (level >= 0 && scale > 0) level * 100 / scale else -1,
        "charging" to (state == BatteryManager.BATTERY_STATUS_CHARGING || state == BatteryManager.BATTERY_STATUS_FULL),
      )
    }

    // The camera's standby: started with the app on screen, on duty. True when it was asked to start.
    Function("startDutyMedia") { title: String, text: String, channel: String ->
      val context = appContext.reactContext ?: return@Function false
      val intent = Intent(context, DutyMediaService::class.java)
        .putExtra(DutyMediaService.EXTRA_TITLE, title)
        .putExtra(DutyMediaService.EXTRA_TEXT, text)
        .putExtra(DutyMediaService.EXTRA_CHANNEL, channel)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
        true
      } catch (e: Exception) {
        false
      }
    }

    Function("stopDutyMedia") {
      val context = appContext.reactContext ?: return@Function false
      context.stopService(Intent(context, DutyMediaService::class.java))
    }

    OnStartObserving { start() }
    OnStopObserving { stop() }
    OnDestroy { stop() }
  }

  private fun start() {
    if (receiver != null) return
    val context = appContext.reactContext ?: return
    val r = object : BroadcastReceiver() {
      override fun onReceive(c: Context?, intent: Intent?) {
        val action = intent?.action ?: return
        if (action != SOS_DOWN && action != SOS_UP) return
        sendEvent(EVENT, mapOf("key" to "sos", "pressed" to (action == SOS_DOWN), "at" to System.currentTimeMillis().toDouble()))
      }
    }
    val filter = IntentFilter().apply {
      addAction(SOS_DOWN)
      addAction(SOS_UP)
    }
    // The radio's system sends it, so it comes from outside the app.
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      context.registerReceiver(r, filter, Context.RECEIVER_EXPORTED)
    } else {
      context.registerReceiver(r, filter)
    }
    receiver = r
  }

  private fun stop() {
    val r = receiver ?: return
    receiver = null
    try {
      appContext.reactContext?.unregisterReceiver(r)
    } catch (_: IllegalArgumentException) {
      // Already gone with the context.
    }
  }

  companion object {
    const val EVENT = "onRadioKey"
    const val SOS_DOWN = "android.intent.action.SOS.down"
    const val SOS_UP = "android.intent.action.SOS.up"
  }
}
