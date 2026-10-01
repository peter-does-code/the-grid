# Opsætning af Spotify

Visualizeren virker uden Spotify-opsætning. Den reagerer på al lyd fra pc'en. Opsætningen herunder skal kun bruges til at hente playlister ind i The Grid og styre afspilningen derfra.

## Krav

- **Spotify Premium.** Siden februar 2026 skal ejeren af en Spotify-udvikler-app have Premium, ellers virker appen ikke. Premium kræves også for at styre afspilningen via API'et.
- **Spotify-appen installeret på pc'en.** Musikken spiller dér, og The Grid styrer den.

## Den indbyggede app

The Grid har Peters Spotify-udvikler-app bygget ind (`BUILT_IN_CLIENT_ID` i `src/main/store.js`). Den er registreret med Redirect URI `http://127.0.0.1:43117/callback` og Web API. Peter er ejer og har Premium, og han tilføjer brugere under **User Management** på dashboardet (højst 5). Brugerne skal selv have Premium for at styre afspilningen.

Med den indbyggede app skal brugeren kun trykke **Log ind med Spotify** (eller følge guiden ved første start). Får brugeren beskeden "Access denied: your program isn't registered on this Grid", mangler brugerens Spotify-e-mail under User Management.

## Egen udvikler-app (valgfrit)

Under **Indstillinger → Brug din egen Spotify-udvikler-app** kan en anden udvikler-app bruges. Trin for trin:

1. Gå til https://developer.spotify.com/dashboard og log ind med din Spotify-konto.
2. Tryk **Create app** og udfyld:
   - **App name:** fx `The Grid`.
   - **App description:** fx `Lokal visualizer`.
   - **Redirect URI:** præcis `http://127.0.0.1:43117/callback`. Skriv `127.0.0.1`, ikke `localhost`, da Spotify ikke tillader `localhost`.
   - Sæt flueben ved **Web API**, acceptér vilkårene og tryk **Save**.
3. Åbn appen, gå til **Settings** og kopiér **Client ID**. Du skal ikke bruge "Client secret", fordi The Grid bruger PKCE-login.
4. I The Grid: åbn **Indstillinger → Brug din egen Spotify-udvikler-app**, indsæt Client ID og tryk **Gem**. The Grid spørger Spotify, om ID'et findes, før det gemmes; det fanger også et Client Secret, der er sat ind ved en fejl. **Brug den indbyggede app** skifter tilbage.
5. Tryk **Log ind med Spotify**. Browseren åbner. Godkend adgangen, og gå tilbage til The Grid.
6. Kopiér et link til en playliste i Spotify: højreklik på den, vælg **Del** og **Kopiér link til playliste**. Indsæt linket i The Grid og tryk **Hent**.

Får du en fejl om, at brugeren ikke er registreret, så tilføj din egen konto under **User Management** i appen på dashboardet. En udvikler-app må have højst 5 brugere.

## Hvad Spotify tillader (2026)

| Hvad | Virker det? |
|---|---|
| Dine egne playlister og playlister, du samarbejder om | Ja, med hele nummerlisten |
| Andre brugeres playlister | Kun navn og billede. The Grid kan afspille dem og viser de næste numre fra Spotifys kø. |
| Spotifys egne playlister (Discover Weekly, Daily Mix, Today's Top Hits osv.) | Nej. Udvikler-apps kan ikke hente dem. |
| Albums og enkelte numre | Ja |
| Afspil, pause, næste, forrige, spol og lydstyrke | Ja, med Premium og en åben Spotify-app |

Du kan kopiere en playliste, du ikke ejer, til en af dine egne. Åbn den i Spotify, markér alle numre med `Ctrl+A`, højreklik, og vælg **Tilføj til playliste** og **Ny playliste**. Brug derefter linket til den nye playliste.

Reglerne kommer fra Spotifys ændringer 27-11-2024 og 11-02-2026 samt changeloggen for juli 2026. Links står nederst.

## Fejlfinding

| Besked eller symptom | Løsning |
|---|---|
| "Spotify kender ikke dette Client ID" | Kopiér Client ID igen fra dashboardet. Det er 32 tegn. |
| Spotify siger "INVALID_CLIENT: Invalid redirect URI" i browseren | Redirect URI på dashboardet skal være præcis `http://127.0.0.1:43117/callback`. |
| "Port 43117 bruges af et andet program" | Luk det andet program, eller genstart pc'en. |
| "Ingen aktiv Spotify-afspiller" | Åbn Spotify-appen. The Grid prøver selv at starte den og venter op til 10 sekunder. |
| "Styring af afspilning kræver Spotify Premium" | Knapperne i The Grid sendes i stedet som medietaster til Windows, og numre åbnes i Spotify-appen. |
| "Spotify-kvoten for din udvikler-konto er brugt op" | Vent lidt. Kvoten deles af alle dine udvikler-apps. |
| Musikken starter ikke, når du trykker afspil | The Grid tjekker selv, at musikken starter, og åbner ellers nummeret direkte i Spotify-appen. Hjælper det ikke, så kør `npm run diagnose` i projektmappen og se, hvilken afspiller Spotify bruger. |
| Visualizeren reagerer ikke på musikken | Spotify skal spille på Windows' standard-lydenhed. The Grid følger selv med, når du skifter standard-højttaler, og viser enheden under Indstillinger. Hjælper det ikke, så vælg **Genstart lydfangst**. |

## Hvad gemmes hvor

Alt gemmes i `%APPDATA%\The Grid` og intet i projektmappen:

- `settings.json`: eget Client ID (tomt betyder den indbyggede app), sidst hentede link, sprog, tema, intro, om guiden er gennemført, visualizer-indstillinger og vinduets placering.
- `spotify-tokens.bin`: login-tokens, krypteret med Windows DPAPI via Electrons `safeStorage`. Filen slettes, når du logger ud.

Lyden fra pc'en analyseres kun i hukommelsen, mens den spiller. Intet optages, gemmes eller sendes nogen steder hen.

## Kilder

- https://developer.spotify.com/blog/2024-11-27-changes-to-the-web-api
- https://developer.spotify.com/documentation/web-api/tutorials/february-2026-migration-guide
- https://developer.spotify.com/documentation/web-api/references/changes/july-2026
- https://developer.spotify.com/documentation/web-api/concepts/redirect_uri
- https://developer.spotify.com/documentation/web-api/reference/start-a-users-playback
