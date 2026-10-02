# Visualizeren og musikken: research, 02-10-2026

Peters klage: billedet reagerer for lidt på høj og lav musik, går nogle gange slet ikke i gang,
forskellige lyde burde drive forskellige elementer, og det ser lavopløst ud i forhold til Winamps
MilkDrop. Tre læse-undersøgelser bag dette dokument: lydkæden i appen, Butterchurns kildekode
(`node_modules/butterchurn/lib/butterchurn.js` er uminificeret 2.6.7) og MilkDrop 2-kilden (BSD,
via BeatDrop og MilkDrop3 på GitHub) plus Geiss' preset-vejledning. Intet er ændret i koden, og
appen er ikke kørt. Tal mærket *model* kommer fra en offline-simulering af AGC'en og Butterchurns
niveauregning, ikke fra målinger på en pc.

## Kort fortalt

1. **Dynamikken fjernes to gange.** Appens automatiske lydniveau (AGC) i `music.js` og
   Butterchurns egen 4-sekunders normalisering ligger oven på hinanden. Et højere omkvæd ser
   *roligere* ud end gennemsnittet fra cirka 3 sekunder inde. AGC'en er tændt som standard.
2. **"Går ikke i gang"** skyldes mest sandsynligt stilhedsvagten: den tror kun, at Spotify spiller
   på denne pc, hvis Spotifys enhedsnavn er lig pc-navnet. Ellers er tærsklen -42 dB, og billedet
   sover efter 0,5 s. Et roligt intro bliver sort.
3. **Forskellige lyde, forskellige elementer** er et designhul: musikmotorens kick, onsets og bånd
   når aldrig presets. Butterchurns "bas" er 20-320 Hz vægtet mod 140-260 Hz, ikke stortrommen.
4. **Lavopløst**: renderingen er allerede 1:1 med skærmpixels, men loftet på 2560 px bredde
   strækkes 1,5× på en 4K-skærm, mesh'et er standard 48×36, linjer er 1 px uden udjævning,
   og blink-vagten laver en GPU-aflæsning hvert andet billede. Billedhastigheden er ikke begrænset,
   så presets løber 2-5× hurtigere end i Winamp (loft 30 fps) på 120/144 Hz-skærme.

## Det, vi ved (verificeret i kode)

### Lydkæden (`src/renderer/music.js`)

```
kilde → forsinkelse ─┬→ analyser (FFT 2048, rå) → FeatureExtractor → MusicEngine
                     └→ AGC-gain → limiter → output → Butterchurn + mini-spektrum
```

- AGC: mål-RMS 0,18 (-14,9 dBFS), gain 0,5-12, niveaufølger τ 0,4 s op og 4 s ned, gain τ 1,5 s
  (`music.js:15-17, 104-110`). Fryser ved stilhed og under RMS 0,0015.
- Limiter: tærskel -2 dB, knee 2, ratio 20, attack 2 ms, release 120 ms (`music.js:28-33`).
  Rammer kun toppe mere end 12,9 dB over mål-RMS; dynamiske numre (akustisk, gamle mastere)
  rammes mest, netop dem AGC'en forstærker mest.
- Loopback-constraints: `echoCancellation`, `noiseSuppression`, `autoGainControl` er alle
  `false` (`app.js:620-623`). Samplerate følger lydenheden (typisk 48 kHz), intet resampler.
- Settings: "Automatic level" kan slås fra (`store.js:40`, `app.js:2051`); fra sætter gain 1.

### Butterchurn 2.6.7 (identisk lydregning med MilkDrop 2)

- Egen AnalyserNode (FFT 1024, kun tidsdomæne, 8-bit `getByteTimeDomainData`), egen FFT uden
  vindue, equalizer-vægt `-0.02·ln((512-i)/512)` (`butterchurn.js:346-431`). Ingen gain, ingen AGC.
- Bånd i Hz: 20-320 / 320-2800 / 2800-11025. Ved 48 kHz er bas bins 0-5 (0-234 Hz) vægtet 1:2:3:4:5,
  så 47 Hz tæller en femtedel af 234 Hz. MilkDrop 2 deler i stedet de nederste 256 bins i tre
  (0-3,66 kHz er "bas"), så presets, der er stemt i Winamp, reagerer på andet indhold her.
