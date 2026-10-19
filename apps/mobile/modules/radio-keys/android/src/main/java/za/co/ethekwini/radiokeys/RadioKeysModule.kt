package za.co.ethekwini.radiokeys

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
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
 */
class RadioKeysModule : Module() {
  private var receiver: BroadcastReceiver? = null

  override fun definition() = ModuleDefinition {
    Name("RadioKeys")
    Events(EVENT)

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
