# Udgivelser og automatiske opdateringer

Drews The Grid opdaterer sig selv fra GitHub. Peter udgiver en ny version med én kommando.

## Sådan virker det

- **To private repoer på GitHub-kontoen peter-does-code:**
  - `the-grid`: koden.
  - `the-grid-releases`: kun installationsfilerne (GitHub Releases).
- **Appen tjekker for opdateringer** 10 s efter start og derefter hver 4. time (`src/main/updater.js`, electron-updater). En ny version hentes i baggrunden og installeres, når The Grid lukkes. Drew ser to beskeder:
  - "Update vX downloaded. It installs when you close The Grid."
  - efter genstart: "System upgraded to vX. Greetings, program."
- **Appen bruger en læse-token** til `the-grid-releases`, fordi repoet er privat. Den ligger i installationsfilen (`resources/update-token.txt`) og giver kun adgang til at hente filer fra det ene repo, ikke til koden.
- Det private repo holder også Init (NIN) og billedet af Drew, der ligger i installationsfilen, væk fra offentligheden.

## Engangsopsætning

1. **gh er logget ind som peter-does-code** (allerede gjort). Udgivelsen henter tokenen med `gh auth token --user peter-does-code`. Commits i dette repo har e-mailen pebbesen@live.dk (sat i repoets egen git-konfiguration), så de vises på profilen.
2. **De to private repoer** er oprettet, og koden er skubbet op (01-10-2026). `the-grid-releases` skal have mindst ét commit (her en README): GitHub kan ikke lave en release i et tomt repo og svarer "422 Repository is empty".
3. **Lav læse-tokenen** på github.com, logget ind som peter-does-code:
   1. Gå til Settings → Developer settings → Personal access tokens → **Fine-grained tokens** → Generate new token.
   2. Sæt navn: `the-grid-updates`.
   3. Sæt udløb: det længste, GitHub tillader. Skriv datoen ned nedenfor.
   4. Sæt Repository access: **Only select repositories** → `the-grid-releases`.
   5. Sæt Permissions: **Contents: Read-only** og **Issues: Read and write**, intet andet (Metadata: Read-only kommer automatisk). Issues bruges til brugernes stemmer på presets (`src/main/votes.js`, se docs/presets.md); tokenen kan stadig ikke se koden.
   6. Gem tokenen i `%USERPROFILE%\.the-grid\update-token.txt`, uden andet i filen. Den ligger uden for projektet og kommer aldrig i git.
4. **Første gang Drew får opdateringer:** den første version med opdateringer skal installeres på den gamle måde. Send Drew installationsfilen én gang; derefter opdaterer den sig selv.

Tokenens udløbsdato: _(skriv den her)_

## Udgiv en ny version

```
npm run release            # 0.1.0 → 0.1.1
npm run release -- minor   # 0.1.0 → 0.2.0
```

`scripts/release.js` gør følgende:

1. Kører testene. Fejler én, stopper udgivelsen.
2. Hæver versionen i `package.json`.
3. Bygger installationsfilen med læse-tokenen (`--publish never`), skriver `latest.yml` (`scripts/lib/update-info.js`) og lægger installationsfil, blockmap og `latest.yml` op som én release i `the-grid-releases` med `gh release create`. Kopien af tokenen i `build/` slettes igen.
4. Committer, tagger `vX.Y.Z` og pusher koden til `the-grid`.

Drews app finder den nye version inden for 4 timer eller ved næste start.

- **Normal udgivelse:** beskeden "Update vX downloaded. Click here to restart now" kan klikkes for at installere med det samme; ellers installeres den, når The Grid lukkes.
- **Tvungen udgivelse:** `npm run release -- --force` skriver `force: true` i `latest.yml`. Brugerens app genstarter så selv, når opdateringen er hentet. Det sker i et øjeblik uden musik, med 10 s varsel, og senest efter 3 timer (`forcedRestart` i `app.js`). Det virker fra v0.1.8; ældre udgaver kender ikke markeringen og venter, til de lukkes.
- **Kun fra en ren arbejdsmappe:** `release.js` stopper, hvis der er ændringer, der ikke er committet, og committer selv kun versionen.

## Vigtigt

- **Forny læse-tokenen, før den udløber.** Den nye token kan kun nå ud til Drew gennem en opdatering, som appen henter med den gamle. Udløber den gamle først, holder opdateringerne op, og Drew skal have en installationsfil igen. Appen virker stadig; kun opdateringerne stopper.
- **Tokenen må ikke kunne mere end at læse `the-grid-releases`.** Alle med installationsfilen kan i princippet finde den.
- **Filen er usigneret.** Kun den første installation giver Windows' advarsel ("More info" → "Run anyway"). Opdateringer installeres af appen selv, uden advarsel.