- Normalisering (`butterchurn.js:222-270`): `avg` 0,2 op / 0,5 ned pr. billede (21/48 ms),
  `longAvg` 0,992 pr. billede ved 30 fps (τ ≈ 4,15 s). `bass = imm/longAvg`,
  `bass_att = avg/longAvg`. **Alle bånd er forhold mod de seneste 4 s.** Konstant lydstyrke giver
  1,0 = fladt. En statisk gain foran ændrer intet i bånd; den ændrer kun waveform-størrelse
  (absolut, `wave_scale/128`) og afstanden til 8-bit-gulvet (ét trin ≈ -42 dBFS).
- Rendering: tekstur = `width × pixelRatio × textureRatio`, RGBA8, mesh 48×36 (`:2273`),
  WebGL2 med `antialias:false` (`:6498`). Waves er 1-px `LINE_STRIP`; "thick" = 4 kopier.
  `outputFXAA` (standard false) giver en ekstra udgangspas. **Supersampling (textureRatio > 1)
  virker kun sammen med `outputFXAA: true`**: ellers læser comp-passet mip-niveau 1 af en tekstur,
  hvis mipmaps er to billeder gamle. Webamp bruger netop den fejlvej.
- Bieffekter af større tekstur: wave-alpha skifter ved teksturbredde 1024 og 2048, linjer bliver
  halvt så brede, og 206 af 395 presets i butterchurn-presets bruger `texsize`-offsets i shaders
  (kant, emboss, smear bliver halvt så brede på skærmen).
- Tid: `time += 1/fps`, ingen fps-grænse; lydglatningen fps-korrigeres (15-144). Per-billede-
  ligninger (zoom, rot, decay, `bass_thresh`-detektoren i 217 af 1754 presets) er *ikke*
  fps-korrigerede. Winamp MilkDrop: loft 30 fps i fuld skærm; MilkDrop3: 60 og advarer mod høj fps.
- API til lydinjektion: `render({audioLevels:{timeByteArray, timeByteArrayL, timeByteArrayR}})`
  (`:2716`). Uofficielt: `viz.renderer.audioLevels` kan erstattes med et objekt, der leverer
  `bass/mid/treb` og `_att`; `render()` og `loadPreset` læser kun de seks. Appen patcher allerede
  `renderer.blendPattern` på samme måde, og versionen er låst.
- Ingen GitHub-issues (slået fra). PR #18/#20 (2019) er sidste ændring af lydanalysen; master
  (3.0.0-beta) har samme `audioLevels.js`.

### Appen omkring Butterchurn

- `measure()` i `visualizer.js:97-107`: CSS-størrelse × min(dpr, 2), loft `MAX_RENDER_WIDTH` 2560.
  Butterchurn får `pixelRatio: 1, textureRatio: 1`, så teksturen = canvas = skærmpixels, indtil
  loftet rammer. 4K ved 150-200 % skalering i fuld skærm: 2560 px strækkes 1,5× af compositoren.
- `measureLuma()` (`visualizer.js:138, 148-160`): `drawImage` af WebGL-canvas til et 8×6 2D-canvas
  med `willReadFrequently` hvert andet billede. Sandsynligvis en synkron fuldbilled-aflæsning
  GPU → CPU. Ikke målt. Dokumenteret fps: 33-34 fra kildekoden, 60 pakket.
- Render-løkke: rAF uden loft, intet frame-skip, stopper ved søvn (`visualizer.js:129-145`).
  `backgroundThrottling: false`.
- Tron-laget: eget 2D-canvas, dpr-loft 1,5, kun hændelsesdrevet (beat, downbeat, drop, section,
  cut, tempo). Slået fra ved hver start (Peters valg).
- Stilhedsvagt (`music-engine.js:153-158, 310-380`; `app.js:936`; `main.js:356`):
  `isThisComputer` = `device.name` == `os.hostname()` (case-insensitiv, præcis). Hint sand → -70 dB,
  sov efter 2 s; falsk (navn matcher ikke, tomt API-svar, web player) → -42 dB, sov efter 0,5 s;
  ukendt → -48 dB, 2 s. Tærsklen måles på rå RMS over 43 ms, før AGC, og skalerer med Spotifys
  volumenskyder. Vågn efter 0,15 s signal. Hver søvn nulstiller tempoet; nyt tempo kræver 4 s lyd,
  så beat-synkrone skift, accenter og gulv-pulsen mangler 4-5 s efter opvågning. Hurtig-tjek af
  Spotify ved falsk hint fyrer kun over RMS 0,01 (-40 dB), ellers venter billedet på 3-s-pollen.
