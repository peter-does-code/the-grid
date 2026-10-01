---
name: feedback-electron-gotchas
description: Miljø-faldgruber ved at køre Electron 44 fra Claude Code/VS Code på Peters pc
metadata:
  type: feedback
---

- **`ELECTRON_RUN_AS_NODE=1` er sat i Claude Code/VS Code-miljøet.** Så starter `electron.exe` som ren Node, og `require('electron').app` er `undefined`. Start altid via `node scripts/start.js` (`npm start` eller `npm run selftest`), som sletter variablen.
- **Electron 44 har ingen postinstall.** Binæren hentes ved første `require('electron')`, eller når man selv kører `node node_modules/electron/install.js`.
- **npm 11 blokerer ukendte install-scripts** via `allowScripts` i `package.json`.
- **Bash-heredocs og `node -e` fra Git Bash kan spise backslashes** og fejle på citationstegn. Skriv filer med regex, citationstegn eller Windows-stier med Write-værktøjet.

**Why:** alle fire kostede tid ved første build den 29-09-2026.

**How to apply:** Brug start-scriptet til alle Electron-kørsler, og verificér ændringer med `npm run selftest`. Skærmbillederne ligger i output-mappen og kan læses direkte. Relateret: [[project-architecture-decisions]].
