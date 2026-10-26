# Rules for this project

## Simple on the surface, secure underneath

The people using the apps are police officers, paramedics, firefighters and
disaster officers in the field. Many read and type slowly, and they work in
gloves, in the dark, under pressure. Build for them.

- **Few steps, plain words.** Short sentences, everyday words, no technical
  terms (no "token", "session", "server", "sync"). Big buttons. One question
  per screen when it matters. Pictures and department colours help.
- **Security goes in the system, not on the officer.** Checks belong in the
  database and the server (guarded functions, locks, limits, audit), not in
  extra steps, long passwords or fussy rules for the officer.
- **Rules on what people choose are the obvious ones only.** Refuse what is
  plainly unsafe, explain it in one short sentence, and allow the rest. Do not
  make the officer guess what the system wants.
- **Never depend on things that change in the field.** Wi-Fi networks, the
  phone's signal, the web server's address. Talk straight to the database
  where that is possible, and keep working offline (queue it, send it later).
- **Ask for proof only when it is needed,** and accept the easiest one that is
  still safe: the device they hold, their PIN, a recent sign-in. A password is
  the fallback, not the first thing asked.

Still non-negotiable, and invisible to the officer: database writes only
through guarded `SECURITY DEFINER` functions, no anonymous access, every
change audited, wrong tries counted and locked.

### PIN sign-in (migrations 0108–0110)

- Shared radios and phones are registered once by a supervisor, on the device
  itself (Profile → Sign-in PIN). Signing in: department → name → 6-digit PIN.
  The password always still works.
- PIN rules: 6 digits; not one digit six times; not 123456 or 654321.
  Nothing more.
- Choosing or changing a PIN goes straight to the database, with the current
  PIN, or the password if it is forgotten or locked, or nothing at all within
  30 minutes of signing in with the password.
- The database hashes and checks everything (bcrypt for PINs, SHA-256 for
  device keys). No secret lives on the web server, so moving servers breaks
  nothing. Only starting a sign-in needs the web server; without it the phone
  signs back in offline.
- Five wrong PINs lock that officer's PIN; their password, or a supervisor,
  unlocks it.
