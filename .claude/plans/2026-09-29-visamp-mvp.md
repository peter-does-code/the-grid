# Visamp MVP (29-09-2026)

## Mål

En lokal Winamp-lignende app. Man indsætter et Spotify-link og ser det som en Winamp-playliste. Numrene afspilles i Spotify, og den rigtige lyd visualiseres med MilkDrop.

## Bygget

- [x] Research i Winamp-licens, MilkDrop 2 (BSD), Butterchurn, Spotifys 2026-regler og Electron-loopback (`docs/winamp_research.md`, `docs/spotify_setup.md`)
- [x] Node 24 LTS installeret portabelt, Electron 44.5.0, Butterchurn 2.6.7 og 395 presets
- [x] Lydfangst via WASAPI-loopback med eget vindue som videokilde
- [x] MilkDrop-visualizer:
  - Automatisk skift, tilfældig eller fast rækkefølge og historik.
  - Preset-liste med søgning, fuld skærm og titelanimation ved nyt nummer.
- [x] Winamp-hovedvindue:
  - LCD-ur (forløbet eller resterende tid), rullende titel, mini-spektrum eller oscilloskop og statuslamper.
  - Skydere til position og lydstyrke, og tasterne Z X C V B.
- [x] Playliste med Spotify-playlister, albums og numre, også fra `spotify.link`. Andres playlister vises via køen.
- [x] PKCE-login, krypterede tokens og afspilning i playlistens kontekst. Fallback til app-links og medietaster.
- [x] 65 unit-tests og en selvtest med testlyd og skærmbilleder. Selvtesten bestod med RMS 0,22 under testlyden og 60 fps.
- [x] 30-09-2026: musikmotor, der følger musikken som MilkDrop (se `docs/music_engine.md`):
  - Tempo og slag, taktstart, nye dele af sangen og drops.
  - Skift på takten og hårde klip på drops.
  - Presets vælges efter bånd og energi.
  - Automatisk lydniveau og forsinkelse til synkronisering.
- [x] Sort billede uden musik, styret af Spotifys afspilningsstatus og en lydtærskel over pc'ens baggrundsstøj.
- [x] Presettets navn vises kun ved pilene. Det var Peters ønske.
- [x] `npm run musictest` med facit og mod rigtige lydfiler, samt `npm run diagnose -- --audio=30`.
- [x] 30-09-2026: Visamp følger skift af Windows' standard-højttaler og starter lydfangsten forfra. Et sikkerhedsnet dækker det tilfælde, hvor Spotify spiller, men der er total stilhed.
- [x] Rigtigt Spotify-login med Peters Premium-konto (29-09-2026)
- [x] Afspilning mod den rigtige Spotify-app. Løse `uris`-kommandoer tømte afspilleren, så Visamp bruger nu altid kontekst og verificerer afspilningen (se `.claude/memories/project_spotify_app_uris_bug.md`).
- [x] `npm run diagnose`: læser Spotify-tilstanden, og med `--play` testes afspil-knappens kode

## Mangler verifikation

- [ ] Afspilning af en af Peters egne playlister med playliste-kontekst og position. Hidtil er kun et enkelt nummer i albumkontekst testet.
- [ ] Medietast-fallback mod Spotify-appen. Scriptet er kun kørt med en neutral tastkode, så afspilningen ikke blev afbrudt.
- [ ] Musikmotoren på rigtig Spotify-musik. Spotify stod på pause under udviklingen, så kun den syntetiske sang og en lokal jam er testet. Kør `npm run diagnose -- --audio=30`, mens der spilles.

## Næste skridt

- Visamp til en ven på engelsk, med installationsfil og guide. Se `docs/sharing_plan.md` (planlagt 30-09-2026).

## Idéer til senere

- Pakke som installerbar `.exe` (electron-builder) med genvej i startmenuen
- Import af egne `.milk`-presets, som kræver konvertering til Butterchurn-JSON
- Valg af lydenhed, hvis Spotify ikke spiller på standard-enheden
- Tilstanden "altid øverst" og en mini-tilstand som Winamps windowshade
