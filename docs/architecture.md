# Arkitektur

The Grid (tidligere Visamp) er en Electron-app, der kører lokalt på Windows. Den har tre dele, der hver har én opgave:

- **Spotify-appen spiller musikken.**
- **Windows sender lyden til The Grid via loopback.**
- **The Grid tegner lyden og styrer Spotify via Web API.**

```mermaid
flowchart LR
  subgraph PC[Din pc]
    SP[Spotify-appen] -->|lyd| WIN[Windows lydsystem<br/>standard-enhed]
    WIN -->|WASAPI loopback| MAIN
    subgraph TheGrid[The Grid]
      MAIN[Hovedproces<br/>src/main] -->|MediaStream| REN[Renderer<br/>src/renderer]
      REN -->|IPC via preload| MAIN
    end
    WIN --> HP[Højttalere]
  end
  MAIN -->|PKCE-login, playlister, afspillerkommandoer| API[(Spotify Web API)]
  API -->|styrer| SP
```

## Processer

| Del | Filer | Ansvar |
|---|---|---|
| Hovedproces (Node) | `src/main/` | Vindue, lydfangst, Spotify-login og -API, lagring, medietaster, selvtest |
| Preload | `src/preload/preload.js` | Den eneste bro: udstiller `window.visamp` med `contextBridge` |
| Renderer (Chromium) | `src/renderer/` | Brugerflade, Web Audio, Butterchurn/WebGL, playliste og LCD |
| Delt | `src/shared/format.js` | Formatering af tid og titler. Bruges af rendereren og af tests. |
| `src/shared/i18n.js` | Alle tekster, brugeren ser (altid engelsk), og `t(nøgle, værdier)`. Bruges af rendereren, login-siden og tests. |
| `src/shared/grid-font.js` | Lyscykel-skriften: bogstaver af vandrette og lodrette streger, som introens cykler kører. |
| `src/shared/music-engine.js` | Musikmotoren: tempo, slag, dele af sangen, drops, stilhed, profiler af presets og instruktøren. Bruges af rendereren og af tests. |
| `src/shared/agc.js` | Det automatiske lydniveau foran Butterchurn: langsom trim pr. nummer, hurtig kun mod overstyring, måles forfra ved nummerskift (se `music_engine.md`). Bruges af `music.js` og af tests. |
| `src/shared/frame-pacer.js` | Billedtakten for visualizeren (højst ca. 60 fps, se Rendering) og billedtider til selvtesten. |
| `src/shared/band-drive.js` | Bånd-drevet til Tron-laget: hvert bånd normaliseret mod sit eget gennemsnit over 15 s og glattet med egen attack og release, onsets med hysterese, og intensitet og mætning efter sangens del. |
| `src/shared/punch.js` | Punch: kontrast i Butterchurns lydniveauer, `v' = max(0, 1 + k·(v − 1))`, og wrapperen om `renderer.audioLevels`. |

Rendereren har ingen Node-adgang og laver ingen netværkskald. Alt Spotify-arbejde sker i hovedprocessen.

## Moduler i hovedprocessen

