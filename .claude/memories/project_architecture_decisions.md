---
name: project-architecture-decisions
description: Kernebeslutninger i The Grid, tidligere Visamp (29-09-2026) og hvorfor — lydkilde, visualizer-bibliotek, login, skærm-privatliv
metadata:
  type: project
---

Beslutninger taget ved første build 29-09-2026, efter research (se `docs/winamp_research.md`):

- **Lyden kommer fra Windows-loopback, ikke fra Spotify.** Spotify udleverer aldrig rå lyd (DRM), heller ikke via Web Playback SDK. I Electron 44: `setDisplayMediaRequestHandler` kalder `callback({ video: request.frame, audio: 'loopback' })`.
- **Videokilden er appens eget vindue** (`request.frame`), ikke skærmen, og videosporet stoppes straks. Det er verificeret, at lydsporet lever videre. Selvtesten viser `videoTracks: ["ended"]` og lyd `live`.
- **Butterchurn 2.6.7 og butterchurn-presets 2.4.7** (MIT, 395 presets). 3.x er beta og kun ESM. Webamp er fravalgt, fordi den spiller sine egne filer og genbruger Winamps skin.
- **Ingen Winamp-kode.** WCL v1.0.1 forbyder distribution af ændrede versioner, og repoet blev slettet 16-10-2024.
- **PKCE-login** med loopback-redirect `http://127.0.0.1:43117/callback`. Ingen client secret. Tokens krypteres med DPAPI (`safeStorage`) i `%APPDATA%\The Grid` (tidligere `%APPDATA%\Visamp`).
- **Fallbacks:** uden login eller Premium åbnes numre med `spotify:track:`-URI, og knapperne sendes som Windows-medietaster (`keybd_event`).
- **Skift af højttaler (30-09-2026):** en kørende loopback-fangst bliver på den gamle standardenhed. `audio-devices.js` læser standardenheden hvert sekund via Core Audio, og rendereren starter fangsten forfra ved et skift. Peters enheder er Realtek-højttalere, to NVIDIA HDMI-skærme og et HyperX Cloud Alpha Wireless-headset.

**Why:** brugeren bad om "Winamp, kopieret hvis det er open source", med Spotify-playlister og kun lokalt. Kombinationen ovenfor er den eneste, der er både lovlig og teknisk mulig.

**How to apply:** Foreslå ikke at hente Spotify-lyd direkte, bruge Winamps kode eller skin, eller skifte til Butterchurn 3 uden at genbesøge disse punkter. Se også [[reference-spotify-2026-rules]] og [[feedback-electron-gotchas]].
