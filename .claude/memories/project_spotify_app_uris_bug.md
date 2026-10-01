---
name: project-spotify-app-uris-bug
description: Spotify-appen til Windows tømmer afspilleren ved en løs "uris"-afspilkommando; brug altid kontekst + offset
metadata:
  type: project
---

Fundet 29-09-2026 med Peters Spotify-app (Microsoft Store-udgaven, 1.301.234.0, Premium). Afspil-knappen virkede ikke.

- `PUT /me/player/play` med `{"uris": ["spotify:track:..."]}` giver 204, men appen ender med `item: null`. Det gjaldt også med `device_id` og med en forudgående overførsel af afspilningen.
- `{"context_uri": "spotify:album:...", "offset": {"uri": "spotify:track:..."}}` virker med det samme.
- Pause og fortsæt (`/me/player/pause` og `/me/player/play` uden body) virker.
- Et `spotify:track:`-link, der åbnes lokalt, afspiller altid nummeret.

Rettelse: `buildPlayRequest` i `src/main/playback.js` sender altid en kontekst. Et enkelt nummer spilles i sit albums kontekst (`parentUri` fra `normalizeTrack`). Efter afspil verificerer `PlaybackController.verifyPlaying`, at musikken starter, og ellers åbnes `spotify:track:`-linket. Rettelsen er verificeret mod den rigtige app med `npm run diagnose -- --play`.

**Why:** Spotify dokumenterer det ikke, og API'et svarer "succes". Uden verifikation fejler det stille.

**How to apply:** Genindfør aldrig løse `uris`-kommandoer. Kør `npm run diagnose -- --experiment` for at se, om Spotify har rettet fejlen. Relateret: [[project-architecture-decisions]] og [[reference-spotify-2026-rules]].
