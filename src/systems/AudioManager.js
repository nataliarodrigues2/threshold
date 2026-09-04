import * as THREE from 'three';

export class AudioManager {
    constructor() {
        this.context = null;
        this.master = null;
        this.verb = null;
        this.verbGain = null;
        this.proximityGain = null;
        this.humGain = null;
        this.enabled = true;
        this.ambientLayers = { hum: [], drone: [], whisper: [], distant: [], tape: [] };
        this._timers = [];
        this._breathOsc = null;
        this._footStepTimer = 0;
        this.buses = {};
        this.buffers = new Map();
        this._posSources = new Set();
        this._globalCooldown = 0;
        this._sessionId = 0;
        this._schedulerId = null;
        this._lastEventTime = 0;
        this._silenceUntil = 0;
        this._currentLevel = 0;
        this._currentIntensity = 1;
    }

    init() {
        if (this.context) return;
        try {
            this.context = new (window.AudioContext || window.webkitAudioContext)();
            this.master = this.context.createGain();
            this.master.gain.value = 0.24;
            this.master.connect(this.context.destination);
            const createBus = (name, vol = 1) => {
                const g = this.context.createGain();
                g.gain.value = vol;
                g.connect(this.master);
                this.buses[name] = g;
                return g;
            };
            createBus('ambient', 1);
            createBus('player', 1);
            createBus('entities', 1);
            createBus('world', 1);
            createBus('ui', 1);
            createBus('music', 0.85);
            this.verb = this.context.createConvolver();
            this.verb.buffer = this.createReverbBuffer(2.8, 0.35);
            this.verbGain = this.context.createGain();
            this.verbGain.gain.value = 0.15;
            this.verb.connect(this.verbGain);
            this.verbGain.connect(this.buses.ambient);
            this.proximityGain = this.context.createGain();
            this.proximityGain.gain.value = 0;
            this.proximityGain.connect(this.buses.entities);
            this.humGain = this.context.createGain();
            this.humGain.gain.value = 1;
            this.humGain.connect(this.buses.ambient);
        } catch (e) {
            console.warn('Áudio indisponível.', e);
            this.enabled = false;
        }
    }

    resume() {
        if (this.context && this.context.state === 'suspended') this.context.resume();
    }

