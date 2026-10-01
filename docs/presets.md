# Presets

The Grid har to slags MilkDrop-presets:

- **butterchurn-presets** (npm, 395 stk.), som Butterchurns forfatter har konverteret.
- **De bedste fra "Cream of the Crop"** i `src/renderer/presets/cream-of-the-crop.js`. Listen over de valgte og deres mål står i `cream-of-the-crop.txt` ved siden af.

## Cream of the Crop

- **Kilde:** https://github.com/projectM-visualizer/presets-cream-of-the-crop.
- **Indhold:** ca. 9.800 MilkDrop-presets, udvalgt og sorteret i stilarter (fx Reaction/Liquid Ripples) af Jason Fletcher (ISOSCELES). Pakken er standard i projectM siden 2022.
- **Licens:** MilkDrop-presets er næsten aldrig frigivet under en bestemt licens. Forfatterne har frigivet dem frit, og projectM regner dem for public domain. Ønsker en forfatter sit preset fjernet, fjerner projectM det. Forfatterne står i presetnavnene, og dem beholder vi.

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
   - **K:** favorit (`favoritePresets`). Den får et tillæg på 0,8 i valget og må komme igen efter 20 skift i stedet for 150. Ved tilfældig rækkefølge går op til 30 % af skiftene til en favorit, når der er 20 favoritter (1,5 % pr. favorit). K igen fjerner den.
   - **D**, eller × i preset-listen (L): derez (`hiddenPresets`). Presettet skjules for brugeren selv.
   - **Preset-listen** viser favoritter med ★ og derezzede overstreget med ↺ for at få dem tilbage. Mens listen er åben, skiftes der ikke automatisk.
   - Begge lister er personlige og ligger i brugerens egne indstillinger.
   - Første gang spørger appen, om stemmerne må sendes til Peter (`shareVotes`; kan ændres under Settings).
   - Ja: `src/main/votes.js` sender dem i portioner som issues i `the-grid-releases`. Der sendes presetnavn, stemme, version og et tilfældigt id.
   - `node scripts/collect-votes.js` viser dem. Med `--apply` kommer flest derez på ban-listen og flest kan-lide på behold-listen (Peters egne valg går forud), og issues lukkes.
   - Fra kildekoden (Peter selv) skriver K/D direkte i listerne.
9. **Fjernet af Peter:** navnene i `scripts/preset-bans.txt` kommer aldrig med. Listen ligger også i pakken, så `visualizer.js` fjerner de samme navne blandt de indbyggede presets.

## Køre det igen

```
git clone --depth 1 https://github.com/projectM-visualizer/presets-cream-of-the-crop.git <cotc>
node scripts/convert-presets.js <cotc> <conv> --per-style=20 --workers=4
node scripts/start.js --presettest --dir=<conv> --out=<conv>/results.jsonl
node scripts/start.js --presettest --dir=<conv> --manifest=<conv>/chosen.json --out=<conv>/flash.jsonl
node scripts/build-preset-pack.js <conv> <conv>/results.jsonl --total=1000 --flicker=<conv>/flash.jsonl
```

Preset-testen tager ca. 40 min for 2.765 presets. Den kan stoppes og startes igen.
