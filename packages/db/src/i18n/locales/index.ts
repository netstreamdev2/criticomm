import type { Dictionary, LangCode } from '../index.ts';
import af from './af.ts';
import nr from './nr.ts';
import nso from './nso.ts';
import ss from './ss.ts';
import st from './st.ts';
import tn from './tn.ts';
import ts from './ts.ts';
import ve from './ve.ts';
import xh from './xh.ts';
import zu from './zu.ts';

/** The approved translations each app carries, so a language works offline. */
export const BUNDLED: Readonly<Record<Exclude<LangCode, 'en'>, Dictionary>> = { zu, xh, af, nso, tn, st, ts, ss, ve, nr };

export function bundled(lang: LangCode): Dictionary {
  return lang === 'en' ? {} : BUNDLED[lang];
}
