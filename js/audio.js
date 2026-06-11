// Audio manager. Every sound the game can make has a named slot here. Drop a
// matching file into sounds/ and it starts playing; missing files are skipped
// silently so the game runs fine with any subset of audio present.
//
// Browsers block audio until the user interacts with the page, so unlock()
// must be called from a click handler (joining the lobby covers it).

const SOUNDS = {
  music:       { src: 'sounds/music.mp3',       loop: true,  volume: 0.35 },
  heartbeat:   { src: 'sounds/heartbeat.mp3',   loop: true,  volume: 0.0 },
  hit:         { src: 'sounds/hit.mp3',         loop: false, volume: 0.8 },
  down:        { src: 'sounds/down.mp3',        loop: false, volume: 0.9 },
  revive:      { src: 'sounds/revive.mp3',      loop: false, volume: 0.8 },
  gen_done:    { src: 'sounds/gen_done.mp3',    loop: false, volume: 0.7 },
  escape_open: { src: 'sounds/escape_open.mp3', loop: false, volume: 0.9 },
  escaped:     { src: 'sounds/escaped.mp3',     loop: false, volume: 0.9 },
};

export class AudioManager {
  constructor() {
    this.slots = new Map();
    this.unlocked = false;
    for (const [name, cfg] of Object.entries(SOUNDS)) {
      const el = new Audio();
      const slot = { el, cfg, ok: true };
      el.addEventListener('error', () => { slot.ok = false; });
      el.src = cfg.src;
      el.loop = cfg.loop;
      el.volume = cfg.volume;
      el.preload = 'auto';
      this.slots.set(name, slot);
    }
  }

  // Call from a user gesture (click) so the browser allows playback.
  unlock() {
    if (this.unlocked) return;
    this.unlocked = true;
    const music = this.slots.get('music');
    if (music.ok) music.el.play().catch(() => {});
    const hb = this.slots.get('heartbeat');
    if (hb.ok) { hb.el.volume = 0; hb.el.play().catch(() => {}); }
  }

  play(name) {
    const slot = this.slots.get(name);
    if (!slot) throw new Error(`Unknown sound slot: ${name}`);
    if (!slot.ok || !this.unlocked) return;
    slot.el.currentTime = 0;
    slot.el.play().catch(() => {});
  }

  // Continuous volume control for the looping heartbeat (0..1 by killer proximity).
  setHeartbeat(volume) {
    const slot = this.slots.get('heartbeat');
    if (!slot.ok || !this.unlocked) return;
    slot.el.volume = Math.max(0, Math.min(1, volume));
  }

  stopMusic() {
    const slot = this.slots.get('music');
    if (slot.ok) slot.el.pause();
  }
}
