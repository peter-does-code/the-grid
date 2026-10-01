# Plan: The Grid til Peters ven Drew

Oprettet 30-09-2026. Levende dokument; opdatér afkrydsningerne undervejs.

## Mål

- Peters ven Drew ("drewbraham", der bor i "Drewtopia") kan installere appen med en almindelig installationsfil, uden Node.js eller kildekode.
- Alt, Drew ser, er på engelsk: brugerflade, beskeder, login-side, guide og vejledning.
- Første opstart guider ham igennem login, lydtjek og første playliste.

## Beslutninger

- **Navnet er "The Grid"** for både Peter og Drew (Peters valg 30-09-2026). Det afløser både "Visamp" og det tidligere forslag "Master Drewgram: Drewrezzed". Én udgave for begge.
- **Alt er altid på engelsk**, også hos Peter (Peters beslutning 30-09-2026). Der er intet sprogvalg.
- **Tron-præg:** introen med lyscykler, der kæmper og skriver "WELCOME TO THE GRID", Tron-tema som standard, og så mange påskeæg som muligt (Peters ønske; se CLAUDE.md).
- **Drew bruger Peters Spotify-udvikler-app.** Spotify tillader op til 5 brugere pr. udvikler-app, og kun ejeren (Peter) skal have Premium. Delingen er udtrykkeligt tilladt, se https://developer.spotify.com/documentation/web-api/concepts/quota-modes.
  - [x] Peter har tilføjet Drews navn og Spotify-e-mail under Settings, User Management (30-09-2026)
  - [ ] Peter omdøber appen på Spotify-dashboardet fra "Winamp" til "The Grid" under Settings, Basic Information. Navnet vises på Drews login-side hos Spotify.
- **Peters Client ID er bygget ind** som standard. Det er ikke hemmeligt, fordi login bruger PKCE, og der findes ingen client secret. Under Indstillinger kan en egen udvikler-app bruges i stedet.
- **Drew har Spotify Premium**, så afspilningsstyring virker for ham.
- **Automatiske opdateringer fra et privat GitHub-repo** (Peters beslutning 30-09-2026, afløser "nye installationsfiler"). Koden ligger i `peter-does-code/the-grid`, installationsfilerne i `peter-does-code/the-grid-releases`; begge er private, så Init og billedet af Drew ikke bliver offentlige. Se docs/releasing.md.
- **Udviklerværktøjerne følger med** (`--diagnose`, `--selftest`), men uden knapper i brugerfladen.
- **Konsekvenser:** udløber Peters Premium, holder appen op med at virke for begge. Kvoten deles af alle brugere af Peters app.

## Arbejdspakker

### 1. PowerShell uden kodede kommandoer — færdig

- [x] Medietaster, enhedsovervågning og selvtestens testlyd ligger i `src/main/ps/*.ps1` og køres med `-File` via `src/main/powershell.js`.
- [x] `src/main/ps/` pakkes ud af asar (`asarUnpack`). Verificeret med selvtesten af den pakkede app.
- **Ikke gjort:** at erstatte overvågningen med Chromiums `devicechange`-hændelse. Den nuværende løsning virker; det kræver en test ved et rigtigt skift af højttaler.

### 2. Fuld skærm uden knapper — færdig

- [x] Hele siden går i fuld skærm; kun visualiseringen vises. Ingen værktøjslinje, heller ikke med musen over billedet.
- [x] Musemarkøren skjules efter 2 sekunder uden bevægelse.
- [x] Tastaturet virker stadig: Esc, F eller dobbeltklik forlader fuld skærm, og piletasterne skifter preset og viser navnet.
- [x] Teksten uden musik ("End of line. Waiting for music.") bliver stående.
- [x] Selvtesten tager et skærmbillede af fuld skærm (`screenshot-fullscreen.png`).

### 3. Engelsk brugerflade — færdig

- [x] Alt er på engelsk: brugerflade, beskeder, login-siden i browseren, hjælpen, guiden, fejl fra hovedprocessen, diagnose- og selvtestoutput. Chromium kører med `--lang=en-US`.
- [x] Teksterne til brugerfladen står samlet i `src/shared/i18n.js` og bruges via `data-i18n*` i `index.html` og `t()` i `app.js`. Fejl vises ud fra `code` med `detail` indsat.
- [x] `test/i18n.test.js`: alle tekster er engelske og ikke tomme, og alle nøgler i `index.html`, `app.js` og hovedprocessens fejlkoder findes.
- En dansk udgave blev bygget og fjernet igen samme dag, da Peter besluttede, at alt altid skal være på engelsk.