- AGC efter stilhed (*model*): et intro på -38 dB kører gain op på 12; når bandet kommer ind på
  -14 dB, ryger +7 dBFS i limiteren i ~2 s, hvorefter `bass` falder til 0,48 seks sekunder inde.
  Samme efter introens Init (Spotify-volumen × 0,2): første Spotify-nummer kommer ~14 dB for varmt.

## Fund rangeret efter effekt

| # | Klage | Fund | Rettelse | Review | Risiko |
|---|---|---|---|---|---|
| 1 | høj/lav | AGC (τ 0,4-4 s) + Butterchurns longAvg (τ 4,15 s) inverterer: *model* omkvæd +10 dB giver `bass` 2,98 → 1,13 (2 s) → 0,80 (6 s), og verset bagefter 1,19 (opblæst). Langsom AGC (τ 20 s) holder `att` > 1,2 i 5,4 s og aldrig under 0,8 | AGC som per-nummer-normalisering: niveau τ 20-30 s, gain τ 6-10 s, hurtig attack kun mod overstyring, re-seed på nummerskift og efter ≥ 3 s stilhed. Lavere mål (0,08-0,10), så limiteren kun er sikkerhedsnet | lille | lav-mellem: stille numre kommer langsommere op |
| 2 | går ikke i gang | hint = hostname-match; mismatch/tomt svar → -42 dB og 0,5 s | også `COMPUTERNAME`, tomt svar = ukendt, ikke falsk; diagnose printer begge navne; hurtig-tjek fra 0,004 | lille | lav |
| 3 | høj/lav | AGC fryser i stilhed og overstyrer ved opvågning (se model) | ved opvågning og nummerskift: seed fra de første 0,2 s og sæt gain direkte | lille | lav |
| 4 | lavopløst | 2560-loft strækkes på 4K; `Math.round(rect×dpr)` kan ramme 1 px ved siden af; ResizeObserver reagerer ikke på dpr-skift | loft 3840 eller kvalitetsindstilling; mål med `ResizeObserver({box:'device-pixel-content-box'})` (tjek i Electron 44) | lille | mellem: GPU-last på Drews ukendte hardware |
| 5 | lavopløst | luma-aflæsning hvert andet billede; ingen fps-loft | mål fps med/uden `onLuma`; billigere luma (lille mip eller async readback med fence); loft 60 fps (render hvert 2. rAF ved ≥ 100 Hz), evt. "classic 30" | lille-mellem | lav |
| 6 | lavopløst | mesh 48×36, ingen AA | `setInternalMeshSize(64,48)` (1 813 → 3 185 vertices i JS, 1,76×), derefter prøv 96×72 (3,9×); `outputFXAA: true` ved ratio 1 (billig, blødgør lidt). Supersampling kun pr. preset, kun med FXAA, 4× GPU | lille | mellem (CPU); høj for supersampling |
| 7 | forskellige lyde | motorens signaler når ikke presets; overlay pulserer på forudsagt takt, ikke reelle onsets | se spor 4 | mellem-stor | lav (overlay) / mellem (bånd-patch rammer alle presets) |
| 8 | forskellige lyde | Butterchurns bas ≠ kick; motoren har 40-130 Hz kick-bånd (`music-engine.js:53-59`), ubrugt | wrapper om `renderer.audioLevels`: kontrast `v' = 1 + k·(v-1)`, k 1,3-1,6; eller bas-`imm` fra kick-båndet | lille | mellem: ændrer alle presets, blink-vagten skal blive i løkken |
| 9 | går ikke i gang | hver søvn nulstiller tempo; 0,75 s billedhul også | gem tempo over korte søvne (< 10 s) | lille | lav |
| 10 | alle | preset-listens dock-resize kører på hvert pointer-move og genallokerer Butterchurns teksturer | debounce til drag-slut | lille | lav |

