/*
 * Delte formatteringshjælpere.
 * Indlæses både som <script> i rendereren (window.VisampFormat) og via require() i tests.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.VisampFormat = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  function toSeconds(ms) {
    return Number.isFinite(ms) && ms > 0 ? Math.floor(ms / 1000) : 0;
  }

  /** 3:45, 12:03 eller 1:02:03 — bruges i playlisten. */
  function formatTime(ms) {
    const total = toSeconds(ms);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  /** LCD-uret: altid mm:ss som i Winamp, med minus foran når der vises resterende tid. */
  function formatClock(ms, remaining) {
    const total = toSeconds(ms);
    const m = String(Math.floor(total / 60)).padStart(2, '0');
    const s = String(total % 60).padStart(2, '0');
    return `${remaining ? '-' : ''}${m}:${s}`;
  }

  function artistNames(track) {
    return track && Array.isArray(track.artists) ? track.artists.filter(Boolean).join(', ') : '';
  }

  /** "Kunstner - Titel" eller bare titlen. */
  function trackLabel(track) {
    if (!track) return '';
    const artists = artistNames(track);
    return artists ? `${artists} - ${track.name}` : track.name || '';
  }

  /** "12. Kunstner - Titel (3:45)" — Winamps klassiske titellinje. */
  function marqueeText(track, number) {
    if (!track) return '';
    const prefix = Number.isInteger(number) ? `${number}. ` : '';
    const duration = track.durationMs ? ` (${formatTime(track.durationMs)})` : '';
    return `${prefix}${trackLabel(track)}${duration}`;
  }

  /**
   * Et udsnit af en rullende tekst, tegn for tegn som i Winamp.
   * Kort tekst står stille; lang tekst ruller med en separator imellem.
   */
  function marqueeFrame(text, offset, width) {
    const str = String(text || '');
    if (str.length <= width) return str.padEnd(width, ' ');
    const loop = `${str}  ***  `;
    const start = ((offset % loop.length) + loop.length) % loop.length;
    return (loop + loop).slice(start, start + width);
  }

  function totalDuration(tracks) {
    return (tracks || []).reduce((sum, t) => sum + (t && t.durationMs ? t.durationMs : 0), 0);
  }

  return { formatTime, formatClock, artistNames, trackLabel, marqueeText, marqueeFrame, totalDuration };
});
