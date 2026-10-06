# Backlog

Ting, Peter vil have, men som ikke er bygget endnu, og løse ender. Ældst øverst. Flyt et punkt til den relevante dokumentation, når det er lavet.

## Bregnen, Peter kan lide mest (05-10-2026)

Ligner `Flexi - oldschool tree` næsten helt, men "bladene udvider sig med musikken". Ikke fundet; se `docs/presets.md`, "Find et bestemt preset", for hvad der er set. Idéer: sammenlign oldschool tree med de 30 `shader circus`-numre (Flexis tutorial bygget på den) og find den, der ændrer figurernes størrelse (`rad`, `tex_zoom`) efter lyden; søg i hele Internet Archive (ikke kun Flexi) efter de samme ligningslinjer; måske er det oldschool tree selv ved 60 fps/100 % reaktion.

## Sanghukommelsen

- Tempoet kan være det dobbelte (The Apparition og King Crimson 138 BPM). Brug flere afspilninger, eller lad sangens tempo i hukommelsen dømme mellem oktaver.
- Motoren finder falske drops (6 i Radioheads "Exit Music"). Mærket kræver nu to gange; selve drop-fyringen bruger stadig fund fra én afspilning (`knownEvents`).
- Spotify giver tomme genrer. Overvej en anden kilde eller mærker fra lyden alene.
- Næste trin: planlæg presets for hele sangen (roligt til intro, det stærkeste til det største drop), brug mærkerne i valget, og genkend sange uden Spotify (lydfingeraftryk).

## Valget af preset

- Brug preset-katalogets lighed (`affinity` i `src/shared/preset-similarity.js`) som et lille tillæg, når brugeren har nok favoritter, og vis "ligner" i preset-listen. Måling: favoritter mod ban AUC 0,81.
- Classic Winamp mode bør måske altid køre 100 % reaktion og 30 fps (originalen).

## Shader-oversættelsen

- 212 af de 1.682 frasorterede kan stadig ikke linkes (fejlene er spredt: `syntax error`, `undeclared identifier`, `too many arguments`, sampler-tilstande som `AddressV`). Fejlteksten står i `linkLog` i `presets-work/rescue5-results.jsonl`.
- Kør oversætteren på resten af Cream of the Crop (kun 2.765 af 9.708 er konverteret) og på Flexi-presets fra Internet Archive.
- De reddede er ikke set ét for ét; Peter D'er dem, der ser forkerte ud.

## Musikmotoren

- Test på sange, der aldrig er brugt til at stille den (`test/audio/holdout/`): John Hurt, Febersvan, Radiohead og Init er alle brugt.