| Fil | Indhold |
|---|---|
| `main.js` | Starter appen, opretter vinduet, registrerer IPC-kanaler, tillader kun Spotify-adresser udadtil |
| `audio-capture.js` | `setDisplayMediaRequestHandler` giver systemlyd (`audio: 'loopback'`) og tillader kun få tilladelser |
| `audio-devices.js` | Holder øje med Windows' standard-afspilningsenhed via `ps/audio-watch.ps1` og melder skift, så lydfangsten kan startes forfra |
| `powershell.js`, `ps/` | Kører PowerShell-scripts som filer med `-File`. `ps/audio-watch.ps1` og `ps/audio-devices.cs` (Core Audio), `ps/mediakey.ps1` og `ps/play-wav.ps1` (selvtest). I den pakkede app ligger `ps/` i `app.asar.unpacked`. |
| `spotify-auth.js` | PKCE-login med loopback-server på `127.0.0.1:43117`, fornyelse af tokens |
| `pkce.js` | Kodeverifikator og challenge (RFC 7636) |
| `spotify-api.js` | Web API-kald, sideskift, fejl med koder og detaljer (oversættes i rendereren), normalisering af numre |
| `spotify-parse.js` | Forstår Spotify-links og URI'er |
| `this-computer.js` | Afgør, om en Spotify-enhed er denne pc (`os.hostname()` eller `COMPUTERNAME`). Svaret vælger stilhedstærsklen (se docs/music_engine.md). |
| `playback.js` | Afspil og styr med fallback. Uden login eller Premium åbnes appen, og knapperne bliver medietaster. |
| `mediakeys.js` | Windows-medietaster via `keybd_event` i `ps/mediakey.ps1` |
| `store.js` | Indstillinger og krypterede tokens i `%APPDATA%\The Grid`, og det indbyggede Client ID. `main.js` flytter data fra `%APPDATA%\Visamp` ved første start. |
| `icon.js` | Tegner app-ikonet (en identitetsdisk fra Tron) og koder det som PNG. `scripts/prepare-build.js` laver `.ico` til installationen. |
| `selftest.js` | `npm run selftest`: afspiller en testlyd og tjekker lydfangst og rendering |
| `diagnose.js` | `npm run diagnose`: læser Spotify-tilstanden på en kopi af datamappen uden at forny login. Med `--play` prøves afspil-knappens kode. |

## Moduler i rendereren

| Fil | Indhold |
|---|---|
| `app.js` | Samler det hele: sprog og tema, lydfangst, musikmotor og instruktør, Spotify-status, playliste, afspilning, LCD, tastatur, fuld skærm, dialoger, opsætningsguide, påskeæg, selvtest |
| `intro.js` | Introen i tre faser. **Kamp:** 16 cykler på et felt-gitter; AI'en vælger retning ud fra fri plads (flood fill, så den undgår fælder), lige ud, og afskæring (den sigter efter det sted, modstanderen er på vej hen). Kameraet projicerer gulvet i perspektiv, så væggene står op, og følger midten af kampen. Gnister langs vægge, derez med splinter, trykbølge, blink og rystelse. **Finale:** 1,3 s før slut vælges den bedste på hvert hold; de andre kører i væggen. **Duel:** baner af rette stykker (`PathBuilder`) gennem bogstavernes streger; taberens fart beregnes, så den rammer vinderens afskæringsvæg lige efter, at den er lagt. Bruges også af påskeæggene. |
| `intro-war.js` | Standardintroen "The long battle" (arver fra `GridIntro`). **Instruktør:** holder antallet af levende cykler på en jævnt faldende kurve fra 16 til 2 (eller 1 ved kun kamp). Er der for mange, arrangeres et **drab** (`tryKill`): en jæger fra det andet hold, der ud fra et afstandskort (BFS) kan nå et felt på byttets bane før byttet, får et ryk (`huntBoost`), kører derhen og krydser banen på tværs; byttet holder kursen og kører ind i jægerens væg. Kun hvis intet drab kan lade sig gøre i et stykke tid, sendes én i væggen (`doomOne`). Er der for få, slipper en cykel for at dø (i yderste nød kører den gennem en væg et øjeblik, aldrig ud over kanten). Cyklerne dør ellers kun af en modstanders væg; er en lukket inde, og en modstanders væg er en del af fælden, tæller det som modstanderens drab (`cause`, `killedBy`). `chooseDir` er skærpet: større fyld-område, straf for smalle korridorer og for felter, andres forhjul er på vej hen mod. **Lysvæggene har en hale** (`trailSeconds` 7, i finalen 4), der derezzer bag cyklen, så arenaen ikke deles op i lukkede rum. Det sidste medlem af et hold beskyttes, så finalen står mellem to hold. **Tekstfeltet** øverst er spærret for kampen. **Skrivere:** en cykel fra holdet får en skriveopgave (et ord eller en bid af et), finder vej med BFS over (celle, retning) uden 180-graders vendinger, kører bogstavernes streger og vender tilbage til kampen; dens gamle væg derezzer bag den, og bogstaverne bliver stående. **Finale:** de to sidste er beskyttet i `duelSeconds` (igangværende jagter afbrydes), så jagter vinderen taberen med et kraftigere ryk (`huntBoostFinal`), mens taberen tøver lidt, når angrebet kommer; står en væg imellem, kører vinderen (`stalk`) hen til det nåbare felt tættest på taberens bane. Taberen dør altid af vinderens afskæring; derefter skriver vinderen det sidste ord, mens kameraet drejer ned. Ved kun kamp zoomer kameraet ind på vinderen, og holdets navn vises. |
| `eggs.js` | Påskeæg: Tron-ord i link-feltet, Konami-koden og snydearket (`CHEAT_SHEET`), som Flynns terminal viser. Terminalen (`openTerminal`, `termRun` i `app.js`) åbnes med `whoami`. Se CLAUDE.md. |
| `music.js` | Lydkæden foran visualizeren (forsinkelse, automatisk lydniveau, begrænser) og analysen til musikmotoren. Se `music_engine.md`. |
| `musictest.js`, `probe.js` | `npm run musictest` (offline mod facit eller en lydfil) og lyddiagnosen `npm run diagnose -- --audio` |
| `visualizer.js` | Butterchurn: 1.057 presets (395 fra butterchurn-presets og 662 fra Cream of the Crop, se docs/presets.md), historik, tilfældig eller fast rækkefølge, titelanimation, overgange, punch (se "Butterchurns lydniveauer"), renderstørrelse, billedtakt og lysstyrke til blink-vagten (se Rendering) |
| `tron-overlay.js` | Tron-laget ("trongrid"): eget 2D-lærred over Butterchurn, tegnet additivt. Hændelser fra musikmotoren og løbende bånd-drev (se "Tron-laget") |
| `spectrum.js` | Den lille Winamp-analysator på 76 x 16 pixels: spektrum, oscilloskop eller slukket, i temaets farver |
| `playlist.js` | Playliste-listen: valg, afspilning, markering af det aktuelle nummer |
| `index.html`, `styles.css` | Layout og tre temaer via `body[data-theme]`: `grid` (Tron, standard), `clu` (orange) og `classic` (Winamp). Faste tekster har `data-i18n`-attributter. |

