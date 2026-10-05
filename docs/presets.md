# Presets

The Grid har to slags MilkDrop-presets:

- **butterchurn-presets** (npm, 395 stk.), som Butterchurns forfatter har konverteret.
- **De bedste fra "Cream of the Crop"** i `src/renderer/presets/cream-of-the-crop.js`. Listen over de valgte og deres mål står i `cream-of-the-crop.txt` ved siden af.
- **Winamp-klassikerne** (279 stk.) i `src/renderer/presets/winamp-classics.js`, listen i `winamp-classics.txt`. Se herunder.

## Cream of the Crop

- **Kilde:** https://github.com/projectM-visualizer/presets-cream-of-the-crop.
- **Indhold:** ca. 9.800 MilkDrop-presets, udvalgt og sorteret i stilarter (fx Reaction/Liquid Ripples) af Jason Fletcher (ISOSCELES). Pakken er standard i projectM siden 2022.
- **Licens:** MilkDrop-presets er næsten aldrig frigivet under en bestemt licens. Forfatterne har frigivet dem frit, og projectM regner dem for public domain. Ønsker en forfatter sit preset fjernet, fjerner projectM det. Forfatterne står i presetnavnene, og dem beholder vi.

## Winamp-klassikerne (05-10-2026)

Peter testede The Grid til en fest; gæsterne syntes, det var for kaotisk og hurtigt, og at meget af Winamps charme var væk. Derfor er MilkDrops egen pakke fra den sidste officielle Winamp-udgave med: https://github.com/projectM-visualizer/presets-milkdrop-original (552 presets). 424 af dem manglede: fra Cream of the Crop blev der kun udtaget 20 pr. stilart, og kun 48 af originalerne var med i stikprøven.

- Konverteret med `--per-family=Infinity` (ingen grænse for remix): 547 af 552 (83 s).
- Målt med preset-testen (ca. 5 min), samme tekniske frasortering og blinkregel som Cream of the Crop, men **uden score og stilartspladser**: alle, der virker, kommer med. Peter vælger selv i review.
- Resultat: 279 med. Sorteret fra: 114 findes allerede (indbyggede eller i Cream of the Crop), 47 shader kan ikke oversættes, 45 sorte, 37 hvide, 17 står stille, 6 fejl, 2 blinker.
- **Classic Winamp mode** (Settings → Visualizer, `classicMode`): kun MilkDrops egen pakke. `winamp-classics.js` har også `names` med alle 552 navne, også de 114, der allerede fandtes i de andre pakker, og `setOnly` i `visualizer.js` begrænser udvalget til dem (407 i appen, 05-10-2026). Preset-listen (L) viser stadig alle.
- **Winamps egen kopi** (05-10-2026): Peter lagde Winamp-installationsfilen (`winamp_latest_full.exe`) i projektmappen. Kun presets og teksturer pakkes ud (`Plugins/Milkdrop2/presets` og `textures` til `winamp-src/`, med 7-Zip fra `node_modules/electron-winstaller/vendor/7z.exe`); ingen Winamp-kode. Begge ligger i `.gitignore` og må aldrig i git (hård regel 1). Winamps kopi har 558 presets mod projectMs 552, og pakken bygges nu fra den (`presets-work/classics-winamp`, 551 konverteret). 406 af Winamps 558 er i The Grid; resten sorteres fra som sorte, hvide, stille, ikke-oversættelige eller fejl.
- `npm run presets:missing` åbner review-vinduet med de klassikere, testen sorterede fra, men som kan tegnes (106 den 05-10-2026). K tager dem med uanset målingerne (Peters "behold" går forud for sort, hvidt, stille og for tungt), D bandlyser. Bagefter `npm run presets:pack`.
- De sorte og hvide kan være falske: målingen tager 3 s, og nogle klassikere starter mørkt eller bruger teksturer, der mangler (projectM har dem i `presets-milkdrop-texture-pack`). De kan undersøges senere.
- `npm run presets:classics` åbner review-vinduet med 50 klassikere, Peter ikke har stemt om, efter hans smag. K kommer på behold-listen (og dermed "Peter's picks"), D på ban-listen og ud af pakken for alle ved næste `npm run presets:pack`.

## Sådan blev de valgt (01-10-2026)

