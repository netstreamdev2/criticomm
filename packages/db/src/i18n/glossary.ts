/**
 * The words that matter most, agreed first and translated the same way on
 * every screen. Translators see them at the top of Admin → Translations.
 * Some may stay in English on purpose because crews know them that way;
 * that is agreed with eThekwini, term by term.
 */
export type GlossaryTerm = { text: string; note: string };

export const GLOSSARY: readonly GlossaryTerm[] = [
  { text: 'Critical', note: 'Severity: a life is in danger now.' },
  { text: 'High', note: 'Severity.' },
  { text: 'Medium', note: 'Severity.' },
  { text: 'Low', note: 'Severity.' },
  { text: 'Dispatch', note: 'To send a crew to a call; also the desk that does it.' },
  { text: 'Send to dispatch', note: 'Button: the call goes to the dispatch desks.' },
  { text: 'Send to dispatch now', note: 'Button: an urgent call goes before the form is complete.' },
  { text: 'Details to follow', note: 'On a call sent early: more is coming.' },
  { text: 'En Route', note: 'Crew status: on the way.' },
  { text: 'On Scene', note: 'Crew status: arrived.' },
  { text: 'Transporting', note: 'Crew status: taking a patient to hospital.' },
  { text: 'Accept incident', note: 'Button on the phone: the crew member takes the call.' },
  { text: 'Not needed', note: 'A department is not needed on a call.' },
  { text: 'Incident type', note: 'What kind of emergency it is.' },
  { text: 'Description', note: 'What happened, in the caller’s words.' },
  { text: 'Caller', note: 'The person who phoned.' },
  { text: 'Is the caller the patient?', note: 'Question on a medical call.' },
  { text: 'Severity', note: 'How serious the call is: Low, Medium, High, Critical.' },
  { text: 'Medical code', note: 'P1 red to P4 blue.' },
  { text: 'SOS', note: 'An officer’s call for help. Usually kept as SOS.' },
];