## Lydens vej

1. `app.js` kalder `navigator.mediaDevices.getDisplayMedia({ video: true, audio: … })`.
2. Hovedprocessens handler svarer med `{ video: request.frame, audio: 'loopback' }`. Chromium kræver en videokilde, så vi giver appens eget vindue. Brugerens skærm optages derfor aldrig.
3. Rendereren stopper videosporet med det samme. Det er verificeret, at lydsporet fortsætter bagefter; selvtesten rapporterer `videoTracks: ["ended"]` og lyd `live`.
4. Lydsporet bliver en `MediaStreamAudioSourceNode`. Den går gennem lydkæden i `music.js` med forsinkelse, automatisk lydniveau og begrænser, før den når Butterchurn og mini-spektrummet. Musikmotoren analyserer den rå lyd.
5. Intet forbindes til `audioContext.destination`, så lyden spilles ikke igen, og der opstår ingen ekko-sløjfe.

Begrænsning: loopback fanger kun Windows' **standard**-afspilningsenhed, og en kørende fangst bliver på den enhed, der var standard, da den startede. Derfor:

- `audio-devices.js` læser standardenheden hvert sekund med en PowerShell-løkke (`ps/audio-watch.ps1`), der bruger Core Audio (`IMMDeviceEnumerator`), og sender `audio:device` til rendereren.
- Ved et skift starter rendereren lydfangsten forfra. En ny fangst lytter altid på den nuværende standardenhed. Enhedens navn vises under Indstillinger.
- Sikkerhedsnet: melder Spotify, at der spilles på denne pc, men fangsten er helt stille i 4 sekunder, startes den forfra én gang. Hjælper det ikke, forklarer en besked, at Spotify nok spiller på en anden enhed end Windows' standard.

## Rendering

Butterchurn tegner i `#viz` (`visualizer.js`), Tron-laget i sit eget 2D-canvas ovenpå (`tron-overlay.js`).

