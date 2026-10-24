const { withAndroidManifest, withMainActivity } = require('expo/config-plugins');

/**
 * The radio's and hard hat's own buttons (modules/radio-keys): MainActivity
 * hands every key press to KeyHub first. The learned talk and SOS keys are
 * kept by HikTech; every other key goes on as normal.
 */
const IMPORTS = ['import android.view.KeyEvent', 'import za.co.ethekwini.radiokeys.KeyHub'];
const METHOD = `
  // The radio's and hard hat's talk and SOS buttons (modules/radio-keys).
  override fun dispatchKeyEvent(event: KeyEvent): Boolean {
    if (KeyHub.onKeyEvent(event)) return true
    return super.dispatchKeyEvent(event)
  }
`;

/**
 * HikTech as the home screen of a radio or hard hat (modules/radio-keys
 * Watchdog.kt): an alias of MainActivity in the home category, switched off
 * here and switched on only by the app on those devices. Android brings the
 * home screen back by itself after a crash, a kill or a restart.
 */
const HOME_ALIAS = 'za.co.ethekwini.criticom.HikTechHome';
function withHomeAlias(config) {
  return withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application?.[0];
    if (!app) throw new Error('with-radio-keys: no application in the manifest');
    app['activity-alias'] = (app['activity-alias'] ?? []).filter((a) => a.$['android:name'] !== HOME_ALIAS);
    app['activity-alias'].push({
      $: {
        'android:name': HOME_ALIAS,
        'android:targetActivity': '.MainActivity',
        'android:enabled': 'false',
        'android:exported': 'true',
      },
      'intent-filter': [{
        action: [{ $: { 'android:name': 'android.intent.action.MAIN' } }],
        category: [{ $: { 'android:name': 'android.intent.category.HOME' } }, { $: { 'android:name': 'android.intent.category.DEFAULT' } }],
      }],
    });
    return c;
  });
}

module.exports = function withRadioKeys(config) {
  config = withHomeAlias(config);
  return withMainActivity(config, (c) => {
    if (c.modResults.language !== 'kt') {
      throw new Error('with-radio-keys: MainActivity is expected in Kotlin');
    }
    let src = c.modResults.contents;
    if (src.includes('KeyHub.onKeyEvent')) return c;
    for (const line of IMPORTS) {
      if (!src.includes(line)) src = src.replace(/^(package [^\n]+\n)/m, `$1${line}\n`);
    }
    const open = src.match(/class MainActivity\s*:\s*ReactActivity\(\)\s*\{\n/);
    if (!open) throw new Error('with-radio-keys: could not find the MainActivity class');
    src = src.replace(open[0], open[0] + METHOD);
    c.modResults.contents = src;
    return c;
  });
};
