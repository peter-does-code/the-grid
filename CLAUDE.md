# The Grid — Tron-inspireret MilkDrop-visualizer til Spotify

Personligt projekt, der kører lokalt på Windows. Det er ikke et WeZimplify-kundeprojekt. Programmet hed tidligere **Visamp**; det blev omdøbt til **The Grid** den 30-09-2026 og deles med Peters ven Drew (engelsk) via en installationsfil.

The Grid opfører sig som klassisk Winamp 2 med MilkDrop, men ser ud som Tron. Spotify er valgfrit: uden login visualiseres al lyd på pc'en ("Just visualize what's playing", se `docs/music_engine.md`, "Uden Spotify"). Med login indsætter brugeren et Spotify-link, og The Grid henter nummerlisten via Spotify Web API og starter afspilningen i Spotify-appen. Den *rigtige* systemlyd fanges via Windows-loopback og visualiseres med Butterchurn (MilkDrop 2 i WebGL). Der er to intro-stilarter (Settings → Intro). **The long battle** (standard, `intro-war.js`, cirka 22-26 sekunder): 16 lyscykler kæmper i 3D og elimineres én efter én, mest ved rigtige afskæringer (en jæger krydser byttets bane, og byttet kører ind i væggen); mens kampen raser, bryder cykler ud og skriver "WELCOME TO THE" i tekstfeltet øverst med deres lysvægge; de sidste to (én fra hvert hold) kæmper, vinderen (tilfældigt hold) skærer taberen af og skriver "GRID". Vinderen bestemmer temaet ved start: orange → Clus tema, blå → det blå (ikke Classic). **Battle and duel** (`intro.js`, cirka 13 sekunder): kampen, derefter skriver de sidste to teksten, og taberen derezzer mod vinderens afskæringsvæg.

Dokumentation i `docs/` (indeks: `docs/README.md`). Drews vejledning: `docs/en/getting_started.md`. Memories i `.claude/memories/`.

## Kommandoer

| Kommando | Hvad |
|---|---|
| `npm start` eller dobbeltklik på `The Grid.cmd` | Start appen fra kildekoden |
| `npm test` | 138 unit-tests (Node test runner, ingen Electron) |
| `npm run selftest` | Hurtig selvtest (ca. 20 s): starter appen, afspiller en 3 sekunders testlyd, tjekker lydfangst og rendering, tager skærmbilleder af dialogerne, introens start, fuld skærm og Clu-temaet, og tjekker at Init kan høres (afspiller den i 4 s). **Laver lyd på pc'en.** |
| `npm run selftest:quiet` | Som `npm run selftest`, men med næsten uhørlig testlyd og Init (`--quiet`, virker også med `--selftest-full`). **Brug den som standard**: Peter bad om, at testene ikke spiller højt (01-10-2026). Billeder i sekundet er lavere (ca. 34) fra kildekoden end i den pakkede app (60); mål ydelse på `dist/win-unpacked` |
| `npm run selftest:full` | Fuld selvtest (ca. 90 s): også introens faser, den anden intro, Game Grid-vinderen og alle påskeæg, i realtid. Før en ny installationsfil, og efter ændringer i intro eller påskeæg. |
| `node scripts/start.js --selftest --selftest-out=<mappe>` | Selvtest med valgfri output-mappe |
| `npm run musictest` | Musikmotoren mod to syntetiske sange med kendt facit (tempo, slag, dele, drop, opbygning). Offline og lydløst. |
| `node scripts/bench-music.js` | Benchmark af musikmotoren på Init, Peters optagelser i Downloads, testsangene i `test/audio/` og de syntetiske sange: hvornår tempoet låses, hvor jævne slagene er, opbygninger og drops. Kør før og efter ændringer i motoren. |
| `node scripts/make-beatmap.js <musiktest.json>` | Laver beat-kortet til Init ud fra `node scripts/start.js --musictest --file=src/renderer/media/init.mp3 > musiktest.json` |
| `npm run musictest -- --file=<lydfil>` | Samme analyse af en rigtig lydfil, plus et uafhængigt tempoestimat for hele filen og bassens niveau hvert kvarte sekund |
| `npm run diagnose -- --audio=30` | Lytter med på det, der rent faktisk spiller, i 30 s og viser hvad musikmotoren hører |
| `npm run diagnose` | Læser Spotify-tilstanden (login, rettigheder, afspillere, hvad der spiller). Ændrer intet. |
| `node scripts/start.js --diagnose "--search=<tekst>"` | Søger som påskeægget "drew" og viser Spotifys svar. Ændrer intet. |
| `npm run diagnose -- --play` | Afspiller det sidst hentede link med afspil-knappens kode og viser Spotifys svar. **Starter musik.** |
| `npm run dist` | Bygger installationsfilen `dist/The-Grid-Setup-<version>.exe` (NSIS, x64, cirka 100 MB) |
| `node scripts/start.js --review` | Gennemsyn af frasorterede presets i et eget vindue: ← → bladrer, K beholder, D bandlyser (se `docs/presets.md`) |
| `npm run presets:pack` | Bygger preset-pakken ud fra målingerne i `presets-work/` og ban- og behold-listerne (se `docs/presets.md`) |
| `npm run presets:review` | 50 nye kandidater efter Peters smag i review-vinduet (K behold, D ban) |
| `npm run presets:classics` | 50 Winamp-klassikere (MilkDrops egen pakke), Peter ikke har stemt om, i review-vinduet |
| `npm run presets:missing` | De Winamp-klassikere, preset-testen sorterede fra, men som kan tegnes, i review-vinduet; K tager dem med uanset målingerne |
| `node scripts/collect-votes.js [--all]` | Brugernes stemmer (K/D) fra releases-repoets issues ind i `data/preset-votes.jsonl` (commit bagefter), luk issues og vis et overblik. Ændrer ingen lister. |
| `npm run release` | Udgiver en ny version til Drew: test, versionshop, installationsfil til det private releases-repo, git-tag og push. Kun fra en ren arbejdsmappe. `-- --force` får brugernes app til at genstarte selv. Se `docs/releasing.md` |
| `npm run dist:dir` | Bygger kun `dist/win-unpacked`. Selvtest: `"dist/win-unpacked/The Grid.exe" --selftest --selftest-out=<mappe>` |