- **Størrelse:** canvas og Butterchurns teksturer har præcis lige så mange pixels som elementet på skærmen (`pixelRatio` og `textureRatio` 1). `ResizeObserver` med `device-pixel-content-box` giver de præcise skærmpixels uden afrunding af CSS-størrelse × `devicePixelRatio` og melder også, når skaleringen skifter (Windows-skalering, vinduet flyttet til en anden skærm). Reserven er CSS-pixels × `devicePixelRatio` og `matchMedia` på `resolution`.
- **Loft 3840 px bredde** (`MAX_RENDER_WIDTH`): en 4K-skærm i fuld skærm tegnes 1:1, bredere strækkes af browseren. Butterchurn tegner flere fulde pas pr. billede (warp, slør, comp, FXAA), så GPU-prisen vokser med pixelantallet. Supersampling (`textureRatio` over 1) bruges ikke: det koster 4 gange GPU og virker kun sammen med FXAA.
- **Størrelsesskift samles:** det første skift sker med det samme, men under et træk (preset-listens kant, vinduets kant) først 100 ms efter det sidste (`RESIZE_DEBOUNCE_MS`). Hvert skift genopretter Butterchurns teksturer og oversætter udgangs-shaderen igen.
- **Billedtakt højst ca. 60 fps** (`src/shared/frame-pacer.js`). Presets bevæger sig pr. billede: zoom, rotation, henfald og `bass_thresh` i preset-ligningerne er ikke korrigeret for billedraten, så uden loft løb de 2-2,4 gange for hurtigt på 120/144 Hz-skærme. Der tegnes på hver n-te skærmopdatering, hvor n er det mindste heltal, der giver højst 76 fps: 60 og 75 Hz hvert billede, 120 Hz hvert andet (60), 144 Hz hvert andet (72), 165 Hz hvert tredje (55). En fast deler giver en jævn takt. Opdateringsraten estimeres af `requestAnimationFrame`-tidsstemplerne efter første sekund og igen hvert 5. sekund. Musikmotoren og Tron-laget har egne løkker og kører med skærmens fulde rate.
- **Mesh og kantudjævning:** warp-gitteret er 64×48 (Butterchurns standard er 48×36), og `outputFXAA` udjævner 1-px-linjer i et ekstra pas.
- **GPU:** WebGL2-konteksten oprettes med Butterchurns egne attributter plus `powerPreference: 'high-performance'` (den hurtige GPU på bærbare med to grafikkort), før Butterchurn beder om den og får den samme. Grafikkortets navn står i konsollen (`WebGL renderer:`) og i selvtestens rapport.
- **Lysstyrke til blink-vagten:** ca. 30 målinger i sekundet efter tid (`SAMPLE_RATE` i `flash-guard.js`), ikke pr. billede, fordi vagtens tærskler er stemt efter 30 målinger i sekundet; ved færre ligner blink på slaget et stroboskop. Billedet skaleres ned til 48×27 på GPU'en (`blitFramebuffer`) og læses asynkront gennem en pixel-buffer med et hegn (`fenceSync`), så CPU'en ikke venter på GPU'en; svaret kommer 1-2 billeder senere. Før kopierede `drawImage` hele billedet til CPU'en hvert andet billede. Giver første aflæsning en WebGL-fejl, bruges `drawImage` igen (advarsel i konsollen, `lumaMethod: "canvas-copy"` i selvtesten).
- **Tron-laget** måler sin størrelse på samme måde, men med højst 1,5 lærredspixel pr. CSS-pixel: bløde, glødende 2D-linjer vinder ikke på fulde 4K-pixels.
- **Selvtestens mål** (`report.json`, `report.render`): `size` (canvas), `screenPixels` (elementet før loftet), `cssSize`, `devicePixelRatio`, `devicePixelBox`, `capped`, `mesh`, `fxaa`, `gpu`, `refreshHz`, `divisor`, `targetFps`, `fps` (over hele vinduet), `renderFps` (mens visualizeren var vågen), `frameTimeMs` (tid mellem tegnede billeder: `p50`, `p95`, `max`, `over20`), `rafIntervalMs`, `renderCpuMs` (CPU-tid i `render()`), `lumaMethod` og `lumaSamples`. Under `report.capture` står lydsporets `trackSettings` og `sampleRate`. Et billede over 20 ms er et hak ved 60 fps.
## Butterchurns lydniveauer og punch