## Research-tog: spor i prioriteret rækkefølge

Hvert spor måler før og efter. Intet sendes til Drew før `npm run selftest:full` og selvtest af
`dist/win-unpacked`.

### Spor 0: mål symptomet (før noget rettes)

- `npm run diagnose -- --audio=30` med Spotify spillende: rå dB, silent-flag og AGC-gain pr. sekund.
  Kør med et dynamisk nummer og et EDM-nummer.
- Log pr. billede (midlertidig udviklerkonsol): `music.limiter.reduction`, `music.agcGain`,
  `viz.renderer.audioLevels.bass/treb`. Viser limiteren under -1 dB på kicks, æder den punch.
- Selvtesten logger `track.getSettings()` (kanaler, samplerate, om constraints respekteres) og
  `audioContext.sampleRate`. Ikke logget i dag.
- fps-histogram (p50, p95, billeder over 20 ms) i fuld skærm på `dist/win-unpacked`, med og uden
  `onLuma`, ved 2560 og uden loft. `renderer.fps` og `EXT_disjoint_timer_query_webgl2` hvis til stede.
- Spotify-enhedsnavn mod `os.hostname()` og `COMPUTERNAME` på Peters og Drews pc (diagnosen).
- Peters skærm: opløsning og skalering (afgør om fund 4 overhovedet rammer).
- Spotifys egen "Normalize volume"/"Loud" og Windows' loudness equalization: fladgør før fangst.

### Spor 1: dynamik (fund 1, 3)

- Ny AGC: langsom per-nummer-trim, re-seed ved nummerskift og opvågning, lavere mål. Alternativ:
  statisk gain fra Spotifys `volume_percent` (polles allerede, `app.js:959`) plus langsom trim;
  kræver kalibrering af Spotifys volumenkurve.
- Beslut waveform-adfærd bevidst: Winamp-agtigt (stille = små bølger) eller altid store.
  `render({audioLevels})` tillader egne bytes kun til Butterchurn.
