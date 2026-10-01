# The Grid: getting started

Greetings, program. The Grid is a music visualizer in the spirit of Winamp and MilkDrop, with a Tron look. It listens to the music that plays on your PC and turns it into visuals that follow the beat and change when the song moves into a new part. It can also load your Spotify playlists and control playback.

## What you need

- Windows 10 or 11 (64-bit).
- The Spotify desktop app, logged in with your Premium account.
- Peter must have added your Spotify email to his Spotify developer app. He has already done this. If you ever see "Access denied: your program isn't registered on this Grid", ask him to check it.

## Install

1. Double-click the installer (`The-Grid-Setup-0.1.1.exe` or newer).
2. Windows will probably say **"Windows protected your PC"**. That happens because the file isn't signed with a paid certificate, not because anything is wrong. Click **More info**, then **Run anyway**.
3. That's it. There are no questions to answer: The Grid installs itself in a few seconds and starts right away. You'll find it on the desktop and in the Start menu.

Your browser may also warn about the download, because the file is new and not downloaded often. Choose **Keep** (in Chrome: the three dots next to the download, then **Keep**; in Edge: **Keep** → **Keep anyway**).

You only install once. After that The Grid updates itself: it checks for a new version when it starts and every few hours, downloads it in the background, and installs it when you close The Grid. You'll see "Update downloaded" when one is ready, and "System upgraded" the next time it starts. Your settings and your Spotify login are kept. To uninstall, use **Settings → Apps** in Windows.

## First start

The light cycles race first. Press any key to skip them. After that a short setup guide walks you through four steps:

1. **Log in with Spotify.** A browser window opens. Approve access, and then come back to The Grid.
2. **Sound check.** Play something in Spotify. The meter lights up when The Grid hears it.
3. **Your first playlist.** In Spotify, right-click one of your own playlists and choose **Share → Copy link to playlist**. Paste the link into the guide.
4. Done. Welcome to the Grid.

You can run the guide again from **Settings → Run setup guide**.

## Everyday use

- Paste a Spotify link into the playlist field and press **Load**. Double-click a track to play it.
- **F** or a double-click on the picture toggles fullscreen. In fullscreen only the visuals are shown, and the mouse pointer hides itself when you stop moving it. **Esc** leaves fullscreen.
- **→ / ←** changes the preset (the visual style, there are over a thousand) and shows its name. **Space** changes preset without showing the name.
- **F1** shows all keyboard shortcuts. They work like in Winamp: Z, X, C, V and B are previous, play, pause, stop and next.
- **Settings** has the theme (The Grid, Clu's orange regime, or classic Winamp colours), the intro, and how the visuals follow the music.
- With no music the screen stays dark and shows "End of line. Waiting for music." That's on purpose.

There are also a few secrets on the Grid. The help screen (F1) has a hint.

## Troubleshooting

**The visuals don't react, or the sound check stays dark.**
The Grid listens to Windows' *default* audio device. Spotify must play on the same device.
1. Click the speaker icon on the taskbar and check which device is selected.
2. In Spotify, click the "Connect to a device" icon at the bottom right and choose **This computer**.
3. If you switch speakers or headphones while The Grid is running, it follows the switch by itself after a second or two.

**"Access denied: your program isn't registered on this Grid."**
Your Spotify email isn't on Peter's list, or it's a different email than the one your Spotify account uses. Send Peter the email address shown on spotify.com under Account.

**"No Spotify player on the Grid."**
Open the Spotify app and play any track once, then try again.

**Play does nothing.**
The Grid then opens the track directly in the Spotify app instead. Press play there if it doesn't start by itself.

**Something else is wrong.**
The Grid can write a diagnosis that Peter can read. It only reads information and changes nothing.
1. Close The Grid.
2. Open **Command Prompt** (press Start, type `cmd`, press Enter).
3. Paste this line and press Enter:

   ```
   "%LOCALAPPDATA%\Programs\The Grid\The Grid.exe" --diagnose > "%USERPROFILE%\Desktop\the-grid-diagnose.txt"
   ```
4. Send Peter the file `the-grid-diagnose.txt` from your desktop.

## Privacy

The sound is only analysed in memory while it plays. It is never recorded, saved or sent anywhere. The Grid only talks to Spotify, and to GitHub to check for updates (nothing about you or your music is sent). Your settings and login live in `%APPDATA%\The Grid` on your own PC.

End of line.
