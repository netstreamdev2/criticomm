#!/usr/bin/env bash
# =============================================================================
# Set up a push-to-talk radio or smart hard hat for HikTech, over USB.
#
#   scripts/provision-radio.sh [path/to/app.apk]        set it up
#   scripts/provision-radio.sh --undo                    put it back as it was
#
# Plug in ONE device (USB debugging on) and run it; with more than one, set
# ANDROID_SERIAL=<serial> to pick it. Every step is an ordinary
# Android setting or app permission: nothing is flashed, rooted or locked,
# and --undo reverses all of it. Steps a device does not have are skipped.
#
# What it does:
#   * installs the HikTech app (when an APK is given), with its permissions;
#   * leaves HikTech out of battery saving and deep sleep, lets it reopen
#     itself (watchdog, SMS wake) and use exact alarms;
#   * switches off the other push-to-talk apps (PocStar and the like), which
#     grab the same buttons, microphone and camera;
#   * keeps Wi-Fi and mobile data on with the screen off;
#   * screen always on, no lock screen;
#   * HikTech as the home screen, so Android brings it back by itself;
#   * opens HikTech.
#
# ADB defaults to the scrcpy copy on this PC; set ADB=/path/to/adb to change.
# =============================================================================
set -u

ADB="${ADB:-/c/Users/shiva/AppData/Local/Microsoft/WinGet/Packages/Genymobile.scrcpy_Microsoft.Winget.Source_8wekyb3d8bbwe/scrcpy-win64-v4.1/adb.exe}"
PKG=za.co.ethekwini.criticom
HOME_ALIAS="$PKG/$PKG.HikTechHome"
# Push-to-talk apps that fight HikTech for the buttons, microphone and camera.
OTHER_PTT=(com.shli.interphone com.shanlitech.noscreen com.corget.release2)

say() { printf '  %s\n' "$*"; }
ok() { printf '  \033[32m✔\033[0m %s\n' "$*"; }
skip() { printf '  \033[90m– %s\033[0m\n' "$*"; }

devices=$("$ADB" devices | awk 'NR>1 && $2=="device"{print $1}')
if [ -n "${ANDROID_SERIAL:-}" ]; then
  # More than one plugged in: ANDROID_SERIAL=<serial> picks which.
  if ! printf '%s\n' "$devices" | grep -qx "$ANDROID_SERIAL"; then
    echo "Device $ANDROID_SERIAL is not plugged in."
    exit 1
  fi
  devices=$ANDROID_SERIAL
fi
count=$(printf '%s\n' "$devices" | grep -c . || true)
if [ "$count" -ne 1 ]; then
  echo "Plug in exactly one device with USB debugging on (found $count), or set ANDROID_SERIAL."
  exit 1
fi
SERIAL=$devices
A() { "$ADB" -s "$SERIAL" "$@"; }
MODEL=$(A shell getprop ro.product.model | tr -d '\r')
SDK=$(A shell getprop ro.build.version.sdk | tr -d '\r')
REL=$(A shell getprop ro.build.version.release | tr -d '\r')
has_pkg() { A shell pm list packages "$1" | tr -d '\r' | grep -qx "package:$1"; }

echo "Device: $MODEL ($SERIAL), Android $REL"

# ── Undo ─────────────────────────────────────────────────────────────────────
if [ "${1:-}" = "--undo" ]; then
  for p in "${OTHER_PTT[@]}"; do
    if has_pkg "$p"; then A shell pm enable "$p" >/dev/null 2>&1 && ok "Switched $p back on"; fi
  done
  A shell pm disable "$HOME_ALIAS" >/dev/null 2>&1 && ok "HikTech is no longer the home screen"
  for launcher in com.android.launcher3/.Launcher com.android.launcher3/com.android.launcher3.Launcher; do
    A shell cmd package set-home-activity "$launcher" >/dev/null 2>&1 && break
  done
  A shell settings put system screen_off_timeout 60000; ok "Screen turns off after 1 minute again"
  A shell settings put global stay_on_while_plugged_in 0; ok "Screen may sleep while charging again"
  A shell locksettings set-disabled false >/dev/null 2>&1; ok "Lock screen back"
  A shell settings delete global wifi_sleep_policy >/dev/null 2>&1; ok "Wi-Fi sleep back to the default"
  A shell cmd deviceidle whitelist -"$PKG" >/dev/null 2>&1; ok "HikTech back under battery saving"
  echo "Done. The HikTech app itself is still installed (uninstall it from Settings if wanted)."
  exit 0
fi

# ── Set up ───────────────────────────────────────────────────────────────────
APK="${1:-}"
if [ -n "$APK" ]; then
  say "Installing $(basename "$APK") …"
  if A install -r -g "$APK" | grep -q Success; then ok "HikTech installed"; else echo "  Install failed."; exit 1; fi
elif has_pkg "$PKG"; then
  skip "No APK given: keeping the HikTech already installed"
else
  echo "HikTech is not installed: give the APK path."; exit 1
fi

for perm in RECORD_AUDIO CAMERA ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION RECEIVE_SMS; do
  A shell pm grant "$PKG" "android.permission.$perm" >/dev/null 2>&1
done
[ "$SDK" -ge 33 ] && A shell pm grant "$PKG" android.permission.POST_NOTIFICATIONS >/dev/null 2>&1
ok "Microphone, camera, location and SMS wake allowed"

A shell cmd deviceidle whitelist +"$PKG" >/dev/null 2>&1 && ok "Left out of battery saving and deep sleep"
A shell cmd appops set "$PKG" SYSTEM_ALERT_WINDOW allow >/dev/null 2>&1 && ok "May reopen itself (watchdog, SMS wake)"
if [ "$SDK" -ge 28 ]; then A shell cmd appops set "$PKG" RUN_ANY_IN_BACKGROUND allow >/dev/null 2>&1 && ok "May run in the background"; fi
if [ "$SDK" -ge 31 ]; then A shell cmd appops set "$PKG" SCHEDULE_EXACT_ALARM allow >/dev/null 2>&1 && ok "Watchdog alarms allowed"; fi

for p in "${OTHER_PTT[@]}"; do
  if has_pkg "$p"; then
    A shell am force-stop "$p" >/dev/null 2>&1
    A shell pm disable-user --user 0 "$p" >/dev/null 2>&1 && ok "Switched off $p (undo puts it back)"
  fi
done

A shell settings put global wifi_sleep_policy 2 && ok "Wi-Fi stays on with the screen off"
A shell settings put global mobile_data_always_on 1 >/dev/null 2>&1
A shell settings put global setting.duraspeed.enabled 0 >/dev/null 2>&1   # MediaTek's app killer, where there is one

A shell settings put system screen_off_timeout 2147483647
A shell settings put global stay_on_while_plugged_in 7
A shell svc power stayon true
A shell locksettings set-disabled true >/dev/null 2>&1
ok "Screen always on, no lock screen"

A shell input keyevent KEYCODE_WAKEUP
A shell monkey -p "$PKG" -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1
ok "HikTech opened"

# The app switches its home-screen entry on by itself when it opens on a radio
# or hard hat (Android does not let the PC do it); then the PC makes it the default.
sleep 10
if A shell cmd package set-home-activity "$HOME_ALIAS" 2>&1 | grep -q Success; then
  ok "HikTech is the home screen"
else
  skip "Home screen not set: open HikTech once on the device, then run this again (needs the build of 23 Oct 2026, afternoon)"
fi
echo
echo "Next: sign in on it, start the shift, and register its Radio ID (Profile → Radio setup) under Hard hats & radios."