- Mål: `npm run musictest`, `node scripts/bench-music.js` før og efter (motoren ser rå lyd, men
  stilhedsvagten og AGC'en deler kode), plus spor 0-loggen igen.

### Spor 2: vågner ikke (fund 2, 9)

- Hostname-match udvides, tomt svar = ukendt, hurtig-tjek fra 0,004, tempo overlever korte søvne.
- Tærsklerne i sig selv rører vi ikke: Peters baggrundsstøj topper ved -42 dB
  (`.claude/memories/project_music_engine_calibration.md`).

### Spor 3: skarphed og bevægelse (fund 4, 5, 6, 10)

Rækkefølge efter gevinst pr. GPU-krone:

1. Præcise skærmpixels og loft 3840 (eller adaptivt fra målt billedtid).
2. fps-loft 60 (deler af refresh-raten, som MilkDrops docs anbefaler). Presets får Winamp-tempo.
3. Luma-aflæsning billigere.
4. Mesh 64×48, mål JS-billedtid; så 96×72.
5. `outputFXAA: true` ved ratio 1.
6. Supersampling 1,5-2 pr. preset, kun hvor preset-testens ms/billede tillader det (filteret er
   10 ms ved 1280×720 i dag; ved ~9× pixels holder kun presets under ~1,8 ms@720p 60 fps), og kun
   med FXAA. Ændrer udseendet af de 206 presets med texsize-offsets.
7. `powerPreference: 'high-performance'`: opret WebGL2-konteksten med Butterchurns attributter før
   `createVisualizer`, så Butterchurn får samme kontekst. Kun relevant på hybrid-laptops.
   Chromium-flag (`ignore-gpu-blocklist`, `enable-gpu-rasterization`) kun hvis
   `app.getGPUFeatureStatus()` viser software-WebGL. `disable-frame-rate-limit` aldrig.
8. 16-bit farve findes ikke i Butterchurn (RGBA8 fast); WebGL2 kan med `EXT_color_buffer_float`,
   men kræver en fork og ændrer presets, der lever af 8-bit-henfald. Ikke nu.

### Spor 4: forskellige lyde, forskellige elementer (fund 7, 8)

MilkDrop 2 selv har præcedensen: sprites med egen per-billede-kode, fx alpha fra treble. Butterchurn
har ingen sprites, så laget er vores.

- **Tron-laget drives kontinuerligt, ét bånd pr. element**, med forskellig timing, så alt ikke
  pulserer på kicket:
  - bas/kick-onsets: gulvglød og horisont, evt. let kamera-bob; attack hurtig, release 150-250 ms
  - mellem (300 Hz-2,8 kHz: stemme, synth): lyscyklers spor-lysstyrke, bredde, fart; glattet 100-300 ms
  - diskant/hi-hat-onsets: glimt på gitterknuder, scanline-flimmer, farvefrynser; release 50-80 ms
  - spektral flux: glitch og derez-partikler
  - sektionsenergi og builds (motoren): global intensitet, mætning, bloom, stigende gennem et build
  - hvert drivsignal normaliseres MilkDrop-agtigt (aktuel / eget løbende gennemsnit over 10-20 s),
    hysterese på tærskler, alt bag blink-vagten. Laget forbliver additivt og sparsomt.
  - Laget starter slukket i dag (Peters valg 01-10-2026). Skal det blive, er dette spor usynligt
    for de fleste; se fork 2.
- **Kontrast og kick i Butterchurn**: wrapper om `renderer.audioLevels` (fund 8). Globalt og
  billigt, men rammer alle presets. Længere `longAvg` (0,997 ≈ 11 s) lader drops efter builds slå
  hårdere og længere.
- **Efterbehandling i Butterchurns comp-shader** (ingen ekstra pas): global suffix på hvert presets
  comp-shader og default-comp: bloom `ret += GetBlur2(uv)·k·bass_att` (blur-teksturerne er gratis
  glød), farvefrynser ved at sample `sampler_main` med per-kanal uv-offset skaleret af `treb`.
  Et separat canvas kan ikke læse Butterchurns pixels uden kopi pr. billede, så effekter på
  MilkDrop-billedet hører til i Butterchurns egen kontekst.
- **Preset-profilering**: `--presettest` udvides med stimuli, der isolerer ét bånd (kun kick, kun
  mellem, kun hi-hats), så hvert preset får en bas/mellem/diskant-responsprofil, og instruktøren
  kan vælge preset efter sektionens dominerende bånd og lade laget tage resten. Plus en
  "detaljegevinst"-metrik (højfrekvent energi 1440p mod 720p) til at finde presets, der vinder på
  opløsning. Peters K/D-stemmer adskilte bedst på beat-sync (AUC 0,77); det er den bedste
  reaktivitets-evidens, vi har.
- Patch af preset-ligninger (`zoom = 1+(zoom-1)·k`) er skrøbeligt, fordi bevægelsen ofte ligger i
  per-vertex-kode eller shaders. Kun til udvalgte favoritter.

## Forks, der er Peters (anbefalet standard først)

1. **AGC-strategi**: langsom per-nummer-trim (standard) / statisk gain fra Spotify-volumen / slået fra.
2. **Tron-laget**: forbliver slukket ved start (så spor 4's overlay-del kun ses med `trongrid`) /
   tændes som standard, når det er bånd-drevet.
3. **Waveforms**: Winamp-agtigt (små ved stille) / altid store (som nu).
4. **fps**: loft 60 (standard) / "classic 30"-indstilling / uændret.
5. **Kontrast-wrapper på alle presets** (k 1,3-1,6): ja som indstilling / nej, kun overlay.

## Ikke verificeret

- Alle *model*-tal. Limiterens makeup-gain (+0,8-1 dB) er regnet fra Web Audio-specen.
- Lydsporets faktiske indstillinger og samplerate på Peters og Drews pc.
- Om Spotifys enhedsnavn matcher hostname hos Peter og Drew.
- Prisen på luma-aflæsningen, fps i fuld skærm, rAF-adfærd når vinduet er dækket.
- Peters skærmopløsning og skalering.
- Spotifys normalisering og Windows' loudness equalization.
- `device-pixel-content-box` i Electron 44 (MDN: ikke Baseline).
- MilkDrops "64×48-anbefaling" og "Smooth shader" findes ikke i kilden; de var fra hukommelsen.