Udviklerværktøjer i appen: `Ctrl+Shift+I` eller `F12`. I den installerede app: `"The Grid.exe" --diagnose > diagnose.txt` (uden omdirigering vises intet, da programmet ikke har en konsol).

## Struktur

- `src/main/` er hovedprocessen: vindue, lydfangst (`audio-capture.js`), Spotify (`spotify-auth.js`, `spotify-api.js`, `playback.js`), lagring (`store.js`), medietaster, selvtest og diagnose.
- `src/main/ps/` indeholder PowerShell-scripts (enhedsovervågning, medietaster, testlyd), som `powershell.js` kører med `-File`.
- `src/preload/preload.js` er den eneste bro til rendereren (`window.visamp`).
- `src/renderer/` er brugerfladen: `app.js` (limen), `intro.js` og `intro-war.js` (de to intro-stilarter; `GridIntroWar` arver kamera, vægge og effekter fra `GridIntro`; koreografien testes i `test/intro.test.js` med et falsk lærred), `eggs.js` (påskeæg), `visualizer.js` (Butterchurn), `spectrum.js` (mini-analysator), `playlist.js`, `index.html` og `styles.css`.
- `src/shared/i18n.js` har alle tekster, brugeren ser (engelsk). `src/shared/grid-font.js` er lyscykel-skriften. `src/shared/format.js` er formateringer. `src/shared/music-engine.js` er musikmotoren: tempo og slag, dele af sangen, drops, stilhed, profiler af presets og "instruktøren", der bestemmer hvornår der skiftes. Alle er ren JavaScript, testet i Node.
- `src/renderer/music.js` er lydkæden foran visualizeren (forsinkelse, automatisk lydniveau, begrænser) og fodrer musikmotoren.
- `scripts/start.js` starter Electron med et rent miljø (se faldgruber). `scripts/prepare-build.js` laver ikon og licensfil til installationen.
- `test/` indeholder unit-tests. `helpers.js` har falsk fetch og token-store.

Detaljer: `docs/architecture.md`.

## Hårde regler