1. **Konvertering:** `node scripts/convert-presets.js <cotc-mappe> <ud-mappe> --per-style=20 --workers=4`.
   - Der udtages højst 20 fra hver af de ca. 200 stilarter og højst 2 fra hver remix-familie.
   - "! Transition" (overgange til sort) springes over.
   - I alt 2.817 presets, hvoraf 2.765 kunne konverteres (11 min på 4 kerner).
2. **Reparation af shaderne** (`scripts/lib/repair-shader.js`, testet i `test/repair-shader.test.js`). Konverteren (milkdrop-preset-converter med hlslparser-js) har fejl, der gjorde 85 % af shaderne ubrugelige:
   - HLSL-plus blev til `&&` mellem `bvecN(...)`-konverteringer. Det bliver plus igen.
   - Presettets kode ligger i en funktion, der ikke kan se MilkDrops `rad`, `ang`, `uv_orig` og `hue_shader`. De gives med som parametre.
   - Egne teksturer mangler `uniform`, og Butterchurns egne bliver erklæret igen. Det rettes.

   I en stikprøve på 200 faldt andelen, der ikke kan linkes, fra 85 % til 25 %. Resten er blandede fejl.

   Ligningerne rettes også før konverteringen (`scripts/lib/repair-eel.js`, 05-10-2026): MilkDrop tillader et plus foran et udtryk (`sin(+atan2(...))`), som parseren afviser med "Parse error". Det fik bl.a. "Flexi - oldschool tree" (Peters "the fern") til at mangle; med rettelsen konverteres den og 3 andre Winamp-klassikere.
3. **Preset-test** (`--presettest`, `src/renderer/presettest.js`). Hvert preset tegnes ved 1280x720 med 1 s stilhed og 2 s syntetisk musik (120 BPM):
   - Der måles lysstyrke, farver, detaljer, bevægelse og tid pr. billede.
   - Der måles også, hvor tæt billedet følger kick-slagene (`beatSync`).
   - Resultaterne gemmes efter hver portion i en JSONL-fil, og en afbrudt kørsel fortsætter, hvor den slap.
4. **Udvælgelse** (`scripts/build-preset-pack.js`).
   - Sorteres fra: fejler, shaderen kan ikke linkes, sort, hvidt, står stille, over 10 ms pr. billede, eller navnet findes allerede.
   - Score: 40 % beatSync, 20 % bevægelse, 15 % farver, 15 % detaljer og 10 % behagelig lysstyrke, plus lidt, hvis billedet bevæger sig mere med musik end uden.
   - Hver stilart får pladser efter sin størrelse (mindst 2), og de bedste i stilarten vinder.
5. **Kontaktark** af de valgte, til at se på dem: `--presettest --manifest=<mappe>/chosen.json --sheets=<mappe>`.
6. **Blink** (01-10-2026, efter Peters klage over presets, der "bare blinker hvidt hele tiden").
   - Preset-testen måler nu `flicker`: andelen af billeder, hvor hele billedets lysstyrke springer mere end 0,06. Den måler også `whiteFrames` (næsten hvidt) og `lumaSpread`.
   - 86 af pakkens daværende 660 lå på 0,5 eller derover (Peters eksempler: 0,78 og 0,85). Ingen af de 395 indbyggede gjorde. Et slag på hvert kick i testmusikken giver kun ca. 0,07-0,13.
   - `build-preset-pack.js --flicker=<filer>` sorterer alt fra 0,5 og op fra.
7. **Review og Peters smag** (01-10-2026). `node scripts/start.js --review` åbner et eget vindue med kun de blinkere, der blev sorteret fra (`src/renderer/presets/review-pack.js`, genereres lokalt, ikke i git eller installationen). Med ← → bladrer man; **K** beholder (`scripts/preset-keeps.txt`), **D** bandlyser (`scripts/preset-bans.txt`).
   - Peter gennemgik 65: 14 beholdt, 51 bandlyst.
   - Hvad adskiller dem (AUC, 0,5 = intet, 1 = perfekt): takt 0,77, farver 0,67, blink 0,27 og bevægelse 0,28 (dvs. jo mindre, jo bedre). Lysstyrke, hvide billeder og detaljer betød intet. Takt minus blink adskilte bedst (0,80); en model med alle mål overfittede (0,69 med leave-one-out).
   - Reglen i `build-preset-pack.js`: en blinker (flicker 0,5 og op) kommer med, hvis takt minus blink er mindst -0,2 (`TASTE_MARGIN`). På Peters stemmer: 11 af 14 behold med, 10 af 51 ban med. Kort sagt: blink er fint, når det følger musikken.
   - Peters egne valg går altid forud: "behold" kommer altid med (uden om stilartens pladser og familiegrænsen), "ban" aldrig.
