package za.co.ethekwini.radiokeys

import android.annotation.SuppressLint
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import android.os.PowerManager

/**
 * The on-duty standby (0091), for the radios and the hard hats.
 *
 * 1. The camera. Android lets an app use the camera and microphone with its
 *    screen off only from a foreground service of those types, started while
 *    the app was on screen. The app starts this one on duty, with the app
 *    open, so the control room can open the camera later. It does nothing by
 *    itself: the camera opens only when the control room asks, and the
 *    officer is told each time.
 *
 * 2. A wake-up every few seconds (onTick): with the screen off, the app
 *    reports to the Radio Desk and hears the camera being opened even when no
 *    position comes in. On a device without Google services (the H1 hard hat)
 *    it also keeps the processor awake while on duty, as push-to-talk apps
 *    do, or nothing would run with the screen off.
 *
 * 3. Plain GPS (onFix), on a device without Google services: the app's usual
 *    location needs them, so there the GPS is read here and every fix handed
 *    to the same route recorder.
 *
 * Not restarted by the system (START_NOT_STICKY): Android would refuse it from
 * the background anyway; the app starts it again when next opened.
 */
class DutyMediaService : Service() {
  private val handler = Handler(Looper.getMainLooper())
  private var ticking = false
  private var wakeLock: PowerManager.WakeLock? = null
  private var locations: LocationManager? = null

  private val tick = object : Runnable {
    override fun run() {
      try { onTick?.invoke() } catch (_: Exception) { }
      handler.postDelayed(this, TICK_MS)
    }
  }

  // Every method written out: on Android 8 these are not optional.
  private val gps = object : LocationListener {
    override fun onLocationChanged(location: Location) {
      val fix = mutableMapOf<String, Any?>(
        "lat" to location.latitude,
        "lng" to location.longitude,
        "time" to location.time.toDouble(),
        "provider" to location.provider,
      )
      if (location.hasAccuracy()) fix["accuracy"] = location.accuracy.toDouble()
      if (location.hasSpeed()) fix["speed"] = location.speed.toDouble()
      if (location.hasBearing()) fix["heading"] = location.bearing.toDouble()
      try { onFix?.invoke(fix) } catch (_: Exception) { }
    }
    @Deprecated("Android 8 still calls it")
    override fun onStatusChanged(provider: String?, status: Int, extras: Bundle?) {}
    override fun onProviderEnabled(provider: String) {}
    override fun onProviderDisabled(provider: String) {}
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    val plainGps = intent?.getBooleanExtra(EXTRA_PLAIN_GPS, false) ?: false
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
    @Suppress("DEPRECATION")
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
        var types = ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        if (plainGps) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION
        startForeground(ID, notification, types)
      } else {
        startForeground(ID, notification)
      }
    } catch (e: Exception) {
      // No camera or microphone permission, or started from the background:
      // no standby, nothing else breaks.
      stopSelf()
      return START_NOT_STICKY
    }

    if (!ticking) {
      ticking = true
      handler.postDelayed(tick, TICK_MS)
    }
    if (plainGps) {
      keepAwake()
      startGps()
    }
    return START_NOT_STICKY
  }

  private fun keepAwake() {
    if (wakeLock?.isHeld == true) return
    val power = getSystemService(PowerManager::class.java) ?: return
    wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "criticom:on-duty").apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  @SuppressLint("MissingPermission")
  private fun startGps() {
    if (locations != null) return
    val lm = getSystemService(LocationManager::class.java) ?: return
    locations = lm
    for (provider in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
      try {
        if (lm.allProviders.contains(provider)) {
          lm.requestLocationUpdates(provider, GPS_MS, GPS_METRES, gps, Looper.getMainLooper())
        }
      } catch (_: SecurityException) {
        // No location permission: the camera and the wake-up still work.
      } catch (_: Exception) { }
    }
  }

  override fun onDestroy() {
    handler.removeCallbacks(tick)
    ticking = false
    try { locations?.removeUpdates(gps) } catch (_: Exception) { }
    locations = null
    try { if (wakeLock?.isHeld == true) wakeLock?.release() } catch (_: Exception) { }
    wakeLock = null
    super.onDestroy()
  }

  companion object {
    const val CHANNEL = "criticom-camera-standby"
    const val ID = 481757
    const val EXTRA_TITLE = "title"
    const val EXTRA_TEXT = "text"
    const val EXTRA_CHANNEL = "channel"
    const val EXTRA_PLAIN_GPS = "plainGps"
    const val TICK_MS = 10_000L
    const val GPS_MS = 10_000L
    const val GPS_METRES = 15f

    /** Set by the module while the app's code is running. */
    @Volatile var onTick: (() -> Unit)? = null
    @Volatile var onFix: ((Map<String, Any?>) -> Unit)? = null
  }
}
