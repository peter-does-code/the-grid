'use strict';

/*
 * Sanghukommelsen på disken (src/shared/song-memory.js): %APPDATA%\The Grid\song-memory.json med
 *   songs:   Spotify-id → det, musikmotoren har lært om sangen, og dens mærker
 *   artists: Spotify-id → genrer (fra GET /artists/{id}; ét opslag pr. kunstner, gemt, så det kun sker én gang)
 * Kun målinger og tidspunkter, aldrig lyd. Skrives samlet lidt efter en ændring.
 */
const fs = require('node:fs');
const path = require('node:path');

const MAX_SONGS = 5000; // de senest spillede bevares
const MAX_ENTRY_BYTES = 64 * 1024;
const ID_RE = /^[A-Za-z0-9]{22}$/;

class SongStore {
  constructor({ dir, log = console }) {
    this.file = path.join(dir, 'song-memory.json');
    this.log = log;
    this.timer = null;
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.songs = data.songs || {};
      this.artists = data.artists || {};
    } catch {
      this.songs = {};
      this.artists = {};
    }
  }

  get(id) {
    return ID_RE.test(String(id)) ? this.songs[id] || null : null;
  }

  put(id, entry) {
    if (!ID_RE.test(String(id)) || !entry || typeof entry !== 'object') return false;
    if (JSON.stringify(entry).length > MAX_ENTRY_BYTES) return false;
    this.songs[id] = entry;
    const ids = Object.keys(this.songs);
    if (ids.length > MAX_SONGS) {
      ids.sort((a, b) => String(this.songs[a].updatedAt).localeCompare(String(this.songs[b].updatedAt)));
      for (const old of ids.slice(0, ids.length - MAX_SONGS)) delete this.songs[old];
    }
    this.saveSoon();
    return true;
  }

  /** Genrer for kunstnerne (højst 3): fra hukommelsen, ellers ét opslag pr. kunstner hos Spotify. */
  async genres(artistIds, fetchArtist) {
    const out = [];
    for (const id of (artistIds || []).filter((x) => ID_RE.test(String(x))).slice(0, 3)) {
      if (!this.artists[id]) {
        try {
          const artist = await fetchArtist(id);
          this.artists[id] = { genres: (artist && artist.genres) || [], at: new Date().toISOString() };
          this.saveSoon();
        } catch (err) {
          this.log.warn('Could not look up the artist:', err.message);
          continue;
        }
      }
      for (const g of this.artists[id].genres) if (!out.includes(g)) out.push(g);
    }
    return out;
  }

  saveSoon() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.save(), 2000);
  }

  save() {
    clearTimeout(this.timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify({ songs: this.songs, artists: this.artists }));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      this.log.warn('Could not save the song memory:', err.message);
    }
  }
}

module.exports = { SongStore };
