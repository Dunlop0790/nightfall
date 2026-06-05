// Client-side rendering constants only. Anything that affects the simulation
// (speeds, sizes, timings) comes from the server in the "init" message so there
// is exactly one source of truth for game rules.

// Vision. The killer sees a wide circle that fogs out with distance. The
// survivor sees a narrow flashlight cone plus a faint glow right around them.
export const KILLER_VIEW = 340;        // px radius of killer sight
export const FLASH_RANGE = 360;        // px length of the flashlight cone
export const FLASH_HALF_ANGLE = 0.46;  // radians, half the cone width (~26 deg)
export const SELF_GLOW = 66;           // px radius of the survivor's body glow
export const FOG_ALPHA = 0.985;        // how dark unseen area is (0..1)

// Smoothing.
export const CORRECTION = 0.16;        // how hard the local player snaps to server truth

export const COLORS = {
  floor: '#13141a',
  wall: '#2b2f3e',
  grid: '#191b24',
  killer: '#d23a42',
  survivor: '#4ea3ff',
  self: '#74e08a',
  dead: '#5a5e6b',
  objective: '#ffd23f',
  objectiveDone: '#43b85f',
  ring: '#ffd23f',
  ringTrack: '#3a3d2a',
};
