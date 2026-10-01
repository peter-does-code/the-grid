# Musikmotoren

Sådan følger The Grid musikken. Motoren ligger i `src/shared/music-engine.js`, og lydkæden i `src/renderer/music.js`.

Butterchurn måler selv bas, mellemtone og diskant i forhold til de sidste par sekunder, som MilkDrop gør. Det får presets til at reagere på lyden. Musikmotoren tilføjer det, MilkDrop i Winamp gjorde ud over det: den bestemmer, *hvornår* der skiftes preset, og *hvilket* preset der passer til musikken lige nu.

## Lydkæden

```
Spotify-lyd (loopback) → forsinkelse ─┬→ rå analyse → musikmotoren
                                      └→ automatisk lydniveau → begrænser → Butterchurn og mini-spektrum
```

- **Forsinkelse (0-500 ms):** synkroniserer billedet med lyden, fx med Bluetooth-hovedtelefoner. Den gælder også motorens analyse.
- **Automatisk lydniveau:** giver Butterchurn samme signalstyrke, uanset hvor højt Spotify spiller. Forstærkningen ligger mellem 0,5 og 12 gange. Den justeres kun, mens der er musik, så svag baggrundslyd ikke pustes op.
- **Begrænser:** forhindrer klipning.
- Motoren analyserer den **rå** lyd, så sangens dynamik bevares.

## Hvad motoren hører

Hvert billede (60 pr. sekund) analyseres et spektrum med 2048 punkter.

| Mål | Bruges til |
|---|---|
| Spektral flux (hvor meget nyt der kom til) plus stigning i kick-båndet 40-130 Hz | Slag og tempo |
| Bas 20-320 Hz, mellemtone 320-2800 Hz, diskant 2800-11025 Hz (samme bånd som MilkDrop) | Sangens klang og dens dele |
| Lydstyrke (RMS) | Dele, drops og stilhed |

## Tempo og slag

- Onset-kurven samples ved 100 Hz i et 10-sekunders vindue. Et tempo mellem 60 og 190 BPM findes med autokorrelation.
- En kandidat vinder, hvis dens periode gentager sig efter 1, 2 og 4 slag (en takt). En blød forventning om ca. 120 BPM trækker også med. Det gør dobbelt tempo, halvt tempo og triol-pulser sjældnere.
- **Klæbrigt tempo:** er det nuværende tempo stadig mindst 80 % så stærkt som den bedste kandidat, bevares det. Et nyt tempo skal holde i 3 sekunder, før der skiftes.
- **Tempo-oktav:** over 150 BPM er vinderen typisk hi-hatten. Er det halve tempo mindst 35 % så stærkt, vælges det.
- **Halvtid:** under 75 BPM vælges det dobbelte tempo, hvis det er mindst 75 % så stærkt. Et skift på en hel oktav (fx 130 → 65, når trommerne spiller halvtid i en del) væk fra oktaven nærmest 120 BPM kræver, at det nuværende tempo er næsten forsvundet (under 35 %) i 6 s; den anden vej går hurtigt. Sangens tempo tæller halvtid som heltid.
- **3:2-kandidater** (fx 62 og 93 BPM, typisk en synkoperet baslinje eller trioler): er de næsten lige stærke (85 %), vinder den nærmest ca. 120 BPM. Har motoren allerede det tempo, der ligger nærmest, skal en 3:2-kandidat være klart stærkere og holde i 6 s; ellers vinder kandidaten allerede efter 1,5 s.
- **Sangens tempo:** kandidaternes styrke lægges sammen hen over sangen og glemmes langsomt (90 s). Hi-hattens dobbelte tempo over 150 BPM tæller for det halve. Efter 15 s musik er sangens tempo det "typiske" i stedet for de faste 120 BPM (også i 3:2-reglen). Er sangens tempo mindst 80 % så stærkt som den bedste kandidat, vælges det. Tilbage til sangens tempo går på 1,5 s, væk fra det kræver 6 s. Det holder et langsomt shuffle-nummer på 90 BPM, hvor triolpulsen (120) og 3:2-pulsen (135) ellers vinder i de rolige passager.
- **Nyt tempo i en ny del:** i 8 s efter en ny del eller et drop må et nyt tempo tage over efter to målinger (1 s), hvis det gamle er faldet under 60 % af det nye, det nye står klart (ingen ubeslægtet kandidat over 75 %), og det ikke er et simpelt forhold af det gamle (2:1 ±7 %, 3:2 og 4:3 ±4 %: halvtid og trioler er ikke et nyt tempo). Sangens tempo-hukommelse svækkes så, så den ikke trækker tilbage. Et syntetisk skift fra 90 til 128 BPM følges på 6,6 s mod 12 s før (delen opdages 2,8 s efter skiftet). Prisen: ét kort udsving mere i Febersvan (151 BPM i 5 s).
- **Hurtig lås:** et meget tydeligt slag (sikkerhed ≥ 3,2) låses efter én måling i stedet for to.
- **Slag meldes 40 ms før tid** (`beatLead`). Slagene er forudsagt, og lydfangsten og tegningen gør ellers, at billedet kommer lidt efter lyden, man hører. Hændelsens tidspunkt er stadig det forudsagte slag.
- Fasen findes som det tidspunkt, der rammer flest onsets over mindst 4 s og mindst 8 slag. En faselåst sløjfe retter små fejl blidt og springer kun, når tre målinger i træk er enige om den nye fase. Et spring på en tredjedel af et slag (triolens sidste node i et shuffle) kræver seks.
- **Taktens første slag** er det af de fire slag, hvor kick-båndet oftest er kraftigst.

