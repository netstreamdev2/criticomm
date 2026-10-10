/**
 * Caller phone numbers at intake.
 *
 * The call-taker picks the country (South Africa by default) and types the
 * number the way the caller says it: "082 123 4567", "0027 82 123 4567",
 * "+27 82 123 4567" and "82 123 4567" are all the same South African mobile.
 * Pasting a full international number ("+1 415 555 0132") picks its country.
 * The number is stored in international form (+27821234567), which the SMS
 * gateway and duplicate detection both rely on.
 */

export type Country = {
  /** ISO 3166 code, the select's value. */
  iso: string;
  name: string;
  /** Calling code without the plus. */
  code: string;
  /** National significant number length: exact, or [min, max]. */
  digits: number | [number, number];
  /** What a valid national number looks like, for the hint. */
  example: string;
  /** Extra shape rule for the national number, if the country has one. */
  pattern?: RegExp;
  patternHint?: string;
};

/** South Africa first, then the countries callers in Durban most often have numbers from. */
export const COUNTRIES: Country[] = [
  { iso: 'ZA', name: 'South Africa', code: '27', digits: 9, example: '082 123 4567', pattern: /^[1-8]\d{8}$/, patternHint: 'a South African number starts with 0 then 1–8 (082…, 031…)' },
  { iso: 'US', name: 'United States / Canada', code: '1', digits: 10, example: '(415) 555-0132', pattern: /^[2-9]\d{2}[2-9]\d{6}$/, patternHint: 'a US or Canadian number has a 3-digit area code and 7-digit number, neither starting with 0 or 1' },
  { iso: 'GB', name: 'United Kingdom', code: '44', digits: 10, example: '07700 900123', pattern: /^[1-9]\d{9}$/ },
  { iso: 'ZW', name: 'Zimbabwe', code: '263', digits: 9, example: '077 123 4567' },
  { iso: 'MZ', name: 'Mozambique', code: '258', digits: 9, example: '84 123 4567' },
  { iso: 'LS', name: 'Lesotho', code: '266', digits: 8, example: '5012 3456' },
  { iso: 'SZ', name: 'Eswatini', code: '268', digits: 8, example: '7612 3456' },
  { iso: 'BW', name: 'Botswana', code: '267', digits: [7, 8], example: '71 123 456' },
  { iso: 'NA', name: 'Namibia', code: '264', digits: [8, 9], example: '081 123 4567' },
  { iso: 'ZM', name: 'Zambia', code: '260', digits: 9, example: '095 512 3456' },
  { iso: 'MW', name: 'Malawi', code: '265', digits: 9, example: '0991 23 45 67' },
  { iso: 'TZ', name: 'Tanzania', code: '255', digits: 9, example: '0621 234 567' },
  { iso: 'KE', name: 'Kenya', code: '254', digits: 9, example: '0712 123456' },
  { iso: 'NG', name: 'Nigeria', code: '234', digits: 10, example: '0802 123 4567' },
  { iso: 'CD', name: 'DR Congo', code: '243', digits: 9, example: '0991 234 567' },
  { iso: 'IN', name: 'India', code: '91', digits: 10, example: '081234 56789' },
  { iso: 'PK', name: 'Pakistan', code: '92', digits: 10, example: '0301 2345678' },
  { iso: 'CN', name: 'China', code: '86', digits: 11, example: '131 2345 6789' },
  { iso: 'AU', name: 'Australia', code: '61', digits: 9, example: '0412 345 678' },
  { iso: 'DE', name: 'Germany', code: '49', digits: [10, 11], example: '01512 3456789' },
  { iso: 'FR', name: 'France', code: '33', digits: 9, example: '06 12 34 56 78' },
  { iso: 'NL', name: 'Netherlands', code: '31', digits: 9, example: '06 12345678' },
  { iso: 'PT', name: 'Portugal', code: '351', digits: 9, example: '912 345 678' },
  { iso: 'AE', name: 'United Arab Emirates', code: '971', digits: 9, example: '050 123 4567' },
];

