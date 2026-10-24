package za.co.ethekwini.radiokeys

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.net.Uri
import android.os.BatteryManager
import android.os.Build
import android.os.PowerManager
import android.provider.Settings
import android.speech.tts.TextToSpeech
import android.view.KeyEvent
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.bridge.UiThreadUtil
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * The push-to-talk radio's and the smart hard hat's own buttons, heard by the
 * HikTech app.
 *
 * Two ways a button reaches an app:
 *
 *   * A broadcast from the device's system. The Estalky E977 sends
 *     "android.intent.action.SOS.down" / ".up" for its orange SOS key (found on
 *     the radio itself; PocStar listens for the same). Push-to-talk radios
 *     commonly send ".PTT.down" / ".up" the same way; the usual spellings are
 *     listened for. These arrive with the screen off, as long as the app runs.
 *   * A key press, while the app is on screen (MainActivity hands every key
 *     here, see plugins/with-radio-keys.js). Which key code is the talk button
 *     and which the SOS differs by device: the app learns it (the Buttons
 *     screen) and tells this module with setKeyMap. Only those keys are kept
 *     from the rest of the app; every other key goes on as normal.
 *
 * Also the radio's battery, for the Radio Desk (0087); the on-duty standby
 * (DutyMediaService, 0091); opening the app when the device starts (a hard
 * hat has no one to open it); and asking to be left out of battery saving.
 */
class RadioKeysModule : Module() {
  private var receiver: BroadcastReceiver? = null
  /** The background task that keeps the app's timers running with the screen off (keepJsRunning). */
  private var keepTask: Int? = null
  /** Spoken words for a device with no proper screen (the hard hat: "Paired to …"). */
  private var tts: TextToSpeech? = null
  private var ttsReady = false
  private var ttsWaiting: String? = null

  override fun definition() = ModuleDefinition {
    Name("RadioKeys")
    Events(EVENT, TICK_EVENT, FIX_EVENT, HARDWARE_EVENT)

    OnCreate {
      // The standby speaks to the app's code while it is running.
      DutyMediaService.onTick = { sendEvent(TICK_EVENT, mapOf("at" to System.currentTimeMillis().toDouble())) }
      DutyMediaService.onFix = { fix -> sendEvent(FIX_EVENT, fix) }
      // Key presses from the screen; buttons from the system, screen off included.
      KeyHub.emit = { name, body -> sendEvent(name, body) }
      start()
    }

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

    // As startDutyMedia, and with plain GPS and the processor kept awake on a device without Google services.
    Function("startDutyStandby") { title: String, text: String, channel: String, plainGps: Boolean ->
      val context = appContext.reactContext ?: return@Function false
      val intent = Intent(context, DutyMediaService::class.java)
        .putExtra(DutyMediaService.EXTRA_TITLE, title)
        .putExtra(DutyMediaService.EXTRA_TEXT, text)
        .putExtra(DutyMediaService.EXTRA_CHANNEL, channel)
        .putExtra(DutyMediaService.EXTRA_PLAIN_GPS, plainGps)
      try {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) context.startForegroundService(intent) else context.startService(intent)
        true
      } catch (e: Exception) {
        false
      }
    }

    // Google services present (the usual location works) or not (the H1 hard hat).
    Function("hasGoogleServices") {
      val context = appContext.reactContext ?: return@Function true
      try {
        context.packageManager.getPackageInfo("com.google.android.gms", 0)
        true
      } catch (_: Exception) {
        false
      }
    }

    Function("stopDutyMedia") {
      val context = appContext.reactContext ?: return@Function false
      context.stopService(Intent(context, DutyMediaService::class.java))
    }

    // The key codes learned for this device's talk and SOS buttons (the Buttons screen).
    Function("setKeyMap") { ptt: List<Int>, sos: List<Int> ->
      KeyHub.ptt = ptt.toSet()
      KeyHub.sos = sos.toSet()
      true
    }

    // Open the app when the device starts (BootReceiver): radios and hard hats.
    Function("setOpenOnBoot") { on: Boolean ->
      val context = appContext.reactContext ?: return@Function false
      context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().putBoolean(PREF_OPEN_ON_BOOT, on).apply()
      true
    }

    // The watchdog (Watchdog.kt): on, the app is opened again whenever it goes quiet; beat says it is alive.
    Function("armWatchdog") { on: Boolean ->
      val context = appContext.reactContext ?: return@Function false
      Watchdog.arm(context, on)
      true
    }
    Function("beat") {
      val context = appContext.reactContext ?: return@Function false
      Watchdog.beat(context)
      true
    }