1. **Ingen Winamp-kode eller -grafik.** Kildekoden fra 2024 må ikke distribueres i ændret form og er trukket tilbage. Skin-grafikken er ophavsretligt beskyttet. MilkDrop 2 (BSD) og Butterchurn (MIT) er fine. Se `docs/winamp_research.md`. Det samme gælder Tron: ingen logoer eller skrifttyper fra filmene, og ingen grafik ud over klippet `src/renderer/media/biojazz.mp4` fra Tron: Legacy, som Peter selv har lagt ind til påskeægget "jazz" (30-09-2026). `src/renderer/media/drew.jpg` er et foto af Drew til påskeægget "drew"; det er privat og må ikke bruges andre steder. `src/renderer/media/init.mp3` er "Init" af Nine Inch Nails fra TRON: Ares (Peters egen fil, 30-09-2026); den spiller under introen (fra 12 s, kan slås fra under Settings) og under "drew". Det er den eneste lyd, The Grid selv afspiller; al anden musik kommer fra Spotify. Lydstyrken følger Spotifys (`initVolume` i `app.js`): Spotifys lydstyrke × 0,2, fordi Init er mastret meget højt (0,5 var stadig for højt), × indstillingen under Settings (100 % = normal). Kendes Spotifys lydstyrke ikke, regnes der med 60 %. Før spillede den på 85 % og bragede igennem (02-10-2026). Appen deles kun privat; skulle den nogensinde deles offentligt, skal klippet ud. Citater og farver er fine.
2. **Forbind aldrig lydkilden til `audioContext.destination`**; det giver ekko-sløjfe. Lyden analyseres i realtid. Målinger af en sang (tempo, tidspunkter for dele og drops, lydstyrke) må gemmes i sanghukommelsen (`song-memory.json`, se `docs/music_engine.md`, "Sanghukommelse"); reglen om, at intet måtte gemmes, blev fjernet af Peter 05-10-2026. Selve lyden gemmes ikke.
3. **Kun lokalt.** Ingen server, ingen telemetri. Netværk kun til `accounts.spotify.com`, `api.spotify.com`, opslag af korte `spotify.link`-links og, i den installerede app, GitHub for opdateringer (`api.github.com` og GitHubs filservere, kun det private repo `peter-does-code/the-grid-releases`; se `docs/releasing.md`), og brugernes stemmer på presets som issues i samme repo, kun hvis brugeren har sagt ja (`shareVotes`, `src/main/votes.js`). Der sendes presetnavn, stemme, version og et anonymt id, intet om brugeren. Eksterne links går gennem allowlisten i `main.js`.
4. **Ingen hemmeligheder i repoet.** Tokens og indstillinger ligger i `%APPDATA%\The Grid`. Peters Client ID er bygget ind (`BUILT_IN_CLIENT_ID` i `store.js`); det er ikke hemmeligt, fordi login bruger PKCE og der ingen client secret er. Et Client Secret må aldrig gemmes nogen steder.
5. **Følg Spotifys 2026-regler** (se `docs/spotify_setup.md`): ejeren skal have Premium, højst 5 brugere, `items` kun for egne playlister, ingen redaktionelle playlister, ingen batch-endpoints, `product` er fjernet fra `/me`.
6. **Alt i appen er altid på engelsk** (Peters beslutning 30-09-2026), uanset Windows' sprog. Der er ingen dansk udgave og intet sprogvalg. Tekster i brugerfladen skrives ikke direkte i `index.html` eller `app.js`: de får en nøgle i `src/shared/i18n.js` og bruges via `data-i18n*` eller `t()`. Fejlbeskeder, konsolbeskeder, diagnose- og selvtestoutput fra hovedprocessen er også på engelsk. `main.js` tvinger Chromiums sprog til `en-US` (`--lang`), så også talformater er engelske (2.7). Testen `test/i18n.test.js` fanger manglende nøgler og dansk tekst.

## Faldgruber