8. **Brugernes stemmer og personlige lister** (01-10-2026).
   - **K:** favorit (`favoritePresets`). Favoritterne vægtes først, når brugeren har mindst 20 (Peter 02-10-2026); før det er de almindelige presets. Derefter får de et tillæg på 0,8 i valget og må komme igen efter 40 skift i stedet for 150, og ved tilfældig rækkefølge går 20 % af skiftene til en favorit. Loftet er højst 4 favoritter pr. 20 skift (se `docs/music_engine.md`, "Hvilket preset"). K på en favorit gør ingenting; kun ★ i preset-listen (L) fjerner den igen (Peter 02-10-2026).
   - **D**, eller × i preset-listen (L): derez (`hiddenPresets`). Presettet skjules for brugeren selv.
   - **Preset-listen** (L) har på hver række ☆/★ (favorit, som K) og × (derez, som D); derezzede står overstreget med ↺ for at få dem tilbage. Mens listen er åben, skiftes der ikke automatisk.
   - Begge lister er personlige og ligger i brugerens egne indstillinger.
   - **"Use Peter's picks"** (Settings, `peterPicks`, slået fra som standard): Peters favoritter og derez lægges oven i brugerens egne (`presetLists` i `visualizer.js`). Brugerens egne K og D vinder altid. Fjerner brugeren en af Peters favoritter (★) eller henter et af hans derez tilbage (↺), huskes det i `peterPickExceptions`. Listen `src/renderer/presets/peter-picks.js` laves af `scripts/lib/peter-picks.js` ud fra ban- og behold-listerne og Peters stemmer i `data/preset-votes.jsonl`; `npm run release` laver den før hvert byg og committer den med versionen.
   - Første gang spørger appen, om stemmerne må sendes til Peter (`shareVotes`; kan ændres under Settings).
   - Ja: `src/main/votes.js` sender dem i portioner som issues i `the-grid-releases`. Der sendes presetnavn, stemme, version og et tilfældigt id.
   - At fortryde (☆ igen eller ↺) sendes som `clear`.
   - **Indtil videre er stemmerne kun data** (Peter 02-10-2026). Derez skjuler presettet for brugeren selv, men ingen andres stemmer kommer automatisk på ban- eller behold-listen. Når der er data nok, analyseres det, hvilke presets der er gode og dårlige.
   - `node scripts/collect-votes.js` henter stemmerne ind i `data/preset-votes.jsonl` (én pr. linje: preset, stemme, tidspunkt, bruger-id, version), lukker de læste issues og viser et overblik pr. person. `--all` viser hvert preset med Peters stemme og de andres. Commit `data/` bagefter.
   - `data/voters.json` giver kendte id'er et navn. Peters installerede app (`fd38a78a`) og hans stemmer fra kildekoden (`peter`) hedder "Peter".
   - Fra kildekoden (Peter selv) skriver K/D direkte i listerne og gemmes også i `data/preset-votes.jsonl`. Peters lister tælles med som hans stemmer.
9. **Fjernet af Peter:** navnene i `scripts/preset-bans.txt` kommer aldrig med. Listen ligger også i pakken, så `visualizer.js` fjerner de samme navne blandt de indbyggede presets.

## Kataloget (05-10-2026)

Alt, vi ved om hvert preset, samlet til at kategorisere dem og på sigt forudsige, hvad en bruger kan lide ud fra sine favoritter (Peter 05-10-2026). `npm run presets:catalog` (efter `presets:pack`) skriver `src/renderer/presets/preset-catalog.js`; appen bruger det ikke endnu.

