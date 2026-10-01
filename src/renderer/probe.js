/*
 * `npm run diagnose -- --audio=30`: lytter med på det, der rent faktisk spiller, i et antal sekunder
 * og rapporterer, hvad musikmotoren hører: tempo, slag, dele af sangen, stilhed og lydniveau.
 * Ændrer intet og afspiller intet.
 */
(function () {
  'use strict';

  const seconds = Math.min(300, Math.max(5, Number(new URLSearchParams(location.search).get('seconds')) || 30));

  async function run() {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
    stream.getVideoTracks().forEach((t) => t.stop());
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error('Ingen systemlyd.');
    const ctx = new AudioContext({ latencyHint: 'interactive' });
    await ctx.resume();
    const source = ctx.createMediaStreamSource(new MediaStream([track]));
    const music = new window.Visamp.MusicListener(ctx);
    music.connect(source);

    const start = performance.now() / 1000;
    const events = [];
    const timeline = [];
    let beats = 0;
    let downbeats = 0;
    let peakRms = 0;
    let lastSecond = -1;

    await new Promise((resolve) => {
      // setInterval i stedet for requestAnimationFrame, da vinduet er skjult.
      const timer = setInterval(() => {
        const t = performance.now() / 1000;
        const rel = t - start;
        for (const e of music.frame(t)) {
          if (e.type === 'beat') {
            beats += 1;
            if (e.downbeat) downbeats += 1;
          } else {
            events.push({ type: e.type, t: Math.round((e.t - start) * 100) / 100, reason: e.reason, index: e.index });
          }
        }
        peakRms = Math.max(peakRms, music.lastRms);
        const second = Math.floor(rel);
        if (second !== lastSecond) {
          lastSecond = second;
          const s = music.engine.state;
          timeline.push({
            t: second,
            rmsDb: Math.round(20 * Math.log10(music.lastRms + 1e-9)),
            bpm: s.bpm ? Math.round(s.bpm * 10) / 10 : null,
            conf: Math.round(s.confidence * 10) / 10,
            silent: s.silent,
            part: s.sectionIndex,
            energy: s.energy,
            dom: s.dominance.map((x) => Math.round(x * 100)),
            gain: Math.round(music.agcGain * 100) / 100,
          });
        }
        if (rel >= seconds) {
          clearInterval(timer);
          resolve();
        }
      }, 1000 / 60);
    });

    track.stop();
    const bpms = timeline.filter((x) => x.bpm).map((x) => x.bpm).sort((a, b) => a - b);
    return {
      ok: true,
      seconds,
      label: track.label,
      peakRmsDb: Math.round(20 * Math.log10(peakRms + 1e-9)),
      beats,
      downbeats,
      medianBpm: bpms.length ? bpms[bpms.length >> 1] : null,
      secondsWithTempo: bpms.length,
      events,
      timeline,
    };
  }

  run()
    .then((report) => window.visamp.probe.report(report))
    .catch((err) => window.visamp.probe.report({ ok: false, error: String((err && err.message) || err) }));
})();