Butterchurn 2.6.7 regner som MilkDrop 2 `bass`, `mid`, `treb` og de glattede `_att` som forhold mod de seneste ca. 4 sekunder: 1,0 er "som det plejer". `visualizer.js` lægger efter `createVisualizer` en wrapper (`wrapAudioLevels` i `src/shared/punch.js`) om `viz.renderer.audioLevels`. `render()` kalder `updateAudioLevels(fps, frameNum)`, som wrapperen sender videre til Butterchurns eget objekt, og læser derefter de seks værdier; `loadPreset()` læser de samme seks. Wrapperen giver dem med punch, `v' = max(0, 1 + k·(v − 1))`, k = 1,3: slag over gennemsnittet bliver kraftigere, pauserne imellem lavere, og gennemsnittet flytter sig ikke. Indstillingen "Punch" (`music.punch`, standard til) sætter k; fra er k = 1, altså Butterchurns egne tal. Det rammer alle presets; blink-vagten måler stadig billedet og skifter væk fra presets, der blinker konstant. `test/punch.test.js` tjekker i den låste Butterchurn, at objektet kun læses de syv steder. Preset-testens målinger (`presettest.js`) er lavet uden punch.

## Tron-laget

`tron-overlay.js` tegner et perspektivgulv, lyscykler og glimt på et 2D-lærred over Butterchurn med `lighter`, så MilkDrop stadig er hovedsagen. Laget starter altid slukket (Peters valg) og tændes med "trongrid". Det drives to veje fra `musicLoop` i `app.js`:

- **Hændelser:** slag ruller gulvet og sender lyscykler ud på taktstarter, drops sender en flok cykler, en ny del en lysstreg, et hårdt klip et derez-glimt.
- **Bånd** (`drive()`, hvert billede, via `src/shared/band-drive.js`): `MusicListener` gemmer musikmotorens lydtræk (`lastFeatures`), og motoren gemmer sit kick-onset (`lastKickOnset`). Ét bånd pr. element, hvert normaliseret mod sit eget gennemsnit over 15 s og glattet med egen attack og release:

| Bånd | Element | Timing |
|---|---|---|
| Kick 40-130 Hz og rigtige kick-onsets | Gulvets glød og horisonten. Den forudsagte takt lyser kun gulvet op, når der ikke er hørt kicks de seneste 2 s | attack 20 ms, release 0,22 s |
| Mellemtone 320-2800 Hz | Lyscyklernes spor (lysstyrke og bredde 0,7-1,3×) og fart (0,75-1,25×) | 0,1 s op, 0,25 s ned |
| Diskant over 2,8 kHz og hi-hat-onsets (diskantens flux) | Glimt i gitterets knuder og et svagt skanlinje-flimmer på gulvet (højst 6 %) | release 65 ms |
| Sangens del og opbygninger | Global intensitet (0,75 stille, 1 høj, op til 1,15 i toppen af en opbygning) og mætning (mod gråt i stille dele) | 1 s op, 1,5 s ned |

Gennemsnittene står stille under stilhed og starter forfra ved et nyt nummer. Lysstyrken ændres glat; gulvet, den største flade, følger kun kicket, og `test/tron-overlay.test.js` fodrer blink-vagten med gulvets lys ved 180 BPM med sekstendedels-hi-hats og tjekker, at højst 40 % af målingerne er spring (vagten slår til ved 55 %). En fejl i bånd-drevet står i konsollen og slår kun bånd-drevet fra; hændelserne kører videre.

## Spotify-flows

- **Login:** `SpotifyAuth.login()` starter en HTTP-server på `127.0.0.1:43117` og åbner Spotifys authorize-side i browseren. Den modtager koden, bytter den med PKCE-verifikatoren og gemmer tokens krypteret. Refresh-tokens roterer og gemmes igen.
- **Hent playliste:** linket tolkes af `spotify-parse.js`. Korte `spotify.link`-links følges først. `GET /playlists/{id}` giver metadata og den første side af `items`, og `next` følges. Mangler `items`, er playlisten en andens, og den markeres `itemsRestricted`.
- **Afspil:** `PUT /me/player/play` altid med en kontekst:
  - Playliste-numre sendes med `context_uri` og `offset.position`, så Spotify selv fortsætter med de næste numre.
  - Et enkelt nummer sendes i sit albums kontekst med `offset.uri`. Spotify-appen til Windows tømmer nemlig afspilleren ved en løs `uris`-kommando (verificeret 29-09-2026).
  - Uden aktiv enhed findes en afspiller, eller Spotify-appen startes, og der ventes op til 10 sekunder.
  - Bagefter spørger The Grid `GET /me/player` op til 4 sekunder for at se, at musikken faktisk spiller. Ellers åbnes nummeret med et `spotify:track:`-link, som appen altid afspiller.
