# Research: hvordan Winamp og MilkDrop virker, og hvad vi må bruge

Undersøgt 29-09-2026. Kilder nederst.

## Konklusion

- **Winamps kildekode kan ikke bruges.** Den var kun kortvarigt offentlig i 2024, under en licens der forbyder at distribuere ændrede versioner. Den er fjernet igen.
- **Winamps visualizer, MilkDrop 2, er open source (BSD).** Det er den del, The Grid (tidligere Visamp) genskaber. Vi bruger Butterchurn, en MIT-licenseret WebGL-implementering af MilkDrop 2, som kører de originale presets.
- **The Grid indeholder ingen Winamp-kode og ingen Winamp-grafik.** Temaet "Classic" er et originalt design i Winamps ånd: lys/mørk kant, grønt LCD-display og en blå markering i playlisten. Standardtemaet er inspireret af Tron.

## Winamps kildekode (2024)

- 24. september 2024 lagde Llama Group Winamps kildekode på GitHub (`WinampDesktop/winamp`) under "Winamp Collaborative License" v1.0. Den forbød forks.
- Licensen blev hurtigt ændret til v1.0.1. Den tillader at læse koden og ændre den "for private use only", men ikke at distribuere ændrede versioner i kilde- eller binær form. Kun de officielle vedligeholdere må distribuere. Bidrag overdrages til Winamp, og der gives ingen varemærkerettigheder.
- 16. oktober 2024 blev repoet slettet. Det viste sig at indeholde kode, der ikke måtte offentliggøres: Shoutcast-serveren, SDK-kode fra Intel, Microsoft og Dolby samt GPL-kode.
- Organisationen har ingen offentlige repos i dag. Vi fandt ingen ny udgivelse eller licensændring i 2025-26.

Selv hvis koden var tilgængelig, ville et program bygget på den ikke kunne deles. Uofficielle spejlinger indeholder desuden tredjepartskode, som ingen har ret til at videregive. Derfor er den ikke brugt.

## Det der faktisk er åbent

| Projekt | Licens | Hvad det er |
|---|---|---|
| MilkDrop 2 (v2.25c, maj 2013) | BSD, 3 klausuler, "Copyright 2005-2013 Nullsoft" | Ryan Geiss' visualizer-plugin til Winamp. Ligger på SourceForge (`milkdrop2`); den aktive videreudvikling hedder MilkDrop3. |
| Butterchurn 2.6.7 | MIT | WebGL 2-implementering af MilkDrop 2 af Jordan Berg. Kører de originale presets, omsat til JSON. |
| butterchurn-presets 2.4.7 | MIT | 395 unikke MilkDrop-presets fordelt på seks pakker. Selve presets er lavet af MilkDrop-miljøets forfattere. |
| Webamp | MIT | En browserkopi af Winamp 2's brugerflade med Butterchurn indbygget. |

**Webamp blev overvejet og fravalgt.** Den afspiller sine egne lydfiler i browseren, så dens knapper og ur kan ikke styre Spotify. Den genbruger desuden Winamps originale skin-grafik. En egen brugerflade giver fuld kontrol over Spotify-integrationen.

**Butterchurn 3.x blev fravalgt.** Den findes kun som beta (3.0.0-beta.5, juli 2025) og kun som ES-modul. 2.6.7 er stadig den seneste stabile version.

## Sådan fik en Winamp-visualizer sin lyd

Winamps plugin-API til visualisering er beskrevet i `VIS.H`. Et plugin eksporterer en `winampVisHeader` med `version` (0x101), en beskrivelse og `getModule(int)`. Hvert modul er en `winampVisModule` med disse felter:

- `sRate`, `nCh`: samplerate og antal kanaler.
- `latencyMs`, `delayMs`: hvor meget visualiseringen skal forsinkes, så billedet passer til det, man hører.
- `spectrumNch`, `waveformNch`: hvor mange kanaler pluginet vil have.
- `unsigned char spectrumData[2][576]` og `unsigned char waveformData[2][576]`: 576 værdier pr. kanal pr. billede.
- Callbacks: `Config`, `Init`, `Render` (0 = fortsæt, 1 = stop) og `Quit`.

Winamp kaldte `Render` for hvert billede med de seneste 576 samples. MilkDrop læser bølgeformen som signed 8-bit, ignorerer Winamps færdige spektrum og laver sin egen FFT.

## Sådan tegner MilkDrop

For hvert billede sker følgende:

1. **Lydniveauer.** `bass`, `mid` og `treb` samt langsomme udgaver (`bass_att` osv.) beregnes ud fra FFT'en.
2. **Per-frame-ligninger.** Presetets formler sætter parametre som zoom, rotation, warp, forskydning, farver og decay ud fra tid og lydniveauer.
3. **Warp-mesh.** Et gitter (typisk 48 x 36) forvrider det *forrige* billede. Per-vertex-ligninger kan ændre hvert punkt. Feedback-sløjfen er det, der giver MilkDrops flydende "bevægelse".
4. **Bølger og former.** Indbyggede og brugerdefinerede bølgeformer og polygoner tegnes oven på.
5. **Composite.** Et sidste shader-trin laver farver, gamma, ekko og lignende, før billedet vises.
6. **Blending.** Ved skift mellem presets blandes de to over nogle sekunder. MilkDrops standard er 2,7 sekunder.

Butterchurn gør det samme i WebGL 2. Presetets ligninger oversættes til JavaScript med `new Function`. Derfor kræver appens Content-Security-Policy `'unsafe-eval'`. Butterchurn bruger 1024-punkts FFT og 512 samples pr. kanal, som svarer til Winamps 576.

## Fra Winamp til The Grid

| Winamp | The Grid |
|---|---|
| Input-plugin (dekoder) | Spotify-appen afspiller musikken |
| Output-plugin | Windows' lydsystem, standard-afspilningsenheden |
| Vis-API'ets 576 samples | WASAPI-loopback via Electrons `setDisplayMediaRequestHandler` med `audio: 'loopback'`, derefter Web Audio |
| MilkDrop 2-plugin | Butterchurn 2.6.7 og 395 presets |
| Analysatoren i hovedvinduet, 76 x 16 pixels | Egen implementering i LCD'et, `src/renderer/spectrum.js` |
| Playlist editor | Playliste-panelet, som hentes via Spotify Web API |
| Tasterne Z X C V B | De samme taster, plus MilkDrops preset-taster |

Spotify udleverer ikke rå lyd til andre programmer (DRM). Det gælder også deres officielle Web Playback SDK. The Grid analyserer derfor den lyd, der allerede kommer ud af pc'en. Det er samme princip som Winamp: visualizeren ser det, der sendes til højttalerne.

## Kilder

- The Register, 16-10-2024: https://www.theregister.com/2024/10/16/opensourcing_of_winamp_goes_badly/
- Wikipedia, Winamp: https://en.wikipedia.org/wiki/Winamp
- Winamp Collaborative License v1.0.1, læst fra et uofficielt spejl: https://github.com/manfromafar/winamp (LICENSE.md)
- MilkDrop 2 på SourceForge: https://sourceforge.net/projects/milkdrop2/
- Ryan Geiss' repo med `VIS.H`: https://github.com/geissomatik/geiss
- npm-registret: https://registry.npmjs.org/butterchurn og https://registry.npmjs.org/butterchurn-presets
- Electron 44, session-API: https://github.com/electron/electron/blob/44-x-y/docs/api/session.md