For hvert preset: pakke, klassiker eller ej, forfattere (fra navnet), stilart, mærker og en vektor `f` med 21 træk som placering 0-1 (lysstyrke, bevægelse, takt, farver, detaljer, blink; figurer, teksturerede figurer, trekanter, bølger, spektrum, ekko, decay, zoom, rotation, warp- og comp-shader, bass/mid/treb og reaktivitet). De bandlyste er med (`banned: true`), så smagen kan læres af dem, men de indlæses ikke.

- **Stilart:** Cream of the Crops mappe (fx `Fractal/Trees`), også for indbyggede presets og klassikere, der findes under samme navn i hele samlingen (`presets-work/cotc-src`, 9.708 presets). For resten gættes den ud fra de 7 mest lignende (`styleGuess`). Gættet er svagt: 28 % rammer stilarten præcist (af ca. 150) og 47 % hovedgruppen (af 11), målt på dem, hvor stilarten kendes.
- **Mærker:** ordene i stilarten plus fx `dark`, `calm`, `energetic`, `on-the-beat`, `colourful`, `flashy`, `feedback-shapes` (fraktal-tricket med teksturerede figurer), `triangles`, `waveforms`, `bass-driven`.
- **Smag** (`src/shared/preset-similarity.js`): `similarity` er 1 minus den gennemsnitlige forskel pr. træk; `affinity` er ligheden med de 3 mest lignende favoritter minus det samme for de afviste.
- **Første måling på Peters stemmer** (76 behold, 83 ban, leave-one-out): favoritter mod ban AUC 0,81; favoritter mod alle andre 0,57 (de fleste andre har han ikke set). Hans favoritter følger takten mere (0,69 mod 0,48), blinker mere, har flere figurer og teksturerede figurer og reagerer mere på diskanten. Stemmerne er mest fra review af blinkere, så de er skæve; flere K/D i almindelig brug gør det bedre.
- **Næste trin** (ikke bygget): brug `affinity` som et lille tillæg i valget, når brugeren har nok favoritter, og vis "ligner" i preset-listen.

## Til hverdag

Arbejdsdataene ligger i `presets-work/` (ignoreres af git, ca. 40 MB):
- `converted/`: de 2.765 konverterede presets og deres manifest.
- `results.jsonl`: preset-testens målinger.
- `flash.jsonl`: blink-målingerne.
- `existing/` og `flash-existing.jsonl`: de indbyggede presets og deres målinger.

| Kommando | Hvad |
|---|---|
| `npm run presets:pack` | Bygger pakken (`src/renderer/presets/`) ud fra målingerne og Peters lister. Kør efter nye stemmer eller ændringer i ban- og behold-listerne, og udgiv bagefter. |
| `npm run presets:classics` | 50 Winamp-klassikere, Peter ikke har stemt om, i review-vinduet. |
| `npm run presets:review` | 50 nye kandidater efter Peters smag (`scripts/build-review-pack.js`) og åbner review-vinduet. `-- --flashers` viser i stedet de frasorterede blinkere. |
| `node scripts/collect-votes.js [--all]` | Brugernes stemmer fra GitHub ind i `data/preset-votes.jsonl` og et overblik. Ændrer ingen lister. |

## Fra bunden

Kun hvis `presets-work/` mangler, eller der skal flere presets med fra Cream of the Crop (der blev kun udtaget 20 pr. stilart):

```
git clone --depth 1 https://github.com/projectM-visualizer/presets-cream-of-the-crop.git <cotc>
node scripts/convert-presets.js <cotc> presets-work/converted --per-style=20 --workers=4
node scripts/start.js --presettest --dir=presets-work/converted --out=presets-work/results.jsonl
node scripts/start.js --presettest --dir=presets-work/converted --out=presets-work/flash.jsonl
git clone --depth 1 https://github.com/projectM-visualizer/presets-milkdrop-original.git presets-work/milkdrop-original-src
node scripts/convert-presets.js presets-work/milkdrop-original-src presets-work/classics --per-family=Infinity --workers=4
node scripts/start.js --presettest --dir=presets-work/classics --out=presets-work/classics-results.jsonl
npm run presets:pack
```

De indbyggede presets (`presets-work/existing`) eksporteres fra butterchurn-presets til samme format og måles med `--dir=presets-work/existing --out=presets-work/flash-existing.jsonl`. Preset-testen tager ca. 40 min for 2.765 presets. Den kan stoppes og startes igen.
