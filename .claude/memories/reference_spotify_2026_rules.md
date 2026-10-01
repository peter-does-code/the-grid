---
name: reference-spotify-2026-rules
description: Spotify Web API-regler for Development Mode-apps pr. september 2026, med links til kilderne
metadata:
  type: reference
---

Gælder Peters udvikler-app, som er bygget ind i The Grid (Development Mode). Verificeret 29-09-2026:

- Ejeren skal have **Premium**. Det gælder fra 11-02-2026 for nye apps og fra 09-03-2026 for eksisterende. Højst **5 brugere** pr. app. Extended Quota er kun for organisationer.
- `/playlists/{id}/tracks` hedder nu `/playlists/{id}/items`. Feltet `tracks` er blevet til `items`, og elementets `track` er blevet til `item`.
- `items` returneres **kun for playlister, brugeren ejer eller samarbejder om**. Ellers mangler feltet, og der kommer kun metadata.
- Spotify-ejede redaktionelle og algoritmiske playlister giver 404 fra 27-11-2024. Det samme gælder audio-features og audio-analysis.
- Fjernet i 2026:
  - Batch-endpoints (`GET /tracks`, `/albums` osv.).
  - Felterne `/me.product`, `/me.country`, `/me.email`, `track.linked_from` og `popularity`.
- Afspiller-endpoints (`/me/player/*`, inkl. `queue` og `devices`) er uændrede og kræver Premium.
- Juli 2026: op til 25 Client IDs pr. udvikler, kvoten deles af dem alle, og 429 kommer med `reason: "QUOTA_EXCEEDED"`.
- Redirect: `localhost` er forbudt, `http://127.0.0.1:PORT` er tilladt.

Kilder:
- https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide
- https://developer.spotify.com/documentation/web-api/references/changes/july-2026
- https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api

Relateret: [[project-architecture-decisions]].
