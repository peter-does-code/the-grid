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

## Køre det igen

```
git clone --depth 1 https://github.com/projectM-visualizer/presets-cream-of-the-crop.git <cotc>
node scripts/convert-presets.js <cotc> <conv> --per-style=20 --workers=4
node scripts/start.js --presettest --dir=<conv> --out=<conv>/results.jsonl
node scripts/build-preset-pack.js <conv> <conv>/results.jsonl --total=1000
```

Preset-testen tager ca. 40 min for 2.765 presets. Den kan stoppes og startes igen.
