---
name: project-music-engine-calibration
description: Målte tal bag musikmotorens tærskler (30-09-2026) og hvordan de efterprøves
metadata:
  type: project
---

Målinger bag tærsklerne i `src/shared/music-engine.js`:

- **Baggrundsstøj:** Peters pc har svag baggrundslyd fra andre programmer på -55 til -63 dB med toppe omkring -42 dB, også når Spotify er på pause. Målt med `npm run diagnose -- --audio=30`. Derfor er stilhedstærsklerne:
  - -70 dB, når Spotify spiller på denne pc.
  - -42 dB ved pause.
  - -48 dB, når Spotify-status er ukendt.
- **onsetLatency = 27 ms:** kalibreret, så slagenes gennemsnitlige afvigelse i `npm run musictest` er ca. 0 ms. Medianafvigelsen er 2 ms, og 100 % af slagene ligger inden for 40 ms.
- **Klæbrigt tempo (80 %) og slag-vurdering over 1, 2 og 4 perioder:** indført efter en test på "Peter jam #1.wav" (73 s, i Downloads). Uden dem skiftede tempoet mellem 80 og 120 BPM. Med dem holdt det 80 BPM stabilt i 29 s, og 78 % af slagene landede regelmæssigt.
- **Drop:** kortvarig lydstyrke over ca. et slag (effekt-EMA, 0,2 s), der stiger mere end 8 dB over medianen af de foregående 1-6 s. Et enkelt kraftigt kick giver kun ca. 3 dB.

**Why:** tallene er målt på Peters maskine og kalibreret mod et facit. Ændres de i blinde, går synkroniseringen tabt.

**How to apply:** Kør `npm run musictest` (skal give ok: true) og gerne `npm run musictest -- --file=...` efter enhver ændring i motoren. Relateret: [[feedback-visual-preferences]].
