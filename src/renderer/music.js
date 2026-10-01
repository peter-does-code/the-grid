/*
 * Lydkæden foran visualizeren og analysen, der fodrer musikmotoren:
 *
 *   kilde → forsinkelse ─┬→ analyse (rå lyd, til musikmotoren)
 *                        └→ automatisk lydniveau → begrænser → output (Butterchurn og mini-spektrum)
 *
 * Forsinkelsen lader brugeren synkronisere billedet med lyden (fx Bluetooth-hovedtelefoner).
 * Det automatiske lydniveau sørger for, at Butterchurn altid får et kraftigt signal, uanset hvor
 * højt Spotify spiller. Musikmotoren ser den rå lyd, så sangens dynamik ikke udjævnes.
 */
(function () {
  'use strict';

  const M = window.VisampMusic;
  const AGC_TARGET_RMS = 0.18;
  const AGC_MIN_GAIN = 0.5;
  const AGC_MAX_GAIN = 12;
  const AGC_SILENCE_RMS = 0.0015;

  class MusicListener {
    constructor(audioContext, { engineOptions } = {}) {
      this.ctx = audioContext;
      this.delay = audioContext.createDelay(1.0);
      this.analyser = audioContext.createAnalyser();
      this.analyser.fftSize = 2048;
      this.analyser.smoothingTimeConstant = 0;
      this.gain = audioContext.createGain();
      this.limiter = audioContext.createDynamicsCompressor();
      this.limiter.threshold.value = -2;
      this.limiter.knee.value = 2;
      this.limiter.ratio.value = 20;
      this.limiter.attack.value = 0.002;
      this.limiter.release.value = 0.12;
      this.output = audioContext.createGain();

      this.delay.connect(this.analyser);
      this.delay.connect(this.gain);
      this.gain.connect(this.limiter);
      this.limiter.connect(this.output);

      this.freq = new Float32Array(this.analyser.frequencyBinCount);
      this.time = new Float32Array(this.analyser.fftSize);
      this.features = new M.FeatureExtractor(audioContext.sampleRate, this.analyser.fftSize);
      this.engine = new M.MusicEngine(engineOptions);

      this.agc = true;
      this.agcGain = 1;
      this.agcLevel = null;
      this.lastT = null;
      this.lastRms = 0;
      this.source = null;
    }

    connect(source) {
      this.disconnect();
      source.connect(this.delay);
      this.source = source;
    }

    disconnect() {
      if (this.source) {
        try {
          this.source.disconnect(this.delay);
        } catch {
          // Allerede frakoblet.
        }
      }
      this.source = null;
    }

    setOptions({ agc, latencyMs } = {}) {
      if (typeof agc === 'boolean') {
        this.agc = agc;
        if (!agc) this.setGain(1);
      }
      if (Number.isFinite(latencyMs)) {
        const seconds = Math.min(0.5, Math.max(0, latencyMs / 1000));
        this.delay.delayTime.setTargetAtTime(seconds, this.ctx.currentTime, 0.05);
      }
    }

    setGain(gain) {
      this.agcGain = gain;
      this.gain.gain.setTargetAtTime(gain, this.ctx.currentTime, 0.08);
    }

    /** Analyserer det seneste stykke lyd. Kaldes én gang pr. billede med tiden i sekunder. */
    frame(t) {
      this.analyser.getFloatFrequencyData(this.freq);
      this.analyser.getFloatTimeDomainData(this.time);
      let sum = 0;
      for (let i = 0; i < this.time.length; i++) sum += this.time[i] * this.time[i];
      const rms = Math.sqrt(sum / this.time.length);
      this.lastRms = rms;
      const events = this.engine.update(t, this.features.extract(this.freq, rms));
      this.updateAgc(t, rms);
      return events;
    }

    updateAgc(t, rms) {
      const dt = this.lastT === null ? 1 / 60 : Math.min(0.25, Math.max(0.001, t - this.lastT));
      this.lastT = t;
      // Uden musik holdes forstærkningen, så svag baggrundslyd ikke pustes op.
      if (!this.agc || rms < AGC_SILENCE_RMS || this.engine.silent) return;
      // Niveaufølger: op på 0,4 s, ned på 4 s, så enkelte slag ikke pumper niveauet.
      const tau = this.agcLevel === null || rms > this.agcLevel ? 0.4 : 4;
      this.agcLevel = this.agcLevel === null ? rms : this.agcLevel + (rms - this.agcLevel) * (1 - Math.exp(-dt / tau));
      const target = Math.min(AGC_MAX_GAIN, Math.max(AGC_MIN_GAIN, AGC_TARGET_RMS / this.agcLevel));
      const next = this.agcGain + (target - this.agcGain) * (1 - Math.exp(-dt / 1.5));
      if (Math.abs(next - this.agcGain) > 0.002) this.setGain(next);
    }
  }

  window.Visamp = window.Visamp || {};
  window.Visamp.MusicListener = MusicListener;
})();
