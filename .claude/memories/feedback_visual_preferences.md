---
name: feedback-visual-preferences
description: Peters ønsker til visualizeren - følg musikken som Winamp, sort uden musik, presetnavn kun ved pilene
metadata:
  type: feedback
---

Peter bad om følgende den 29-30/9-2026:

- **"Følg musikken rigtig godt og skift over tid, som det rigtige Winamp."** Det er løst med musikmotoren i `src/shared/music-engine.js`:
  - Skift på takten og ved nye dele af sangen, og hårde klip på drops.
  - Presets vælges efter bånd og energi.
- **"Når musikken ikke spiller, skal der ikke visualiseres."** Visualizer og mini-spektrum slukker ved stilhed. Svag baggrundslyd fra andre programmer tæller ikke som musik.
- **"Vis kun presettets navn, når jeg selv skifter med pilen."** Det gælder pileknapperne og piletasterne. Automatiske skift, mellemrum og de andre genveje må ikke vise navnet.
- **"I fuld skærm skal knapperne skjules."** (30-09-2026, endnu ikke bygget; arbejdspakke 2 i `docs/sharing_plan.md`.) Kun visualiseringen skal vises, uden værktøjslinje og uden musemarkør. Tastaturet skal stadig virke.

**Why:** eksplicitte ønsker fra brugeren om, hvordan appen skal føles.

**How to apply:** Genindfør ikke navnevisning ved automatiske skift, og lad ikke visualizeren køre uden musik. Relateret: [[project-music-engine-calibration]].