    // React Native pauses the app's timers when it is not on screen, unless a background
    // task runs; on duty a radio's camera and Talk need them (2026-10-23). A task that
    // never ends (JS: HikTechKeepRunning) while on; finished when off.
    Function("keepJsRunning") { on: Boolean ->
      val context = appContext.reactContext as? ReactContext ?: return@Function false
      UiThreadUtil.runOnUiThread {
        try {
          val tasks = HeadlessJsTaskContext.getInstance(context)
          val id = keepTask
          if (on && id == null) {
            keepTask = tasks.startTask(HeadlessJsTaskConfig("HikTechKeepRunning", Arguments.createMap(), 0, true))
          } else if (!on && id != null) {
            keepTask = null
            if (tasks.isTaskRunning(id)) tasks.finishTask(id)
          }
        } catch (_: Exception) { /* no JS yet: tried again on the next call */ }
      }
      true
    }

    // Say something out loud: a hard hat has hardly a screen ("Paired to Constable Khumalo").
    // False when the device has no speech engine; the buzz and the banner still tell them.
    Function("speak") { text: String ->
      val context = appContext.reactContext ?: return@Function false
      val engine = tts
      if (engine == null) {
        ttsWaiting = text
        tts = TextToSpeech(context.applicationContext) { status ->
          ttsReady = status == TextToSpeech.SUCCESS
          val waiting = ttsWaiting
          ttsWaiting = null
          if (ttsReady && waiting != null) tts?.speak(waiting, TextToSpeech.QUEUE_FLUSH, null, "hiktech")
        }
        return@Function true
      }
      if (!ttsReady) { ttsWaiting = text; return@Function true }
      engine.speak(text, TextToSpeech.QUEUE_FLUSH, null, "hiktech") == TextToSpeech.SUCCESS
    }

    // The screen on and HikTech in front: the control room opened the camera (the officer sees it).
    Function("wakeScreen") {
      val context = appContext.reactContext ?: return@Function false
      Watchdog.wakeAndOpen(context)
      true
    }

    // HikTech as the device's home screen (radios and hard hats); off gives the normal home back.
    Function("setHome") { on: Boolean ->
      val context = appContext.reactContext ?: return@Function false
      try { Watchdog.setHome(context, on); true } catch (_: Exception) { false }
    }
    Function("isHome") {
      val context = appContext.reactContext ?: return@Function false
      Watchdog.isHome(context)
    }

