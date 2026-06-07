// Gameplay tunables. The server is authoritative for all of these. The ones the
// client needs for prediction and drawing are pushed in the "init" message so
// there is one source of truth.

export const TICK_RATE = 30;
export const DT = 1 / TICK_RATE;

export const TILE = 32;

// Killer is bigger and faster than survivors, for intimidation and pressure.
export const KILLER_RADIUS = 15;
export const SURVIVOR_RADIUS = 10;
export const KILLER_SPEED = 165;       // px / second
export const SURVIVOR_SPEED = 145;     // px / second

// Combat. The killer does no passive damage; it must swing or lunge.
export const SURVIVOR_HP = 3;          // hits to down a survivor
export const ATTACK_RANGE = 52;        // reach measured from the killer's centre
export const ATTACK_ARC = 0.7;         // radians, half-width of the swing cone
export const ATTACK_COOLDOWN = 0.65;   // seconds between swings
export const HIT_INVULN = 0.9;         // seconds a survivor cannot be hit after a hit
export const KNOCKBACK = 34;           // px a survivor is shoved on hit

// Lunge: a forward dash on a longer cooldown. Contact during the dash lands a hit.
export const LUNGE_SPEED = 360;        // px / second during the dash
export const LUNGE_DURATION = 0.22;    // seconds the dash lasts
export const LUNGE_COOLDOWN = 3.0;     // seconds between lunges

export const OBJECTIVE_RADIUS = 30;    // a survivor must be this close to work it
export const OBJECTIVE_TIME = 7;       // worker-seconds to finish one objective
export const OBJECTIVE_MAX_RATE = 2;   // co-op speed cap (2 = twice as fast)
export const OBJECTIVES_TO_WIN = 3;

export const MIN_PLAYERS_TO_START = 2;
export const MAX_PLAYERS = 8;

// Sprint: a speed burst available to all players on a cooldown.
export const SPRINT_MULTIPLIER = 1.55;  // speed factor while sprinting
export const SPRINT_DURATION = 2.2;     // seconds the burst lasts
export const SPRINT_COOLDOWN = 5.0;     // seconds before sprint is ready again
