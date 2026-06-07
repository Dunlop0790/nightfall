// Client render-only constants. Anything affecting the simulation (speeds,
// sizes, hp, lunge timings) comes from the server in "init".

// Vision.
export const KILLER_VIEW = 360;        // px radius of killer sight
export const FLASH_RANGE = 380;        // px length of the survivor flashlight
export const FLASH_HALF_ANGLE = 0.46;  // radians, half the cone width
export const SELF_GLOW = 70;           // px glow around a survivor
export const SPECTATE_VIEW = 320;      // px radius when watching as a ghost
export const FOG_ALPHA = 0.985;

// Smoothing. Snappy correction so knockback and server nudges resolve quickly.
export const CORRECTION = 0.35;

export const COLORS = {
  floor: '#13141a',
  wall: '#2b2f3e',
  grid: '#191b24',
  killer: '#d2483d',
  self: '#74e08a',
  dead: '#5a5e6b',
  objective: '#ffd23f',
  objectiveDone: '#43b85f',
  ring: '#ffd23f',
  ringTrack: '#3a3d2a',
  prompt: '#ffe8a3',
};

// Survivor body colour by remaining health fraction (1 = full, 0 = downed).
// Healthy blue shifts toward orange then red as they take damage.
export const HP_COLORS = ['#d23a3a', '#e08a3a', '#4ea3ff'];
export function hpColor(frac) {
  if (frac >= 0.999) return HP_COLORS[2];
  if (frac >= 0.5) return HP_COLORS[1];
  return HP_COLORS[0];
}
