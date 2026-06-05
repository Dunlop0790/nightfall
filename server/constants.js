// Gameplay tunables. The server is authoritative for all of these.
// The relevant ones are pushed to clients in the "init" message so the
// client never hardcodes its own copy of a number that matters for the sim.

export const TICK_RATE = 30;           // server simulation ticks per second
export const DT = 1 / TICK_RATE;       // seconds per tick

export const TILE = 32;                // pixel size of one map tile
export const PLAYER_RADIUS = 10;       // collision + draw radius

export const KILLER_SPEED = 170;       // px / second
export const SURVIVOR_SPEED = 140;     // px / second

export const CATCH_RADIUS = 20;        // killer eliminates a survivor within this
export const OBJECTIVE_RADIUS = 28;    // a survivor must be this close to work it
export const OBJECTIVE_TIME = 4;       // seconds of work to finish one objective
export const OBJECTIVES_TO_WIN = 3;    // survivors win when this many are done

export const MIN_PLAYERS_TO_START = 2; // 1 killer + at least 1 survivor
export const MAX_PLAYERS = 8;