    createReverbBuffer(seconds, decay) {
        const rate = this.context.sampleRate;
        const len = Math.floor(rate * seconds);
        const buf = this.context.createBuffer(2, len, rate);
        for (let ch = 0; ch < 2; ch++) {
            const data = buf.getChannelData(ch);
            for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay * 6) * 0.3;
        }
        return buf;
    }

    createNoiseBuffer(seconds, type = 'white') {
        const rate = this.context.sampleRate;
        const len = Math.floor(rate * seconds);
        const buf = this.context.createBuffer(1, len, rate);
        const data = buf.getChannelData(0);
        let last = 0;
        for (let i = 0; i < len; i++) {
            if (type === 'pink') { const white = Math.random() * 2 - 1; last = last * 0.92 + white * 0.08; data[i] = last * 0.6; } else data[i] = Math.random() * 2 - 1;
        }
        return buf;
    }

    startAmbient(intensity = 1.0, levelIndex = 0) {
        if (!this.enabled || !this.context || this.master === null) return;
        // idempotente: se já tem hum, não duplica
        if (this.ambientLayers.hum.length > 0) return;
        this._sessionId++;
        const sid = this._sessionId;
        this._currentLevel = levelIndex;
        this._currentIntensity = intensity;
        this._silenceUntil = performance.now() + 4000 + Math.random() * 4000;
        const ctx = this.context;
        // filosofia: 1-2 layers contínuos discretos apenas
        // hum muito baixo (1 osc) + drone quase imperceptível (1 osc)
        this.playHum(60, 0.012 * intensity);
        this.playHum(120, 0.010 * intensity);
        const levelDrone = [34, 42, 50][levelIndex] || 34;
        this.playDrone(levelDrone, 0.014 * intensity);
        // tape hiss REMOVIDO do loop contínuo - vira evento eventual discreto
        // duct wind REMOVIDO do loop global - vira evento intermitente por scheduler
        this.startEntityBreath();
        this.startHumLFO();
        // scheduler central único
        this.scheduleNextAmbientEvent(sid);
    }

    scheduleNextAmbientEvent(sessionId) {
        if (sessionId !== this._sessionId) return;
        if (!this.enabled || !this.context) return;
        // intervalos por dificuldade/intensidade (intensidade 0.5 easy 1.0 normal 1.8 hard)
        let min, max;
        if (this._currentIntensity <= 0.6) { min = 20000; max = 40000; }
        else if (this._currentIntensity <= 1.1) { min = 15000; max = 32000; }
        else { min = 10000; max = 26000; }
        const delay = min + Math.random() * (max - min);
        const id = setTimeout(() => {
            if (sessionId !== this._sessionId) return;
            if (performance.now() < this._silenceUntil) {
                this.scheduleNextAmbientEvent(sessionId);
                return;
            }
            this.triggerOneAmbientEvent(sessionId);
            this.scheduleNextAmbientEvent(sessionId);
        }, delay);
        this._timers.push(id);
        this._schedulerId = id;
    }

    triggerOneAmbientEvent(sessionId) {
        if (sessionId !== this._sessionId) return;
        // pools por level
        const level = this._currentLevel;
        let pool;
        if (level === 0) pool = ['whisper','distantFoot','flicker','bang'];
        else if (level === 1) pool = ['pipe','metalBang','vent','distantFoot'];
        else pool = ['reverse','tonal','distantMetal','whisper'];
        // raridade
        const r = Math.random();
        let choice;
        if (r < 0.28) choice = pool[0];
        else if (r < 0.52) choice = pool[1];
        else if (r < 0.74) choice = pool[2];
        else choice = pool[3];
        // giggle extremamente raro: 4% substitui
        if (Math.random() < 0.04) choice = 'giggle';
        // tape hiss como evento raríssimo anômalo
        if (Math.random() < 0.015) choice = 'tape';

        const ctx = this.context;
        switch (choice) {
            case 'whisper': this.playWhisperOnce(0.05); break;
            case 'reverse': this.playReverseOnce(0.035); break;
            case 'giggle': this.playDistantGiggle(ctx, 0.04); break;
            case 'distantFoot': this.playDistantFootsteps(ctx, 0.045); break;
            case 'bang': case 'metalBang': case 'distantMetal': this.playDistantBang(ctx, 0.05); break;
            case 'pipe': this.playPipeKnockOnce(0.05); break;
            case 'vent': this.playDuctEvent(0.025); break;
            case 'flicker': this.sfx('flicker'); break;
            case 'tonal': this.playDistantHum(ctx, 0.04); break;
            case 'tape': this.playTapeEvent(0.022); break;
            default: this.playDistantHum(ctx, 0.04); break;
        }
        // cooldown após evento forte
        this._silenceUntil = performance.now() + 8000 + Math.random() * 7000;
        if (choice === 'giggle' || choice === 'bang') this._silenceUntil += 6000;
    }

    // evento discreto tape hiss (não loop)
    playTapeEvent(baseGain) {
        const ctx = this.context;
        const buf = this.createNoiseBuffer(0.9, 'pink');
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const filter = ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.value = 2800;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(baseGain, ctx.currentTime + 0.12);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.9);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(this.buses.world);
        src.start();
        src.stop(ctx.currentTime + 1.0);
    }

    playDuctEvent(baseGain) {
        const ctx = this.context;
        const buf = this.createNoiseBuffer(1.4, 'pink');
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 180;
        filter.Q.value = 5;
        const gain = ctx.createGain();
        gain.gain.value = baseGain;
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(baseGain, ctx.currentTime + 0.4);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.4);
        src.connect(filter);
        filter.connect(gain);
        gain.connect(this.buses.ambient);
        gain.connect(this.verb);
        src.start();
        src.stop(ctx.currentTime + 1.6);
    }

    playPipeKnockOnce(baseGain) {
        const ctx = this.context;
        const buf = ctx.createBuffer(1, ctx.sampleRate * 0.22, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) { const t = i / ctx.sampleRate; data[i] = Math.sin(2 * Math.PI * 90 * t) * Math.exp(-t * 18) * 0.5 + (Math.random() * 2 - 1) * Math.exp(-t * 40) * 0.12; }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const gain = ctx.createGain();
        gain.gain.value = baseGain * (0.6 + Math.random() * 0.5);
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 300;
        src.connect(filter);
        filter.connect(gain);
        gain.connect(this.buses.world);
        gain.connect(this.verb);
        src.start();
    }

    playWhisperOnce(baseGain) {
        const ctx = this.context;
        const dur = 1.6 + Math.random() * 1.2;
        const buf = this.createNoiseBuffer(dur, 'white');
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) { const env = Math.sin((i / data.length) * Math.PI) * 0.12 * Math.exp(-i / (ctx.sampleRate * 1.2)); data[i] *= env; }
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = 0.7 + Math.random() * 0.6;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 900 + Math.random() * 1400;
        filter.Q.value = 6;
        const panner = ctx.createStereoPanner();
        panner.pan.value = (Math.random() * 2 - 1) * 0.85;
        const gain = ctx.createGain();
        gain.gain.value = baseGain * (0.35 + Math.random() * 0.4);
        src.connect(filter);
        filter.connect(panner);
        panner.connect(gain);
        gain.connect(this.buses.ambient);
        gain.connect(this.verb);
        src.start();
    }

    playReverseOnce(baseGain) {
        const ctx = this.context;
        const buf = this.createNoiseBuffer(2.2, 'white');
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.sin((i / data.length) * Math.PI) * 0.08;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = -0.85;
        src.detune.value = -400 + Math.random() * 200;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 600 + Math.random() * 700;
        filter.Q.value = 4;
        const gain = ctx.createGain();
        gain.gain.value = baseGain * 0.4;
        gain.gain.setValueAtTime(0, ctx.currentTime);
        gain.gain.linearRampToValueAtTime(gain.gain.value, ctx.currentTime + 0.6);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 2.6);
        const panner = ctx.createStereoPanner();
        panner.pan.value = (Math.random() * 2 - 1) * 0.9;
        src.connect(filter);
        filter.connect(panner);
        panner.connect(gain);
        gain.connect(this.buses.ambient);
        src.start();
        src.stop(ctx.currentTime + 2.8);
    }

    playHum(frequency, gainValue) {
        const ctx = this.context;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.value = frequency;
        gain.gain.value = gainValue;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 420;
        filter.Q.value = 0.7;
        osc.connect(filter);
        filter.connect(this.humGain);
        osc.start();
        this.ambientLayers.hum.push({ osc, gain, filter });
    }

    playDrone(frequency, gainValue) {
        const ctx = this.context;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = frequency;
        gain.gain.value = gainValue;
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = frequency;
        filter.Q.value = 8;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.07 + Math.random() * 0.05;
        const lfoGain = ctx.createGain();
        lfoGain.gain.value = 3;
        lfo.connect(lfoGain);
        lfoGain.connect(osc.frequency);
        lfo.start();
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.buses.ambient);
        gain.connect(this.verb);
        osc.start();
        this.ambientLayers.drone.push({ osc, gain, filter, lfo });
    }

    // compat: não usados mais como loops
    startTapeHiss() {}
    startDuctWind() {}
    startWhispers() {}
    startReverseWhispers() {}
    startDistantEvents() {}
    startPipeKnocks() {}

    // Respiração calma, sutil — usada na cena de despertar (mundo real).
    // Diferente de startEntityBreath() (que é tensa/ameaçadora, ligada à
    // proximidade da entidade): aqui é só uma inspirada+expirada suave,
    // uma vez, baixo volume, sem repetição automática.
    playWakeBreath() {
        if (!this.enabled || !this.context) return;
        const ctx = this.context;
        const now = ctx.currentTime;

        const bufferSize = Math.floor(ctx.sampleRate * 2.6);
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }
        const source = ctx.createBufferSource();
        source.buffer = buffer;

        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 420;

        const gain = ctx.createGain();
        // envelope suave: sobe (inspira), desce (expira), bem discreto
        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.05, now + 0.9);
        gain.gain.linearRampToValueAtTime(0.02, now + 1.5);
        gain.gain.linearRampToValueAtTime(0, now + 2.6);

        source.connect(filter);
        filter.connect(gain);
        gain.connect(this.master);
        source.start(now);
        source.stop(now + 2.6);
    }

    startEntityBreath() {
        const ctx = this.context;
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 22;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 180;
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.proximityGain);
        osc.start();
        this._breathOsc = { osc, gain, filter };
        const osc2 = ctx.createOscillator();
        osc2.type = 'triangle';
        osc2.frequency.value = 44;
        const gain2 = ctx.createGain();
        gain2.gain.value = 0;
        osc2.connect(filter);
        filter.connect(gain2);
        gain2.connect(this.proximityGain);
        osc2.start();
        this._breathOsc2 = { osc: osc2, gain: gain2 };
        this._heartLoop = null;
        this._heartGain = null;
    }

    startHeartbeat() {
        if (this._heartLoop || !this.buffers.has('heartbeat')) return;
        const h = this.playSound('heartbeat', { volume: 0.26, loop: true, bus: 'player' });
        if (h) { this._heartLoop = h; this._heartGain = h.gain; }
    }

    stopHeartbeat(fade = 1.2) {
        if (!this._heartLoop) return;
        try {
            this.fadeGain(this._heartGain.gain, 0, fade);
            setTimeout(()=>{ try{ this._heartLoop.src.stop(); }catch{}; this._heartLoop=null; this._heartGain=null; }, fade*1000+100);
        } catch { this._heartLoop=null; }
    }

    updateHeartbeatRate(intensity) {
        if (!this._heartLoop) return;
        try {
            const rate = 0.85 + intensity * 0.45;
            this._heartLoop.src.playbackRate.value = rate;
            this.fadeGain(this._heartGain.gain, 0.16 + intensity*0.18, 0.4);
        } catch {}
    }

    playEntityGrowl(position, intensity = 0.7) {
        const pool = ['entityGrowl01','entityGrowl02','entityGrowl03','entityGrowl04'];
        const pick = pool[Math.floor(Math.random()*pool.length)];
        if (!this.buffers.has(pick)) { this.sfx('whisper'); return; }
        const vol = 0.30 + intensity*0.28;
        return this.playPositional(pick, position, { volume: vol, bus: 'entities', refDistance: 2, maxDistance: 32, rolloff: 0.85, playbackRate: 0.92+Math.random()*0.14 });
    }

    playEntityVanish(position) {
        const pool = ['entityVanish01','entityVanish02','entityVanish03'];
        const pick = pool[Math.floor(Math.random()*pool.length)];
        if (this.buffers.has(pick)) return this.playPositional(pick, position, { volume: 0.38, bus: 'entities', refDistance: 1.5, maxDistance: 28 });
        this.sweep(400, 100, 0.7);
    }

    playEntityBreathAsset(position, intensity) {
        if (Math.random() > 0.22) return;
        const pool = ['entityBreath01','entityBreath02','entityBreath03'];
        const pick = pool[Math.floor(Math.random()*pool.length)];
        if (!this.buffers.has(pick)) return;
        this.playPositional(pick, position, { volume: 0.14 + intensity*0.12, bus: 'entities', refDistance: 1.2, maxDistance: 18, playbackRate: 0.9+Math.random()*0.12 });
    }

    setProximityIntensity(v) {
        if (!this.enabled || !this.context) return;
        const t = Math.max(0, Math.min(1, v));
        const now = this.context.currentTime;
        if (this.proximityGain) {
            this.proximityGain.gain.cancelScheduledValues(now);
            this.proximityGain.gain.linearRampToValueAtTime(t * 0.28, now + 0.4);
        }
        if (this._breathOsc) {
            this._breathOsc.gain.gain.linearRampToValueAtTime(t * 0.10, now + 0.5);
            this._breathOsc.osc.frequency.linearRampToValueAtTime(22 + t * 10, now + 0.6);
            this._breathOsc2.gain.gain.linearRampToValueAtTime(t * 0.06, now + 0.5);
        }
        if (this.humGain) this.humGain.gain.linearRampToValueAtTime(1 - t * 0.22, now + 0.6);
    }

    onLightFlicker(intensity) {
        if (!this.humGain || !this.context) return;
        const v = 0.88 + Math.random() * 0.18 * intensity;
        this.humGain.gain.cancelScheduledValues(this.context.currentTime);
        this.humGain.gain.setTargetAtTime(v, this.context.currentTime, 0.08);
    }

    startHumLFO() {
        const ctx = this.context;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 0.09;
        const gain = ctx.createGain();
        gain.gain.value = 0.06;
        lfo.connect(gain);
        gain.connect(this.humGain.gain);
        lfo.start();
        this.ambientLayers.hum.push({ osc: lfo, gain });
    }

    playDistantFootsteps(ctx, baseGain) {
        const steps = 2 + Math.floor(Math.random() * 2);
        const pan = (Math.random() * 2 - 1) * 0.7;
        for (let i = 0; i < steps; i++) {
            setTimeout(() => {
                const buf = ctx.createBuffer(1, ctx.sampleRate * 0.16, ctx.sampleRate);
                const data = buf.getChannelData(0);
                for (let j = 0; j < data.length; j++) data[j] = (Math.random() * 2 - 1) * Math.exp(-j / (ctx.sampleRate * 0.04)) * 0.09;
                const src = ctx.createBufferSource();
                src.buffer = buf;
                const filter = ctx.createBiquadFilter();
                filter.type = 'lowpass';
                filter.frequency.value = 190;
                const panner = ctx.createStereoPanner();
                panner.pan.value = pan + (Math.random() * 0.2 - 0.1);
                const gain = ctx.createGain();
                gain.gain.value = baseGain * 0.35;
                src.connect(filter);
                filter.connect(panner);
                panner.connect(gain);
                gain.connect(this.buses.world);
                gain.connect(this.verb);
                src.start();
            }, i * (320 + Math.random() * 320));
        }
    }

    playDistantBang(ctx, baseGain) {
        const buf = ctx.createBuffer(1, ctx.sampleRate * 0.55, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.12)) * 0.14;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 140;
        const gain = ctx.createGain();
        gain.gain.value = baseGain * 0.45;
        src.connect(filter);
        filter.connect(gain);
        gain.connect(this.buses.world);
        gain.connect(this.verb);
        src.start();
    }

    playDistantHum(ctx, baseGain) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 58 + Math.random() * 42;
        gain.gain.value = baseGain * 0.28;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 110;
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.buses.world);
        gain.connect(this.verb);
        osc.start();
        osc.stop(ctx.currentTime + 2.2 + Math.random() * 2.8);
    }

    playDistantGiggle(ctx, baseGain) {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 520 + Math.random() * 180;
        osc.frequency.exponentialRampToValueAtTime(700 + Math.random() * 200, ctx.currentTime + 0.25);
        gain.gain.value = baseGain * 0.14;
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 900;
        filter.Q.value = 5;
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.buses.world);
        gain.connect(this.verb);
        osc.start();
        osc.stop(ctx.currentTime + 0.65);
    }

    playFootstep(isSprint, surface = 'carpet') {
        if (!this.enabled || !this.context) return;
        const now = this.context.currentTime;
        if (now - this._footStepTimer < (isSprint ? 0.28 : 0.42)) return;
        this._footStepTimer = now;
        const surfaceMap = {
            carpet: ['footstepCarpet01','footstepCarpet02','footstepCarpet03','footstepCarpet04','footstepCarpet05','footstepCarpet06','footstepCarpet07','footstepCarpet08'],
            concrete: ['footstepConcrete01','footstepConcrete02','footstepConcrete03','footstepConcrete04','footstepConcrete05','footstepConcrete06'],
            metal: ['footstepMetal01','footstepMetal02','footstepMetal03','footstepMetal04','footstepMetal05','footstepMetal06'],
        };
        const pool = surfaceMap[surface] || surfaceMap.carpet;
        this._lastFootstep = this._lastFootstep || null;
        let choices = pool.filter(id => id !== this._lastFootstep);
        if (choices.length === 0) choices = pool;
        const pick = choices[Math.floor(Math.random() * choices.length)];
        this._lastFootstep = pick;
        const buf = this.buffers.get(pick);
        if (buf) {
            const vol = isSprint ? 0.32 : 0.22;
            const rate = 0.94 + Math.random() * 0.12;
            this.playSound(pick, { volume: vol * (0.92 + Math.random()*0.16), playbackRate: rate, bus: 'player' });
            return;
        }
        const isCarpet = surface === 'carpet';
        const ctx = this.context;
        const b = ctx.createBuffer(1, ctx.sampleRate * 0.09, ctx.sampleRate);
        const data = b.getChannelData(0);
        for (let i = 0; i < data.length; i++) { const t = i / ctx.sampleRate; data[i] = (Math.random() * 2 - 1) * Math.exp(-t * 55) * 0.09 * (isCarpet ? 0.6 : 1); }
        const src = ctx.createBufferSource();
        src.buffer = b;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = isCarpet ? 320 : 800;
        const gain = ctx.createGain();
        gain.gain.value = isSprint ? 0.11 : 0.06;
        src.connect(filter);
        filter.connect(gain);
        gain.connect(this.getBus('player'));
        src.start();
    }

    sfx(name) {
        if (!this.enabled || !this.context || this.master === null) return;
        switch (name) {
            case 'pickup': this.blip(720, 0.14, 0.12); this.blip(960, 0.18, 0.09, 'triangle', 0.07); break;
            case 'switch': this.blip(180, 0.22, 0.18, 'square'); this.blip(320, 0.12, 0.07, 'square', 0.05); break;
            case 'door': this.tryDoorAsset(); break;
            case 'denied': this.blip(110, 0.28, 0.15, 'square'); this.blip(98, 0.32, 0.10, 'sawtooth', 0.06); break;
            case 'portal': this.sweep(70, 520, 1.6); break;
            case 'power': this.sweep(60, 220, 0.9); this.blip(880, 0.12, 0.05); this.setBusVolume('ambient', 0.45, 0.15); setTimeout(()=> this.setBusVolume('ambient', 1, 1.2), 800); break;
            case 'ui': this.blip(540, 0.06, 0.06, 'sine', 0, 'ui'); break;
            case 'distant': this.playRandomDistant(); break;
            case 'whisper': this.whisperBlip(); break;
            case 'flicker': this.onLightFlicker(1.0); this.blip(90, 0.07, 0.04, 'sawtooth', 0, 'world'); break;
            case 'phone': this.blip(820, 0.08, 0.07); this.blip(1220, 0.08, 0.04, 'square', 0.06); break;
            case 'breath': this.setProximityIntensity(0.9); break;
            default: break;
        }
    }

    tryDoorAsset() {
        const pool = ['doorOpen01','doorOpen02','doorOpen03'];
        const pick = pool[Math.floor(Math.random()*pool.length)];
        if (this.buffers.has(pick)) { this.playSound(pick, { volume: 0.38, bus: 'world' }); return; }
        this.slide();
    }

    whisperBlip() {
        const ctx = this.context;
        if (!ctx) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = 480 + Math.random() * 900;
        osc.frequency.exponentialRampToValueAtTime(220 + Math.random() * 280, ctx.currentTime + 0.65);
        gain.gain.setValueAtTime(0.04, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.8);
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 800;
        filter.Q.value = 6;
        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.buses.world);
        gain.connect(this.verb);
        osc.start();
        osc.stop(ctx.currentTime + 0.9);
    }

    playRandomDistant() {
        const r = Math.random();
        if (r < 0.4) this.playDistantBang(this.context, 0.06);
        else if (r < 0.75) this.playDistantFootsteps(this.context, 0.05);
        else this.playDistantGiggle(this.context, 0.04);
    }

    blip(frequency, duration, gainValue, type = 'sine', delay = 0, bus = 'ui') {
        const ctx = this.context;
        if (!ctx || !this.master) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = type;
        osc.frequency.value = frequency;
        gain.gain.setValueAtTime(0, ctx.currentTime + delay);
        gain.gain.linearRampToValueAtTime(gainValue, ctx.currentTime + delay + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + duration);
        osc.connect(gain);
        gain.connect(this.getBus(bus));
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + duration);
    }

    sweep(from, to, duration) {
        const ctx = this.context;
        if (!ctx || !this.master) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(from, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(to, ctx.currentTime + duration);
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
        osc.connect(gain);
        gain.connect(this.getBus('ui'));
        gain.connect(this.verb);
        osc.start();
        osc.stop(ctx.currentTime + duration);
    }

    slide() {
        const ctx = this.context;
        if (!ctx || !this.master) return;
        const buf = ctx.createBuffer(1, ctx.sampleRate * 0.42, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length) * 0.9;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 340;
        const gain = ctx.createGain();
        gain.gain.value = 0.20;
        src.connect(filter);
        filter.connect(gain);
        gain.connect(this.getBus('world'));
        src.start();
    }

    stopAll() {
        this._sessionId++;
        for (const id of this._timers) clearTimeout(id);
        this._timers = [];
        this._schedulerId = null;
        this._silenceUntil = 0;
        for (const layer of Object.values(this.ambientLayers)) {
            for (const node of layer) {
                try { if (node.osc) { node.osc.stop(); node.osc.disconnect(); } if (node.src) { node.src.stop(); node.src.disconnect(); } if (node.source) { node.source.stop(); node.source.disconnect(); } if (node.gain) try{ node.gain.disconnect(); }catch{} if (node.lfo) try{ node.lfo.stop(); }catch{} } catch {}
            }
        }
        try { this._breathOsc?.osc?.stop(); this._breathOsc2?.osc?.stop(); } catch {}
        for (const s of this._posSources) { try{ s.stop(); s.disconnect?.(); }catch{} }
        this._posSources.clear();
        if (this._heartLoop) { try{ this._heartLoop.src.stop(); }catch{}; this._heartLoop=null; this._heartGain=null; }
        this.ambientLayers = { hum: [], drone: [], whisper: [], distant: [], tape: [] };
        this._breathOsc = null; this._breathOsc2 = null;
        this._globalCooldown = 0;
    }

    setMasterVolume(vol) {
        if (this.master) this.fadeGain(this.master.gain, vol, 0.15);
    }

    getBus(name) { return this.buses[name] || this.master; }

    fadeGain(param, target, duration = 0.3) {
        try {
            const now = this.context.currentTime;
            const p = param instanceof AudioParam ? param : param.gain;
            p.cancelScheduledValues(now);
            p.setValueAtTime(p.value, now);
            if (duration > 0.02) p.linearRampToValueAtTime(target, now + duration);
            else p.setValueAtTime(target, now);
        } catch {}
    }

    setBusVolume(name, value, fadeTime = 0.4) {
        const bus = this.getBus(name);
        if (bus) this.fadeGain(bus.gain, value, fadeTime);
    }

    duckBus(name, duckTo, duration = 0.4, hold = 0.8, restore = 0.6) {
        const bus = this.getBus(name);
        if (!bus) return;
        this.fadeGain(bus.gain, duckTo, duration);
        const sid = this._sessionId;
        const id = setTimeout(() => { if (sid !== this._sessionId) return; this.fadeGain(bus.gain, 1, restore); }, (duration + hold) * 1000);
        this._timers.push(id);
        return bus.gain.value;
    }

    async loadSound(id, path) {
        if (this.buffers.has(id)) return this.buffers.get(id);
        if (!this.context) this.init();
        try {
            const res = await fetch(path);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const arr = await res.arrayBuffer();
            const buf = await this.context.decodeAudioData(arr.slice(0));
            this.buffers.set(id, buf);
            return buf;
        } catch (e) {
            console.warn(`[Audio] falha load ${id} ${path}`, e);
            return null;
        }
    }

    async loadSounds(manifest) {
        const entries = Object.entries(manifest);
        const promises = entries.map(([id, path]) => this.loadSound(id, path).then(buf => [id, !!buf]));
        const results = await Promise.all(promises);
        return Object.fromEntries(results);
    }

    playSound(id, { volume = 0.9, playbackRate = 1, loop = false, bus = 'sfx', position = null, refDistance = 1.5, maxDistance = 35, rolloff = 0.8 } = {}) {
        if (!this.enabled || !this.context) return null;
        const buf = this.buffers.get(id);
        if (!buf) {
            console.warn(`[Audio] buffer não encontrado: ${id}`);
            return null;
        }
        const now = performance.now();
        if (now - this._globalCooldown < 90 && bus === 'world') return null;
        if (bus === 'world') this._globalCooldown = now;
        const ctx = this.context;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        src.playbackRate.value = playbackRate * (0.98 + Math.random() * 0.04);
        src.loop = loop;
        const gain = ctx.createGain();
        gain.gain.value = volume;
        let panner = null;
        if (position) {
            panner = ctx.createPanner();
            panner.panningModel = 'HRTF';
            panner.distanceModel = 'inverse';
            panner.refDistance = refDistance;
            panner.maxDistance = maxDistance;
            panner.rolloffFactor = rolloff;
            panner.coneInnerAngle = 360;
            if (panner.positionX) {
                panner.positionX.value = position.x;
                panner.positionY.value = position.y;
                panner.positionZ.value = position.z;
            } else panner.setPosition(position.x, position.y, position.z);
            src.connect(panner);
            panner.connect(gain);
        } else {
            src.connect(gain);
        }
        const destBus = this.getBus(bus) || this.master;
        gain.connect(destBus);
        if (bus === 'world' || bus === 'entities') {
            try { gain.connect(this.verb); } catch {}
        }
        src.start();
        if (!loop) {
            src.onended = () => { try{ src.disconnect(); gain.disconnect(); panner?.disconnect(); }catch{}; this._posSources.delete(src); };
            this._posSources.add(src);
        } else {
            this._posSources.add(src);
        }
        return { src, gain, panner, updatePosition: (pos) => {
            if (!panner) return;
            if (panner.positionX) { panner.positionX.value = pos.x; panner.positionY.value = pos.y; panner.positionZ.value = pos.z; }
            else panner.setPosition(pos.x, pos.y, pos.z);
        }, stop: () => { try{ src.stop(); }catch{} } };
    }

    playPositional(id, position, opts = {}) {
        return this.playSound(id, { ...opts, position, bus: opts.bus || 'world' });
    }

    updateListener(camera) {
        if (!this.enabled || !this.context || !camera) return;
        const ctx = this.context;
        const listener = ctx.listener;
        try {
            const pos = new THREE.Vector3();
            camera.getWorldPosition(pos);
            const dir = new THREE.Vector3();
            camera.getWorldDirection(dir);
            const up = new THREE.Vector3(0, 1, 0);
            up.applyQuaternion(camera.quaternion);
            if (listener.positionX) {
                listener.positionX.value = pos.x;
                listener.positionY.value = pos.y;
                listener.positionZ.value = pos.z;
                listener.forwardX.value = dir.x;
                listener.forwardY.value = dir.y;
                listener.forwardZ.value = dir.z;
                listener.upX.value = up.x;
                listener.upY.value = up.y;
                listener.upZ.value = up.z;
            } else {
                listener.setPosition(pos.x, pos.y, pos.z);
                listener.setOrientation(dir.x, dir.y, dir.z, up.x, up.y, up.z);
            }
        } catch {}
    }

    setReverbForLevel(levelIndex) {
        if (!this.context || !this.verb) return;
        const presets = [
            { sec: 1.6, decay: 0.28 },
            { sec: 3.2, decay: 0.42 },
            { sec: 1.9, decay: 0.55 }
        ];
        const p = presets[levelIndex] || presets[0];
        try { this.verb.buffer = this.createReverbBuffer(p.sec, p.decay); } catch {}
    }

    getDebugState() {
        return {
            session: this._sessionId,
            timers: this._timers.length,
            hum: this.ambientLayers.hum.length,
            drone: this.ambientLayers.drone.length,
            posSources: this._posSources.size,
            silenceUntil: this._silenceUntil,
            heart: !!this._heartLoop
        };
    }
}