## Dele af sangen

Hvert kvarte sekund gemmes et øjebliksbillede af lydstyrke, fordeling mellem bånd og antal onsets.

- **Ny del:** de seneste 4 sekunder sammenlignes med den foregående del, op til 12 sekunder tilbage. Forskellen skal holde i hele vinduet. Der skal gå mindst 12 sekunder mellem to nye dele.
- **Drop:** lydstyrken over cirka et slag stiger mere end 8 dB over medianen af de foregående 1-6 sekunder, og mindst 4 dB over niveauet de sidste 1,5 s, så et crescendo ikke tæller. Det opdages samme billede som det første kraftige slag. Uden en opbygning skal droppet i sangens første 20 s være 3 dB større (en rolig intro, hvor instrumenterne kommer ind ét ad gangen), og det skal lande højst 2 dB under sangens normale niveau (det kraftigste 4-sekunders-niveau indtil nu, der glemmes med 3 dB i minuttet), så musikken, der vender tilbage efter en stille passage, ikke tæller.
- **Opbygning** (build-up før et drop): en ret linje gennem lydstyrken de seneste 6 s stiger mindst 0,9 dB/s med forklaringsgrad R² ≥ 0,8 og stiger i begge halvdele af vinduet (et trin fra vers til omkvæd gør det ikke). Eller slagene bliver jævnt tættere (en trommehvirvel, målt på slag det seneste sekund), mens niveauet ikke falder. Aldrig i sangens første 10 s eller 8 s efter et drop. Den slutter, når stigningen har stået stille i 1,5 s, efter højst 24 s, eller med droppet.
- **Drop efter en opbygning:** rampen løfter niveauet op til droppet, så springet måles mod det højeste niveau de sidste 1,5 s og skal kun være 4,5 dB, eller 1,5 dB hvis bassens andel samtidig stiger mindst 15 procentpoint (bassen er ofte filtreret væk i opbygningen og kommer tilbage på droppet).
- **Stilhed:** tærsklen afhænger af, hvad Spotify melder.

| Spotify | Stille under | Slukker efter |
|---|---|---|
| Spiller på denne pc | -70 dB (kun digital stilhed) | 2 s |
| Pause eller afspilning et andet sted | -42 dB | 0,5 s |
| Ukendt | -48 dB | 2 s |

På Peters pc giver andre programmer svag baggrundslyd på -55 til -63 dB. Den må ikke vække billedet.

## Instruktøren: hvornår der skiftes