- **Status:** `GET /me/player` hvert 3. sekund, når vinduet er synligt. Uret regnes lokalt imellem kaldene. Nyt nummer starter MilkDrops titelanimation.
- **Kø:** for andres playlister vises `GET /me/player/queue` i stedet for nummerlisten.

## IPC-kanaler

Alle svar har formen `{ ok: true, data }` eller `{ ok: false, error: { code, message, detail, status } }`. Rendereren viser teksten `err.<code>` fra `i18n.js` med `detail` indsat; `message` er kun reserve og ses i diagnosen.

| Kanal | Formål |
|---|---|
| `app:info`, `app:copyText`, `app:openSpotifyDashboard` | Appinfo, udklipsholder, dashboard-link |
| `settings:get`, `settings:set` | Indstillinger. Input valideres, og skift af Client ID logger ud. |
| `spotify:status`, `spotify:login`, `spotify:logout` | Login-tilstand |
| `spotify:checkClientId` | Spørger Spotifys token-endpoint med en ugyldig kode: `invalid_grant` betyder, at ID'et findes, `invalid_client` at det ikke gør (fanger et indsat Client Secret) |
| `spotify:loadCollection` | Playliste, album eller nummer, med fremskridt via `spotify:loadProgress` |
| `spotify:play`, `spotify:control`, `spotify:seek`, `spotify:volume` | Afspilning |
| `spotify:playbackState`, `spotify:queue` | Hvad spiller, og hvad kommer |
| `selftest:*` | Kun i selvtest-tilstand |

## Sikkerhedsvalg

- `contextIsolation: true`, `sandbox: true` og `nodeIntegration: false`. Rendereren kan kun det, preload udstiller.
- Content-Security-Policy tillader kun lokale scripts. `'unsafe-eval'` er nødvendig, fordi Butterchurn oversætter preset-ligninger med `new Function`. Electron viser en advarsel om det i udviklerkonsollen; det er forventet.
- Tilladelser: kun `display-capture`, `media`, `fullscreen` og `clipboard-sanitized-write`. Alt andet afvises.
- Eksterne adresser: kun `spotify:`-URI'er og `https://` til accounts-, developer- og open.spotify.com.
- Ingen navigation og ingen nye vinduer i appen.
- PKCE, så der ikke findes nogen client secret, der kan lække. Tokens krypteres med DPAPI.

## Test

- `npm run musictest` sender en syntetisk sang med kendt facit gennem den rigtige Web Audio-analyse i en OfflineAudioContext, uden lyd. Den tjekker tempo, slag, dele, drop og at skift lander på taktstart. Med `--file=` analyseres en rigtig lydfil.
- `npm run diagnose -- --audio=30` lytter med på det, der spiller, og viser hvad musikmotoren hører.
- `npm test` kører 178 unit-tests med Nodes indbyggede testrunner. De dækker:
  - linktolkning, PKCE (RFC 7636-vektoren) og hele login-flowet mod en rigtig loopback-server;
  - token-fornyelse, API-fejlkoder og 2026-formatet for playlister;
  - afspil-forespørgsler med kontekst, verifikation af afspilning og afspilningens fallbacks;
  - musikmotorens tempo, slag, dele, drops, stilhed, tempo gennem pauser, instruktør og profiler af presets (33 tests);
  - det automatiske lydniveau: et højere omkvæd forbliver højere i Butterchurns øjne, et stille intro giver ikke overstyring, når bandet kommer, måling forfra og frysning i stilhed;
  - genkendelsen af denne pc i Spotifys enhedsliste (hostname og `COMPUTERNAME`);
  - Tron-lagets bånd-drev (normalisering, kuverternes tider, onsets, opbygning) og laget selv: rigtige kicks frem for den forudsagte takt, mellemtonen på lyscyklerne, glimt, og at blink-vagten ikke slår til på laget;
  - punch-formlen, wrapperen om Butterchurns lydniveauer, og at den låste Butterchurn kun læser de seks niveauer;
  - overvågningen af Windows' standard-lydenhed, PowerShell-scripts som filer og stien i den pakkede app;
  - den lange kamp: mange derez spredt over mindst 7 sekunder, alle bogstaver skrevet før finalen, vinderen skriver det sidste ord, under 22 sekunder, og at Game Grid altid kårer en vinder;
  - den anden introstils koreografi med seedet tilfældighed: mange derez, taberen rammer væggen efter afskæringen, GRID skrives til sidst, kun rette vinkler, varighed under 15 s, og påskeæggenes varianter;
  - at snydearket nævner alle påskeæg og Konami-koden;
  - billedtakten (deleren for 60-240 Hz, estimat af opdateringsraten, tabte billeder, pauser), renderstørrelsen og loftet, samlingen af størrelsesskift, lysstyrke-aflæsningen mod et falsk WebGL2 (GL-tilstanden lægges tilbage) og at blink-vagtens tærskler kræver 30 målinger i sekundet;
  - at alle tekster er engelske og ikke tomme, at alle nøgler i `index.html`, `app.js` og hovedprocessens fejlkoder findes, og at lyscykel-skriften har alle bogstaver og kun rette vinkler.