- **`ELECTRON_RUN_AS_NODE=1`** er sat i VS Code og Claude Codes miljø. Så starter `electron.exe` som ren Node, og `require('electron').app` er `undefined`. Start altid via `npm start`/`scripts/start.js` eller `The Grid.cmd`, som fjerner variablen. Den installerede app har fusen `runAsNode` slået fra og er upåvirket.
- **Electron 44 henter sin binær ved første kørsel** (ingen postinstall). Kør `node node_modules/electron/install.js` efter en frisk `npm install` for at hente den med det samme.
- **npm 11 blokerer install-scripts** uden godkendelse (`allowScripts` i `package.json`). `core-js` og `electron-winstaller` er afvist med vilje; det første er en donationsbesked, det andet bruges kun til Squirrel, ikke NSIS.
- **Butterchurn skal blive på 2.6.7.** 3.x er beta og kun ESM. UMD-bygget kræver `butterchurn.default.createVisualizer`.
- **CSP kræver `'unsafe-eval'`** (Butterchurns `new Function`). Electrons advarsel om det i konsollen er forventet. Video kræver `media-src 'self'` (bio-digital jazz).
- **Påskeæggenes animationer** kører gennem `showEgg` i `app.js` (markup `#egg` i `index.html`, CSS `.egg[data-kind=...]`). `runEgg` returnerer et løfte, der indfries, når animationen er færdig eller sprunget over med en tast eller et klik; terminalen venter på det.
- **PowerShell-scripts skal være ASCII** og køres med `-File`, aldrig `-EncodedCommand`, som antivirus slår alarm over. Windows PowerShell 5.1 læser scripts uden BOM i ANSI-tegnsættet, så æ, ø og å ødelægger dem. I den pakkede app ligger de i `app.asar.unpacked` (`asarUnpack`); `scriptPath()` i `powershell.js` peger derhen.
- **Skriv aldrig kode med backslashes (regulære udtryk, skabelonstrenge) gennem Bash-heredocs eller `node -e`.** Backslashes forsvinder: `/^drew\.line\d+$/` blev til `/^drew.lined+$/`, så Drew-showets linjer forsvandt (30-09-2026). Brug Write/Edit, eller læg logikken i en testet funktion.
- **Indlejrede `node_modules` kommer ikke med af sig selv.** `node_modules/electron-updater/**/*` tog ikke `electron-updater/node_modules/semver` med. Derfor kunne ingen installeret udgave fra v0.1.1 til v0.1.10 opdatere sig selv; opdaget 02-10-2026 og rettet i v0.1.11 med `node_modules/semver/**/*`. Tjek med `"dist/win-unpacked/The Grid.exe" --update-check`, som `release.js` nu kører før hver udgivelse.
- **Nye filer fra `node_modules` skal på listen under `build.files`** i `package.json`. Kun de minificerede filer kommer med i installationen. Tjek med `npm run dist:dir` og selvtesten af den pakkede app.
- **Loopback fanger kun Windows' standard-lydenhed, og den enhed, der var standard, da fangsten startede.** Skifter brugeren højttaler, hører en kørende fangst ingenting (sket 30-09-2026). `src/main/audio-devices.js` holder derfor øje med standardenheden hvert sekund via Core Audio (`ps/audio-watch.ps1` og `ps/audio-devices.cs`), og rendereren starter lydfangsten forfra ved et skift. Spotify skal spille på Windows' standardenhed.
- **Spotify-appen tømmer afspilleren ved en løs `uris`-kommando.** `PUT /me/player/play` med `{"uris": [...]}` svarer 204, men appen (Windows, 1.301.234.0) ender uden nummer. Kontekst + offset virker, og det samme gør pause og fortsæt. Brug altid `buildPlayRequest` i `src/main/playback.js`, som spiller et enkelt nummer i sit albums kontekst. Efter afspil verificerer The Grid, at musikken starter, og åbner ellers nummeret med et `spotify:track:`-link. Verificeret 29-09-2026; tjek igen med `npm run diagnose -- --experiment`.
- **Søgning uden `market=from_token`.** `GET /search` med `market=from_token` svarer 403 "Insufficient client scope", fordi appen ikke beder om `user-read-private` (opdaget 30-09-2026, da påskeægget "drew" ikke spillede). `searchTrack` sender derfor ingen market. Test mod den rigtige Spotify med `node scripts/start.js --diagnose "--search=<tekst>"` (kun læsning).
- **Ingen musik, intet billede.** Visualizeren og mini-spektrummet slukker, når musikmotoren melder stilhed. Tærsklen afhænger af Spotify:
  - Spiller Spotify på denne pc: -70 dB, altså kun digital stilhed.
  - Pause eller afspilning et andet sted: -42 dB.
  - Ukendt: -48 dB.
  - Peters pc har svag baggrundslyd fra andre programmer på -55 til -63 dB. Den må ikke vække billedet.