    // Open the device's own home screen or settings (maintenance), leaving HikTech running.
    Function("openAndroidSettings") {
      val context = appContext.reactContext ?: return@Function false
      try {
        context.startActivity(Intent(Settings.ACTION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
        true
      } catch (_: Exception) { false }
    }

    // Left out of battery saving: true, or false when the system may stop the app to save battery.
    Function("ignoresBatterySaving") {
      val context = appContext.reactContext ?: return@Function true
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return@Function true
      val power = context.getSystemService(Context.POWER_SERVICE) as? PowerManager ?: return@Function true
      power.isIgnoringBatteryOptimizations(context.packageName)
    }

    // Ask the person to leave the app out of battery saving (one system question).
    Function("askToIgnoreBatterySaving") {
      val context = appContext.reactContext ?: return@Function false
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return@Function false
      val ask = Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
        .setData(Uri.parse("package:${context.packageName}"))
        .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      try {
        context.startActivity(ask)
        true
      } catch (_: Exception) {
        // Some builds have no such screen: the list of apps instead.
        try {
          context.startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
          true
        } catch (_: Exception) {
          false
        }
      }
    }

    OnDestroy {
      stop()
      tts?.shutdown()
      tts = null
      KeyHub.emit = null
      DutyMediaService.onTick = null
      DutyMediaService.onFix = null
    }
  }

  private fun start() {
    if (receiver != null) return
    val context = appContext.reactContext ?: return
    val r = object : BroadcastReceiver() {
      override fun onReceive(c: Context?, intent: Intent?) {
        val action = intent?.action ?: return
        val key = when (action) {
          in PTT_DOWN, in PTT_UP -> "ptt"
          in SOS_DOWN, in SOS_UP -> "sos"
          in CAMERA_DOWN, in CAMERA_UP -> "camera"
          else -> return
        }
        val pressed = action in PTT_DOWN || action in SOS_DOWN || action in CAMERA_DOWN
        KeyHub.emit?.invoke(EVENT, mapOf(
          "key" to key, "pressed" to pressed, "at" to System.currentTimeMillis().toDouble(), "source" to "broadcast", "action" to action,
        ))
      }
    }
    val filter = IntentFilter().apply {
      (PTT_DOWN + PTT_UP + SOS_DOWN + SOS_UP + CAMERA_DOWN + CAMERA_UP).forEach { addAction(it) }
    }
    // The device's system sends them, so they come from outside the app.
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
    const val TICK_EVENT = "onDutyTick"
    const val FIX_EVENT = "onDutyFix"
    const val HARDWARE_EVENT = "onHardwareKey"
    const val PREFS = "za.co.ethekwini.radiokeys"
    const val PREF_OPEN_ON_BOOT = "openOnBoot"

    /** The talk button, as push-to-talk radios commonly announce it. */
    val PTT_DOWN = setOf(
      "android.intent.action.PTT.down", "android.intent.action.PTT_DOWN", "android.intent.action.PTT_KEY_DOWN",
      "android.intent.action.ptt.down", "com.android.action.PTT_DOWN", "com.sonim.intent.action.PTT_KEY_DOWN",
      "com.runbo.ptt.key.down", "com.zello.ptt.down", "android.intent.action.side_key.keydown.PTT",
      // The H1 smart hard hat's talk button (read off the hard hat, 2026-10-23).
      "com.huawei.internalit.isdmobile.safetyhelmet.customize_1.down",
    )
    val PTT_UP = setOf(
      "android.intent.action.PTT.up", "android.intent.action.PTT_UP", "android.intent.action.PTT_KEY_UP",
      "android.intent.action.ptt.up", "com.android.action.PTT_UP", "com.sonim.intent.action.PTT_KEY_UP",
      "com.runbo.ptt.key.up", "com.zello.ptt.up", "android.intent.action.side_key.keyup.PTT",
      "com.huawei.internalit.isdmobile.safetyhelmet.customize_1.up",
    )
    /** The SOS button: the E977's own, and the usual spellings. */
    val SOS_DOWN = setOf(
      "android.intent.action.SOS.down", "android.intent.action.SOS_DOWN", "android.intent.action.SOS_KEY_DOWN",
      "com.sonim.intent.action.SOS_KEY_DOWN", "com.runbo.sos.key.down", "android.intent.action.side_key.keydown.SOS",
      "com.huawei.internalit.isdmobile.safetyhelmet.sos.down",
    )
    val SOS_UP = setOf(
      "android.intent.action.SOS.up", "android.intent.action.SOS_UP", "android.intent.action.SOS_KEY_UP",
      "com.sonim.intent.action.SOS_KEY_UP", "com.runbo.sos.key.up", "android.intent.action.side_key.keyup.SOS",
      "com.huawei.internalit.isdmobile.safetyhelmet.sos.up",
    )
    /** The hard hat's camera button: a photo for the officer's call. */
    val CAMERA_DOWN = setOf("com.huawei.internalit.isdmobile.safetyhelmet.camera.down")
    val CAMERA_UP = setOf("com.huawei.internalit.isdmobile.safetyhelmet.camera.up")
  }
}

/**
 * Key presses from MainActivity (plugins/with-radio-keys.js). Every key is
 * reported for the Buttons screen to learn from; the learned talk and SOS keys
 * are also reported as those buttons and kept from the rest of the app.
 */
object KeyHub {
  @Volatile var emit: ((String, Map<String, Any?>) -> Unit)? = null
  @Volatile var ptt: Set<Int> = emptySet()
  @Volatile var sos: Set<Int> = emptySet()

  /** True when the key is the talk or SOS button: MainActivity then keeps it. */
  @JvmStatic
  fun onKeyEvent(event: KeyEvent): Boolean {
    val send = emit ?: return false
    if (event.action != KeyEvent.ACTION_DOWN && event.action != KeyEvent.ACTION_UP) return false
    val pressed = event.action == KeyEvent.ACTION_DOWN
    val code = event.keyCode
    if (event.repeatCount == 0) {
      send(RadioKeysModule.HARDWARE_EVENT, mapOf(
        "code" to code, "scan" to event.scanCode, "name" to KeyEvent.keyCodeToString(code), "pressed" to pressed,
        "at" to System.currentTimeMillis().toDouble(),
      ))
    }
    val key = when (code) {
      in ptt -> "ptt"
      in sos -> "sos"
      else -> return false
    }
    // A held button repeats: only the first press and the let-go count.
    if (event.repeatCount == 0) {
      send(RadioKeysModule.EVENT, mapOf(
        "key" to key, "pressed" to pressed, "at" to System.currentTimeMillis().toDouble(), "source" to "key", "action" to KeyEvent.keyCodeToString(code),
      ))
    }
    return true
  }
}