- `npm run diagnose -- --play` afspiller det sidst hentede link mod den rigtige Spotify-app med afspil-knappens kode og viser hver udveksling med Spotify.
- `npm run selftest` starter appen i en separat datamappe og afspiller en 3 sekunders testlyd gennem Windows. Den måler, hvad visualizeren modtog, og tager skærmbilleder. Skærmbillederne omfatter dialogerne, guiden, introen (holdene rezzer ind, midt i kampen, duellen lige før sammenstødet, færdig tekst), fuld skærm og Clu-temaet. Resultatet skrives til `%TEMP%\the-grid-selftest` eller til `--selftest-out=<mappe>`, og exit-koden er 0, hvis lydfangst og rendering virker.

Første verificerede kørsel, 29-09-2026:

| Måling | Værdi |
|---|---|
| Peak-RMS før testlyd | 0,006 |
| Peak-RMS under testlyd | 0,22 |
| Billeder pr. sekund | 59,9 |
| Presets indlæst | 395 |
| Presets med fejl | 0 |

## Installationsfil

- `npm run dist` kører `scripts/prepare-build.js` (ikon som `.ico` og `THIRD_PARTY_NOTICES.txt` i `build/`) og derefter electron-builder. Resultatet er `dist/The-Grid-Setup-<version>.exe`, en NSIS-installer til Windows x64, cirka 100 MB.
- `npm run dist:dir` bygger kun den udpakkede app i `dist/win-unpacked`. Den kan selvtestes direkte: `"dist/win-unpacked/The Grid.exe" --selftest --selftest-out=<mappe>`.
- Konfigurationen står under `build` i `package.json`:
  - Kun `src/` og de minificerede filer fra Butterchurn, presets og VT323 kommer med. Deres egne afhængigheder (babel-runtime, lodash og så videre) bruges ikke af UMD-filerne og udelades. `app.asar` fylder cirka 4 MB.
  - `src/main/ps/` pakkes ud af asar, så PowerShell kan læse scripts.
  - Kun Chromiums sprogfil `en-US`; appen kører altid med `--lang=en-US`.
  - Electron-fuses: `runAsNode` er slået fra, så `ELECTRON_RUN_AS_NODE` ikke kan gøre den installerede app til ren Node. Node-indstillinger via miljø og `--inspect` er også slået fra, og appen indlæses kun fra asar.
  - Ét-klik-installer (`oneClick`): ingen spørgsmål, installeres pr. bruger i `%LOCALAPPDATA%\Programs\The Grid` uden administrator, med genvej på skrivebordet og i startmenuen, og starter af sig selv bagefter (`runAfterFinish`). En ny installer oven i den gamle beholder `%APPDATA%\The Grid`.
- Filen er ikke kodesigneret. Windows SmartScreen advarer første gang ("More info", "Run anyway").
- Diagnosen virker også i den installerede app, men et Windows-program uden konsol skriver kun, hvis output sendes til en fil: `"The Grid.exe" --diagnose > diagnose.txt`.