### 4. Navn og Tron-præg — færdig

- [x] Navnet "The Grid" i vinduet, titellinjen, login-siden, installeren og `The Grid.exe`. Data i `%APPDATA%\The Grid`; Peters data flyttes automatisk fra `%APPDATA%\Visamp` ved første start.
- [x] Temaer: The Grid (cyan og orange på sort, standard), Clus regime (orange) og Classic (Winamp). Vinduesknapperne følger temaet. Mini-spektrummet har temaets farver.
- [x] App-ikonet er en identitetsdisk i cyan.
- [x] To intro-stilarter (Settings → Intro). Standard er "The long battle": 16 lyscykler elimineres én efter én, mens WELCOME TO THE skrives midt i kampen; de to sidste kæmper, og vinderen skriver GRID (cirka 20 sekunder). Den anden, "Battle and duel", er bevaret. Kan springes over med en tast og slås fra.
- [x] Påskeæg og Tron-tekster: se CLAUDE.md. Snydearket findes i Flynns terminal (`whoami` i link-feltet); hjælpen giver sporet. **Løbende:** Peter vil have flere; foreslå nye, når der arbejdes på appen.

### 5. Første-opstarts-guide — færdig

- [x] Trin: velkomst, login med den indbyggede app, lydtjek med niveaumåler, første playliste, færdig. Vises efter introen, første gang.
- [x] Hvert trin kan springes over. Guiden kan åbnes igen fra Indstillinger. `onboardingDone` gemmes i `settings.json`.
- [x] Avanceret under Indstillinger: egen udvikler-app. Client ID tjekkes hos Spotify med en bevidst ugyldig kode (`invalid_grant` = gyldigt, `invalid_client` = forkert). Det fanger også et indsat Client Secret.
- [x] Svarer Spotify, at brugeren ikke er registreret, siger beskeden: "Access denied: your program isn't registered on this Grid. Ask whoever gave you The Grid to add your Spotify email."

### 6. Installationsfil — færdig

- [x] `electron-builder` 26.15.3. `npm run dist` giver `dist/The-Grid-Setup-0.1.0.exe` (103 MB, NSIS, x64, pr. bruger).
- [x] Ikonet som `.ico` fra `src/main/icon.js` (`scripts/prepare-build.js`).
- [x] Kun det nødvendige kommer med: `src/` og de minificerede filer fra Butterchurn, presets og VT323. `app.asar` er cirka 4 MB. Kun Chromiums sprogfil en-US.
- [x] Stierne `../../node_modules/...` virker i den pakkede app (verificeret med selvtesten af `dist/win-unpacked`: lyd, 395 presets, skrifttype, 33 fps).
- [x] `THIRD_PARTY_NOTICES.txt` ved siden af programmet: Butterchurn, butterchurn-presets, VT323 og Electron. Chromiums licenser følger med i `LICENSES.chromium.html`.
- [x] Electron-fusen `runAsNode` er slået fra.
- **Kendt:** filen er usigneret. Windows viser "Windows protected your PC" første gang, og Drew skal trykke "More info" og derefter "Run anyway".

### 7. Engelsk vejledning til Drew — færdig

- [x] `docs/en/getting_started.md`: installation og SmartScreen, første start, daglig brug, fejlfinding (ingen lyd, "not registered", ingen afspiller) og diagnose med `--diagnose > fil`.
- [ ] Skærmbilleder i vejledningen. Selvtestens billeder er nu engelske og ligger i `docs/images/`.
- [ ] Beslut, om vejledningen skal med i installationen, eller sendes som PDF sammen med filen.

### 8. Test før afsendelse

- [x] `npm test` (102), `npm run musictest` og `npm run selftest` er grønne (30-09-2026), også selvtesten af den pakkede app.
- [ ] Installér den byggede fil på Peters pc og gennemgå første opstart.
- [ ] Log ind med en konto, der ikke er på listen, og bekræft beskeden.
- [ ] Installér en ny version oven i den gamle, og bekræft at indstillinger og login bevares.
- **Kan ikke testes herfra:** Drews pc, hans antivirus og hans lydopsætning.

### 9. Afsendelse

- [ ] Filen er 103 MB. Send via OneDrive, Google Drive eller WeTransfer, ikke e-mail.
- [ ] Send `docs/en/getting_started.md` med, eller i det mindste: Windows' advarsel første gang, og at Spotify skal spille på standard-lydenheden.