export const DEFAULT_COUNTRY = COUNTRIES[0]!;

export function countryByIso(iso: string | null | undefined): Country {
  return COUNTRIES.find((c) => c.iso === iso) ?? DEFAULT_COUNTRY;
}

/** The country a full international number belongs to: longest calling code first. */
export function countryOfInternational(digits: string): Country | null {
  return [...COUNTRIES].sort((a, b) => b.code.length - a.code.length).find((c) => digits.startsWith(c.code)) ?? null;
}

export type PhoneCheck =
  | { ok: true; e164: string; country: Country; display: string }
  | { ok: false; error: string; country: Country };

const lengthText = (d: Country['digits']) => (typeof d === 'number' ? `${d}` : `${d[0]}–${d[1]}`);

/**
 * Check a typed number against the chosen country. A number typed with its
 * own international prefix (+… or 00…) is judged by that prefix instead, so a
 * foreign caller's number pasted whole is never forced into +27.
 */
export function checkPhone(raw: string, iso: string = DEFAULT_COUNTRY.iso): PhoneCheck {
  let country = countryByIso(iso);
  const text = raw.trim();
  if (!text) return { ok: false, error: 'Enter the caller’s phone number.', country };
  if (/[a-z]/i.test(text)) {
    return { ok: false, error: 'A phone number has digits only (spaces, brackets and dashes are fine).', country };
  }
  if (/[^\d\s()+\-./]/.test(text)) {
    return { ok: false, error: 'Remove the symbols: a phone number has digits, spaces, brackets and dashes only.', country };
  }
  if ((text.match(/\+/g) ?? []).length > 1 || (text.includes('+') && !text.startsWith('+'))) {
    return { ok: false, error: 'The + belongs only at the start, before the country code.', country };
  }

  let digits = text.replace(/\D/g, '');
  const international = text.startsWith('+') || digits.startsWith('00');
  if (international) {
    if (digits.startsWith('00')) digits = digits.slice(2);
    const found = countryOfInternational(digits);
    if (!found) {
      // A country we do not list: hold it to the international standard (E.164).
      if (digits.length < 8 || digits.length > 15 || digits.startsWith('0')) {
        return { ok: false, error: 'That international number is not valid: 8 to 15 digits after the +.', country };
      }
      return { ok: true, e164: `+${digits}`, country, display: `+${digits}` };
    }
    country = found;
    digits = digits.slice(found.code.length);
  } else if (country.code === '1' && digits.length === 11 && digits.startsWith('1')) {
    // US and Canada: a leading 1 is the trunk prefix.
    digits = digits.slice(1);
  } else if (digits.startsWith(country.code) && digits.length > (typeof country.digits === 'number' ? country.digits : country.digits[1])) {
    // The country code typed without its plus: 27821234567.
    digits = digits.slice(country.code.length);
  }
  // The national trunk 0 (082…, 07700…) is dropped in international form.
  if (country.code !== '1' && digits.startsWith('0')) digits = digits.slice(1);

  const [min, max] = typeof country.digits === 'number' ? [country.digits, country.digits] : country.digits;
  if (digits.length < min || digits.length > max) {
    const short = digits.length < min;
    return {
      ok: false,
      country,
      error: `${short ? 'Too short' : 'Too long'} for ${country.name}: ${lengthText(country.digits)} digits after +${country.code}`
        + `${country.code === '27' || country.code === '44' ? ' (not counting the first 0)' : ''}, e.g. ${country.example}.`,
    };
  }
  if (country.pattern && !country.pattern.test(digits)) {
    return { ok: false, country, error: `That is not a valid ${country.name} number: ${country.patternHint ?? `e.g. ${country.example}`}.` };
  }
  return { ok: true, e164: `+${country.code}${digits}`, country, display: formatNational(country, digits) };
}

/** How the number reads back to the call-taker. */
export function formatNational(country: Country, digits: string): string {
  if (country.code === '27') return `+27 ${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5)}`;
  if (country.code === '1') return `+1 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  return `+${country.code} ${digits}`;
}
