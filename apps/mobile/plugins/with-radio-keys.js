const { withMainActivity } = require('expo/config-plugins');

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

module.exports = function withRadioKeys(config) {
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
