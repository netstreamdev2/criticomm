/**
 * Text the PDF's standard fonts can draw.
 *
 * pdf-lib's standard fonts (Helvetica) are WinAnsi-encoded and throw on any
 * character outside that set, which fails the whole document. Officers type
 * reports on phones, so emoji, arrows, and names with letters beyond Latin-1
 * all arrive. Accented letters keep their base letter (ő becomes o); anything
 * else becomes "?". A case PDF with one odd character is far better than no
 * case PDF.
 */

/** The WinAnsi characters outside Latin-1 (0x80–0x9F in the code page). */
const WIN_ANSI_EXTRA = new Set('€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ');

function drawable(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff) || WIN_ANSI_EXTRA.has(ch);
}

export function pdfSafe(text: string | number | null | undefined): string {
  if (text === null || text === undefined) return '';
  let out = '';
  for (const ch of String(text).replace(/\r\n?/g, '\n').replace(/\t/g, ' ')) {
    if (ch === '\n' || drawable(ch)) { out += ch; continue; }
    // Strip combining marks: keep the base letter when it is drawable.
    const base = ch.normalize('NFKD').replace(/\p{M}/gu, '');
    out += base && [...base].every(drawable) ? base : '?';
  }
  return out;
}

/** When the PDF was made, in South African time: the time every other time on it uses. */
export function saStamp(at: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-ZA', {
    timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(at);
}
