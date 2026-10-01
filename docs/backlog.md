# Backlog

Ting, Peter vil have, men som ikke er bygget endnu. Ældst øverst. Flyt et punkt til den relevante dokumentation, når det er lavet.

## Mere tilfældighed i valget af preset (Peter 02-10-2026, til 03-10-2026)

**Ønske:** favoritterne må ikke tage over med tiden, og det samme gælder forudsigelsen af, hvad der passer til musikken (intensitet, bånd, takt). Der skal være en vis mængde tilfældighed i valget.

**Sådan virker det nu:**
- `pickSmart` i `src/renderer/visualizer.js` scorer alle presets, der ikke er vist for nylig, med `scorePreset` i `src/shared/music-engine.js`. Scoren består af intensitet, bånd, takt, overgang og 0,6 tilfældighed.
- Valget trækkes blandt de 12 bedste, vægtet efter score (`PICK_TOP`, `PICK_TEMPERATURE` 0,25).
- Favoritter får et tillæg på 0,8 (`FAVORITE_BONUS`) og må komme igen efter 20 skift i stedet for 150 (`FAVORITE_EXCLUDE`).
- Ved tilfældig rækkefølge går op til 30 % af skiftene til en favorit, fuldt fra 20 favoritter (`FAVORITE_SHARE`, `FAVORITE_FULL_AT`).
- Ulempen: med mange favoritter og et smalt "musikalsk" udvalg ender de samme presets med at dominere, og resten af de ca. 1.050 ses sjældent.

**Idéer til løsningen:**
- **Fast andel helt tilfældige skift**, fx 20-25 %. Et preset trækkes blandt alle, der ikke er vist for nylig, uden score. Det sikrer, at hele samlingen bliver set.
- **Loft over favoritterne:** fx højst hvert 4.-5. skift en favorit, uanset hvor mange der er. Tillægget kan også aftage, jo oftere favoritten er vist den seneste time.
- **Blødere musikvalg:** højere `PICK_TEMPERATURE` eller flere kandidater (`PICK_TOP`), så "næstbedst" oftere vinder. Alternativt kan tilfældighedens vægt i `scorePreset` hæves fra 0,6.
- **Mål det:** genbrug simuleringen fra 01-10-2026, der tæller forskellige presets pr. 200 skift og deres gennemsnitlige intensitet (se `docs/music_engine.md`, "Hvilket preset"). Simuler også med fx 20 og 50 favoritter. Målet er, at intensiteten stadig følger musikken, mens antallet af forskellige presets stiger, og favoritterne højst får ca. en fjerdedel af skiftene.
- Gør gerne andelene til indstillinger: "Variation" under Settings.

**Delvist løst 02-10-2026 (v0.1.15):** favoritterne vægtes nu slet ikke, før der er mindst 20 (Peters ønske), og ventetiden for en vægtet favorit er 40 skift. Resten herunder gælder stadig, når der er 20 eller flere.

**Fundet 02-10-2026 (Peter: "mine favoritter kommer meget"):** reglen om, at favoritternes andel først er fuld ved 20 favoritter (`FAVORITE_FULL_AT`), gælder kun ved tilfældig rækkefølge (`randomName`). Det musikstyrede valg (`pickSmart`, standard) giver altid 0,8 i tillæg (`FAVORITE_BONUS`). Med temperaturen 0,25 vinder en favorit så næsten altid, når den er fri efter 20 skift. Hver favorit ses derfor ca. hvert 21. skift, og med 5 favoritter er det ca. en fjerdedel af alle skift.
- Lad tillægget skalere med listens størrelse som `FAVORITE_SHARE`: `FAVORITE_BONUS * min(1, antal / FAVORITE_FULL_AT)`.
- Lad hellere favoritterne vente længere end 20 skift, fx 60, eller lad ventetiden vokse med antallet af favoritter.
- Sæt et samlet loft (se ovenfor), så favoritterne aldrig får mere end ca. hvert 4.-5. skift.

**Tests:** udvid `test/favorites.test.js` med et loft over favoritternes andel, med at tilfældige skift forekommer, og med at få favoritter (fx 3) ikke får mere end deres rimelige del i `pickSmart`.
