/*
 * Playliste-vinduet: grøn tekst på sort, blå markering og hvid tekst for det nummer, der spiller.
 * Klik vælger, dobbeltklik eller Enter afspiller.
 */
(function () {
  'use strict';

  const F = window.VisampFormat;
  const USER_SCROLL_GRACE_MS = 4000;

  class PlaylistView {
    constructor(listEl, { onActivate, onSelect } = {}) {
      this.el = listEl;
      this.tracks = [];
      this.selected = -1;
      this.current = -1;
      this.onActivate = onActivate || (() => {});
      this.onSelect = onSelect || (() => {});
      this.lastUserScroll = 0;

      listEl.addEventListener('click', (event) => {
        const li = event.target.closest('li[data-index]');
        if (li) this.select(Number(li.dataset.index));
      });
      listEl.addEventListener('dblclick', (event) => {
        const li = event.target.closest('li[data-index]');
        if (li) this.onActivate(Number(li.dataset.index));
      });
      listEl.addEventListener('keydown', (event) => this.onKey(event));
      listEl.addEventListener('wheel', () => {
        this.lastUserScroll = Date.now();
      }, { passive: true });
    }

    setTracks(tracks, { selected = 0, keepScroll = false } = {}) {
      const scrollTop = this.el.scrollTop;
      this.tracks = Array.isArray(tracks) ? tracks : [];
      this.current = -1;
      const fragment = document.createDocumentFragment();
      this.tracks.forEach((track, index) => {
        const li = document.createElement('li');
        li.dataset.index = String(index);
        if (!track.playable) li.classList.add('unplayable');
        const title = document.createElement('span');
        title.className = 'pl-title';
        title.textContent = `${index + 1}. ${F.trackLabel(track)}`;
        const time = document.createElement('span');
        time.className = 'pl-time';
        time.textContent = track.durationMs ? F.formatTime(track.durationMs) : '';
        li.title = [F.trackLabel(track), track.album].filter(Boolean).join(' — ') + (track.playable ? '' : ` (${window.GridI18n.t('pl.unplayable')})`);
        li.append(title, time);
        fragment.append(li);
      });
      this.el.replaceChildren(fragment);
      this.selected = -1;
      if (this.tracks.length) this.select(Math.max(0, Math.min(selected, this.tracks.length - 1)), { scroll: false, notify: false });
      this.el.scrollTop = keepScroll ? scrollTop : 0;
    }

    item(index) {
      return this.el.children[index] || null;
    }

    select(index, { scroll = true, notify = true } = {}) {
      if (index < 0 || index >= this.tracks.length) return;
      const old = this.item(this.selected);
      if (old) old.classList.remove('selected');
      this.selected = index;
      const li = this.item(index);
      if (li) {
        li.classList.add('selected');
        if (scroll) li.scrollIntoView({ block: 'nearest' });
      }
      if (notify) this.onSelect(index);
    }

    setCurrent(index) {
      if (index === this.current) return;
      const old = this.item(this.current);
      if (old) old.classList.remove('current');
      this.current = index;
      const li = this.item(index);
      if (!li) return;
      li.classList.add('current');
      // Følg med i listen, medmindre brugeren lige har scrollet selv.
      if (Date.now() - this.lastUserScroll > USER_SCROLL_GRACE_MS) li.scrollIntoView({ block: 'nearest' });
    }

    onKey(event) {
      if (!this.tracks.length) return;
      const page = Math.max(1, Math.floor(this.el.clientHeight / 20) - 1);
      const moves = {
        ArrowDown: this.selected + 1,
        ArrowUp: this.selected - 1,
        PageDown: this.selected + page,
        PageUp: this.selected - page,
        Home: 0,
        End: this.tracks.length - 1,
      };
      if (event.key in moves) {
        this.select(Math.max(0, Math.min(this.tracks.length - 1, moves[event.key])));
        event.preventDefault();
        event.stopPropagation();
      } else if (event.key === 'Enter' && this.selected >= 0) {
        this.onActivate(this.selected);
        event.preventDefault();
        event.stopPropagation();
      }
    }

    count() {
      return this.tracks.length;
    }
  }

  window.Visamp = window.Visamp || {};
  window.Visamp.PlaylistView = PlaylistView;
})();
