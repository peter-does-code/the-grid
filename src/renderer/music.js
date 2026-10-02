/*
 * Lydkæden foran visualizeren og analysen, der fodrer musikmotoren:
 *
 *   kilde → forsinkelse ─┬→ analyse (rå lyd, til musikmotoren)
 *                        └→ automatisk lydniveau → begrænser → output (Butterchurn og mini-spektrum)
 *
 * Forsinkelsen lader brugeren synkronisere billedet med lyden (fx Bluetooth-hovedtelefoner).
 * Det automatiske lydniveau (src/shared/agc.js) er en langsom trim pr. nummer: det udligner Spotifys
 * lydstyrkeskyder og forskellen mellem numre, men lader høje og stille passager i et nummer være høje og
 * stille, så Butterchurn kan reagere på dem. Kun overstyring rettes hurtigt, og begrænseren er et
 * sikkerhedsnet. Ved nummerskift, efter mindst 3 s stilhed og når Init stopper, kalder app.js reseed(),
 * så niveauet måles forfra og forstærkningen sættes direkte. Slået fra under Settings er forstærkningen 1.
 * Musikmotoren ser den rå lyd, så sangens dynamik ikke udjævnes.
 */
(function () {
  'use strict';

  const M = window.VisampMusic;
  const { Agc } = window.VisampAgc;

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

      this.agc = true; // indstillingen "Automatic level"
      this.trim = new Agc();
      this.agcGain = 1; // forstærkningen, der sidst blev sat på lydkæden (diagnose og selvtest viser den)
      this.lastRms = 0;
      this.lastFeatures = null;
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
        if (agc && !this.agc) this.trim.reseed(); // tændt igen: det gamle niveau er forældet
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

    /** Nyt nummer eller musik efter længere stilhed: niveauet måles forfra, og forstærkningen sættes direkte. */
    reseed() {
      this.trim.reseed();
    }

    /** Analyserer det seneste stykke lyd. Kaldes én gang pr. billede med tiden i sekunder. */
    frame(t) {
      this.analyser.getFloatFrequencyData(this.freq);
      this.analyser.getFloatTimeDomainData(this.time);
      let sum = 0;
      for (let i = 0; i < this.time.length; i++) sum += this.time[i] * this.time[i];
      const rms = Math.sqrt(sum / this.time.length);
      this.lastRms = rms;
      this.lastFeatures = this.features.extract(this.freq, rms); // også til Tron-lagets bånd (band-drive.js)
      const events = this.engine.update(t, this.lastFeatures);
      if (this.agc) {
        const gain = this.trim.update(t, rms, { silent: this.engine.silent });
        // Trimmen glider langsomt; lydkæden opdateres først, når forstærkningen har flyttet sig 0,3 %.
        if (Math.abs(gain - this.agcGain) > this.agcGain * 0.003) this.setGain(gain);
      }
      return events;
    }
  }

  window.Visamp = window.Visamp || {};
  window.Visamp.MusicListener = MusicListener;
})();
