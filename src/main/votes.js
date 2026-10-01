'use strict';

/*
 * Stemmer på presets fra brugerne (K = kan lide, D = derez), sendt til Peter som issues i det private
 * releases-repo, kun når brugeren har sagt ja (\`shareVotes\` i indstillingerne). Peter samler dem med
 * scripts/collect-votes.js.
 *
 * - Stemmerne samles i en kø i datamappen (votes-pending.json), så intet går tabt uden net. Køen sendes
 *   ca. 20 s efter den sidste stemme, ved start og ved lukning.
 * - Der sendes: presetnavn, K/D, tidspunkt, app-version og et tilfældigt, anonymt id (\`votesId\`). Intet om
 *   brugeren selv.
 * - Tokenen er den samme læse-token, appen henter opdateringer med (resources/update-token.txt). Den skal også
 *   have "Issues: Read and write" på the-grid-releases (se docs/releasing.md); uden den bliver stemmerne i køen.
 */
const fs = require('node:fs');
const path = require('node:path');

const SEND_AFTER_MS = 20 * 1000;
const MAX_PER_ISSUE = 200;

class VoteQueue {
  constructor({ dir, token, owner, repo, version, getId, log = console, fetchImpl = globalThis.fetch }) {
    this.file = path.join(dir, 'votes-pending.json');
    this.token = token;
    this.owner = owner;
    this.repo = repo;
    this.version = version;
    this.getId = getId;
    this.log = log;
    this.fetch = fetchImpl;
    this.timer = null;
    this.sending = null;
    try {
      this.pending = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (!Array.isArray(this.pending)) this.pending = [];
    } catch {
      this.pending = [];
    }
  }

  save() {
    try {
      fs.writeFileSync(this.file, JSON.stringify(this.pending));
    } catch (err) {
      this.log.warn('Could not save votes:', err.message);
    }
  }

  /** @param {{preset: string, vote: 'keep'|'derez'}} v */
  add(v) {
    this.pending.push({ preset: String(v.preset).slice(0, 300), vote: v.vote === 'keep' ? 'keep' : 'derez', at: new Date().toISOString() });
    this.save();
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), SEND_AFTER_MS);
  }

  /** Sender køen som ét issue. Returnerer antallet af sendte stemmer (0 uden token, uden net eller uden stemmer). */
  async flush() {
    if (this.sending) return this.sending;
    if (!this.pending.length || !this.token) return 0;
    const batch = this.pending.slice(0, MAX_PER_ISSUE);
    const id = this.getId();
    this.sending = (async () => {
      try {
        const res = await this.fetch(`https://api.github.com/repos/${this.owner}/${this.repo}/issues`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.token}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'The-Grid',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: `votes ${id} v${this.version} (${batch.length})`,
            body: ['<!-- the-grid-votes -->', '```json', JSON.stringify({ id, version: this.version, votes: batch }, null, 1), '```'].join('\n'),
          }),
        });
        if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
        this.pending = this.pending.slice(batch.length);
        this.save();
        return batch.length;
      } catch (err) {
        this.log.warn('Votes not sent yet:', err.message);
        return 0;
      } finally {
        this.sending = null;
      }
    })();
    return this.sending;
  }
}

module.exports = { VoteQueue };