| Årsag | Hvordan | Krav |
|---|---|---|
| Drop | Hårdt klip med det samme | Mindst 0,5 s siden sidste hårde klip (et skift i opbygningen lige før spærrer ikke) |
| Opbygning | Efter 2 takter et skift hver takt, fra takt 4 hver halve takt, med korte overgange (et halvt slag) | Kræver fundet tempo, takt-synkronisering og hårde klip slået til |
| Stort slag i en intens del | Hårdt klip, som MilkDrops "hard cuts" | Højst hvert 25. s, med tilfældighed |
| Nyt nummer i Spotify | Blødt skift på næste taktstart | Mindst 2 s siden sidste skift |
| Ny del af sangen | Blødt skift på næste taktstart | Mindst 8 s siden sidste skift |
| Tiden er gået | Blødt skift på næste taktstart | Indstillet tid ±15 %, mindst 6 s |

- Bløde skift varer altid hele takter (højst 8 s), så de både begynder og slutter på en taktstart. Det tal af takter vælges, der kommer tættest på den indstillede overgangstid.
- Uden fundet tempo skiftes der med det samme.
- Mens der er stille, står tælleren stille, og der skiftes ikke.

## Hvilket preset

Hvert preset har to slags profil:

- **Fra koden** (`profilePreset`): hvor ofte ligningerne og shaderne bruger `bass`, `mid` og `treb`. Det giver en fordeling over båndene og en gættet reaktivitet.
- **Målt** (`src/renderer/presets/preset-stats.js`, fra preset-testen, se `docs/presets.md`): lysstyrke, bevægelse, takt, farver og detaljer. Hvert mål er gemt som placering blandt alle 1.016 presets (0-1).
  - **Intensiteten** er 50 % bevægelse, 30 % takt og 20 % lysstyrke (`presetIntensity`).

Ved et automatisk skift scores presets ud fra hvorfor der skiftes og hvad der vises nu (`selectionContext(reason, current)` og `scorePreset`):

- **Intensitet:** sangens energi giver en ønsket intensitet: 0,25 i rolige dele, 0,55 normalt og 0,8 i høje dele. Under en opbygning er den 0,88 og på et drop 0,95. Vægten er 1,6 for at ramme den.
- **Bånd:** fordelingen skal passe til de bånd, der fylder mere end normalt lige nu (vægt 1,0).
- **Takt:** med et tempo får presets, der følger slaget, op til 0,5 ekstra.
- **Overgang:** et blødt skift går helst til en lignende lysstyrke (op til 0,6), så skiftet ikke blænder eller mørklægger. Et drop belønner kontrast i intensitet (op til 0,8).
- **Tilfældighed:** 0,6.

Valget trækkes blandt de 12 bedste, vægtet efter score, og de sidste 150 viste kommer ikke igen foreløbig. Med kun det bedste og 25 udelukkede kom de samme ca. 60 favoritter igen og igen: 57-81 forskellige pr. 200 skift, simuleret. Nu er det 169-179 forskellige, og intensiteten rammer stadig målet (0,32 roligt, 0,55 normalt, 0,77 højt). Presets uden målinger bruger den gamle score med reaktivitet.

Det sker kun ved tilfældig rækkefølge med "Vælg presets, der reagerer på den del af musikken, der fylder mest" slået til.

## Overgange

`installTransitions` i `visualizer.js` styrer Butterchurns overgang uden at ændre dens filer:

- **Mønster:** Butterchurns tre "mixType" er 1 (en kant fejer hen over billedet), 2 (plasma, en organisk opløsning) og 3 (en cirkel, der åbner sig fra midten). Butterchurn trækker mønsteret tilfældigt. Nu vælger `transitionFor` i `app.js`:
  - en opbygning fejer;
  - en rolig del opløses som plasma;
  - en ny høj del (omkvædet) åbner sig fra midten;
  - ellers enten fejning eller plasma.
- **Forløb i ryk på slagene:** med tempo går overgangen frem i ryk. Hvert slag skubber den 1/n frem i løbet af slagets første 35 % (en blød kurve), og imellem står den stille.
  - Overgangen varer hele takter, så ryk og slag passer.
  - Et manuelt skift med pilene glider jævnt som før.
- **Drop:** det hårde klip får et lysglimt på ca. 0,18 s (`flashCut`), så klippet ser villet ud.

## Målte resultater

`npm run musictest` bruger en syntetisk sang på 48 sekunder ved 128 BPM med vers, omkvæd, breakdown og drop:

| Mål | Resultat |
|---|---|
| Tempo | 127,9 BPM, fundet efter 5 s |
| Slag inden for 40 ms | 100 % af 66 |
| Median afvigelse | 2 ms |
| Omkvæd opdaget | Én gang, ingen falske dele |
| Drop opdaget | 10 ms efter første kraftige slag, hårdt klip |
| Skift på taktstart | Alle bløde skift |
| CPU pr. billede | 0,2 ms |

`npm run musictest -- --file=...` gav dette på en 73 sekunders jam fra Peters Downloads-mappe:

- Hele filens tempo er tvetydigt, med kandidater ved 59, 117 og 80 BPM.
- Motoren holdt 80 BPM stabilt i 29 sekunder.
- 78 % af slagene landede regelmæssigt.
- Alle bløde skift kom på taktstart.

### Benchmark (`node scripts/bench-music.js`, 30-09-2026)

Kører musiktesten på Init, fire af Peters egne optagelser i Downloads og den syntetiske sang. "Rigtigt" kræver et kendt tempo (Init: 92,95 BPM fra beat-kortet).

| Fil | Før | Efter |
|---|---|---|
| Syntetisk: tempo låst | 5 s | 4 s |
| Init: rigtigt tempo låst | 18 s, via en forkert 62 BPM | 16 s, direkte fra det dobbelte tempo |
| Init: jævne slag | 92,5 % | 94,2 % |
| Peter jam #1: jævne slag | 78,1 % | 83,3 % |
| slappa da bass: jævne slag | 81,1 % | 82,1 % |
| Falske opbygninger i de fem filer | – | 0 |

Anden runde, samme dag, med "The Gospel of John Hurt" (langsomt shuffle, 90 BPM, stille passager; ligger i projektmappen):

| Fil | Før | Efter |
|---|---|---|
| John Hurt: rigtigt tempo (90 BPM) | 52 % (120 i intro og ved 140-170 s, 135 ved 205-290 s) | 95 % (fra 20 s) |
| John Hurt: jævne slag | 92,4 % | 94,6 % |
| John Hurt: falske drops (hårde klip) | 3 (6, 17 og 295 s) | 0 |
| Init: rigtigt tempo / jævne slag | ikke målt / 94,2 % | 85 % / 95,6 % |
| Peter jam #1: jævne slag | 83,3 % | 91,0 % |

Tredje runde, samme dag, med "Everything In Its Right Place" (Radiohead, 124 BPM i 10/4) og "Febersvan" (ca. 130 BPM, dele i halvtid):

| Fil | Før | Efter |
|---|---|---|
| Everything In Its Right Place: rigtigt tempo / jævne slag | 99 % / 99,6 % | uændret |
| Febersvan: tempoet | skiftede mellem 64, 85 og 130 BPM (hele dele ved 64) | 127-136 BPM hele vejen, ét kort udsving til 85 |
| Febersvan: jævne slag | 93,5 % | 95,3 % |

Musiktesten har også en anden syntetisk sang med en opbygning som i dansemusik (16 s trommehvirvel og støj-riser, så drop). Opbygningen findes efter 7 s, skiftene kommer hver takt og så hver halve takt, og det hårde klip rammer droppet 55 ms efter det første slag.

## Kendte begrænsninger

- Meget tvetydige rytmer som shuffle, 12/8 og fri takt kan give et tempo, der er 3:2 eller 2:1 fra det, man selv føler, indtil sangens tempo er lært (ca. 15-20 s). En rolig intro kan derfor have forkert tempo. Slagene er stadig regelmæssige.
- Takten antages at være 4 slag. En taktart-genkendelse (autokorrelation af slagenes styrke over 3-12 slag, `meterDetect`) er bygget, men slået fra: den fandt Radioheads 10/4 for sent og gav falske 3 og 5 i Init og Febersvan. Resten af motoren (taktstart, overgange på hele takter, opbygningens skift) følger `beatsPerBar`, når den slås til.
- Stilhed måles på Windows' standard-lydenhed. The Grid følger med, når standardenheden skifter. Er Spotify selv sat til en anden højttaler end standarden, er billedet sort.
- Spotifys egne analysedata (takt, dele) kan ikke bruges, fordi de er lukket for nye udvikler-apps siden 2024.