- **Presettets navn vises kun ved pilene** (knapper og piletaster). Automatiske skift, mellemrum og de øvrige genveje skifter lydløst. Det er et ønske fra Peter.
- **Fuld skærm viser kun billedet.** Hele siden går i fuld skærm (`document.documentElement`), og `body.fullscreen` skjuler alt andet end visualizeren og alle knapper. Musen skjules efter 2 sekunder uden bevægelse. Teksten uden musik bliver stående.
- **Kalibrering af musikmotoren.** Ret aldrig tærskler i `music-engine.js` uden at køre `npm run musictest` og `node scripts/bench-music.js` før og efter. `onsetLatency` (27 ms) er kalibreret mod dens facit.
- **Diagnosen fornyer aldrig login.** Spotify roterer refresh-tokens, så en fornyelse i en anden proces ville logge den åbne app ud. Diagnosen kører på en kopi af datamappen, så den kan køre ved siden af en åben The Grid. Af samme grund må den gamle Visamp og The Grid ikke køre samtidig efter flytningen af data.
- **Interne navne hedder stadig Visamp** (`window.Visamp`, `VisampFormat`, `VisampMusic`, C#-klassen `VisampAudio`, preload-broen `window.visamp`). Brugeren ser dem aldrig; lad dem være.
- **Se `git status` igennem før et commit med `git add -A`.** Den 05-10-2026 kom Winamp-installationsfilen, som Peter havde lagt i projektmappen, med i et commit og blev pushet; historikken måtte omskrives med force-push. Nye store eller fremmede filer i projektmappen skal i `.gitignore` først.
- Node.js 24 LTS er installeret portabelt i `%LOCALAPPDATA%\Programs\nodejs` og ligger i brugerens PATH.

## Påskeæg

Peter vil have så mange Tron-referencer og påskeæg som muligt; kom gerne med flere. Nye påskeæg skal på snydearket (`CHEAT_SHEET` i `eggs.js`). Ord skrives i link-feltet og sendes med Enter (`eggs.js`, `runEgg` i `app.js`):

| Input | Virkning |
|---|---|
| `flynn`, `flynn lives` | Kort kamp; taberen skriver "FLYNN", vinderen "LIVES" |
| `clu` | Clus hær fejer hen over skærmen ("PERFECTION."), og temaet skifter til orange; igen: tilbage til cyan |
| `mcp`, `end of line` | Rødt flimrende "END OF LINE." |
| `bit`, `bit <spørgsmål>` | Bit svarer tilfældigt YES (gul) eller NO (rød) |
| `derez` | "DEREZZED" splintres, og der skiftes preset med hårdt klip |
| `users` | Tron kaster sin identitetsdisk: "I FIGHT FOR THE USERS!" |
| `greetings program` | "GREETINGS, PROGRAM!" skrives ind med blinkende markør |
| `encom` | ENCOM OS-12 starter op linje for linje |
| `zen` | Flynns hvide tilflugtssted: lyset vokser, "You're messing with my Zen thing, man." |
| `jazz`, `biojazz`, `zuse`, `castor` | Klippet `src/renderer/media/biojazz.mp4` afspilles tre gange: "Bio-digital jazz, man." |
| `rinzler` | Orange disk drejer, "RINZLER" ryster; næste automatiske skift bliver et hårdt klip |
| `who am i` (med mellemrum) | Bits røde NEJ: "SYNTAX ERROR. Spaces? Programs don't do spaces, User." – et vink om, at det skal skrives i ét ord |
| `drew`, `drewbraham`, `drewtopia` | Hyldest til Drew: billedet `src/renderer/media/drew.jpg` hopper til musikken (takten fra musikmotoren, ellers 120 BPM), med Tron-gulv, identitetsringe, splinter, blink og glitch-tekst; "Init" af Nine Inch Nails (`src/renderer/media/init.mp3`) spiller fra start til slut (2:08), og showet slutter med sangen; de sidste 6 s toner Drew, teksten og the Grid ud. Faser efter sangens tid (`fadeEnd`/`fullAt` i `drew.js`, målt med `npm run musictest -- --file=`): 0-10,4 s toner Drew frem af mørket; fra første hørbare bas-slag ved 10,45 s hamrer han på skærmen (lyttet efter af Peter: 8,5 og 9,5 s er bassen, der svulmer op, ikke slag; 12,4 s var for sent); fra 23 s fuld styrke med rystelse og revner i glasset. Slagene kommer fra beat-kortet `src/renderer/media/init-beats.js` ud fra sangens egen tid . Kortet følger de faktiske bas-slag fra 10,45 til 14,2 s (bassen spiller på bagslaget mellem 11,4 og 14 s, så et fast gitter slog ved siden af) og derefter et fast gitter på 92,95 BPM; musikmotoren låser nemlig først takten i Init ved 18 s. En spillende Spotify holder pause imens. Tast eller klik afslutter før tid. Linjerne under navnet er `drew.line1`, `drew.line2`, ... i `i18n.js`; nye linjer skal bare tilføjes dér |
| `tron` (link-feltet og Flynns terminal) | Temaet tilbage til det blå (The Grid). Gemmes |
| `trongrid` (link-feltet og Flynns terminal) | Tron-laget over visualiseringen til og fra (`src/renderer/tron-overlay.js`): et perspektivgulv, der ruller med tempoet og lyser op på slagene, lyscykler på drops og ind imellem på en taktstart, et derez-glimt på hårde klip. Huskes ikke: appen starter altid uden (Peter 01-10-2026). Hed `tron` indtil 02-10-2026 |
| `epic battle` (link-feltet og Flynns terminal) | Game Grid i stor udgave: 40 cykler på et finere gitter (`gridCells: 90`), ca. 1 minut |
| `whoami` | Åbner Flynns terminal (ENCOM OS-12) med snydearket, se herunder |
| `battle`, `game grid`, eller ↑↑↓↓←→←→ hvor som helst | Game Grid: kun kamp med 16 cykler, der elimineres én efter én, til ét hold vinder: "BLUE WINS" / "ORANGE WINS" |
| Dobbeltklik på "THE GRID" i titellinjen | "Greetings, program! You are running The Grid vX." (hilsen og version) |

**Kommandoer til terminalen virker også i link-feltet** (Peters ønske 01-10-2026: når han beder om en terminal-kommando, skal den altid også virke i link-feltet). Snydearket kan stadig have en sektion for kun-terminal (fjerde felt `terminal` i `CHEAT_SHEET`), men den er tom nu.

**Snydearket** ligger i Flynns terminal, som i Tron: Legacy, hvor Sam finder Flynns skjulte terminal under arkadehallen og skriver `whoami`. Sporet dertil: hjælpen (F1) siger "Flynn left his terminal logged in. Ask it who you are.", og udviklerkonsollen nævner `whoami`. Terminalen svarer `flynn` og "Last login: 1989 from flynns-arcade" (året Flynn forsvandt). Kommandoer: `help`, `whoami`, `ls`, `cat easter_eggs.txt` (snydearket), `cat readme.txt`, `uname`, `clear`, `exit`, og Påskeæg-ordene virker også dér, og terminalen kommer tilbage med det hele stående, når påskeægget er færdigt. Snydearket bygges af `CHEAT_SHEET` i `eggs.js`; `test/eggs.test.js` fejler, hvis et påskeæg mangler på det. **Et nyt påskeæg skal derfor også på `CHEAT_SHEET`.**

Derudover: ASCII-logo i udviklerkonsollen, "SECTOR n" og "IDLE" på LCD'et, "Derezzed" når lydfangsten stopper, "End of line" uden musik og ved log ud, "I fight for the Users" i hjælpen, og fejlbeskeder i Tron-sprog.

## Arbejdskonventioner

- Appen er altid på engelsk (regel 6). Docs og kodekommentarer er på dansk, bortset fra Drews vejledning i `docs/en/` og PowerShell-scripts (ASCII).
- Kør `npm test` efter ændringer i `src/main/` eller `src/shared/`. Kør `npm run musictest` efter ændringer i musikmotoren. Kør `npm run selftest` efter ændringer i lydfangst, visualizer eller layout, og `npm run selftest:full` efter ændringer i intro eller påskeæg; se på skærmbillederne. Før en ny installationsfil: `npm run dist:dir` og selvtest af den pakkede app.
- **Overskriv aldrig brugernes indstillinger ved en opdatering** (Peter 05-10-2026). `settings.json` gemmer kun det, brugeren har ændret (`rawSettings` i `store.js`); alt andet kommer fra `DEFAULT_SETTINGS`. En ny standard når derfor ud til alle, der ikke selv har valgt noget, uden en migrering. Skriv ikke nye migreringer, der ændrer en værdi, brugeren kan have valgt.
- Versionsnummeret i `package.json` hæves for hver installationsfil, der sendes til Drew.
- Commit-beskeder: én kort linje.
