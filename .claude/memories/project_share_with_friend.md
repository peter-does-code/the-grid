---
name: project-share-with-friend
description: The Grid deles med Drew og to venner via en installationsfil, der opdaterer sig selv fra et privat GitHub-repo (02-10-2026)
metadata:
  type: project
---

Peter deler The Grid med vennen Drew (engelsk, "drewbraham", "Drewtopia") og to venner mere (01-10-2026). Status i `docs/sharing_plan.md`, udgivelser i `docs/releasing.md`.

- **Én udgave for alle**, altid på engelsk (se [[feedback-always-english]]), med Tron-præg og påskeæg (se [[feedback-tron-easter-eggs]]).
- **Spotify:** alle bruger Peters udvikler-app (Client ID bygget ind). Peter tilføjer deres Spotify-e-mails under User Management (højst 5 brugere). Vejledningen beder dem sende e-mailen først og nævner egen udvikler-app som alternativ.
- **Levering og opdateringer:** NSIS-installationsfil fra `npm run release` til det private repo `peter-does-code/the-grid-releases`. Appen tjekker ved start og hver 4. time og installerer straks.
  - v0.1.1 til v0.1.10 kunne ikke opdatere sig selv (semver manglede i bygget). Alle skulle have v0.1.11 i hånden én gang (02-10-2026).
- **Stemmer:** K (favorit) og D (derez) er personlige lister. Med samtykke sendes de også som issues til releases-repoet. Det kræver, at tokenen har "Issues: Read and write".

**Why:** Peter vil kunne sende forbedringer ud uden at sende filer, og vil vide, hvad vennerne kan lide.

**How to apply:** Udgiv med `npm run release` fra en ren arbejdsmappe. Brugerrettede tekster skal virke for alle venner, ikke kun Drew. Relateret: [[reference-spotify-2026-rules]].
