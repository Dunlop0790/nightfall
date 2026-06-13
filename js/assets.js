// Sprite manifest. Every drawable asset slot the game uses, in one place.
// Drop a matching file into sprites/ and the slot starts rendering it; any
// missing file gets an auto-generated placeholder so the game never breaks.
//
// frame: per-frame size for character sheets (4 frames: down, right, up, left)
// size:  full size for single-image tiles/props

export const SPRITES = {
  floor:     { src: 'sprites/floor.png',     size: 32 },
  wall:      { src: 'sprites/wall.png',      size: 32 },
  crate:     { src: 'sprites/crate.png',     size: 32 },
  // Generator is a horizontal animation strip: any number of 64x64 frames.
  // The frame shown follows repair progress; the LAST frame is the finished look.
  generator: { src: 'sprites/generator.png', size: 64 },
  exit:      { src: 'sprites/exit.png',      size: 32 },
  survivor:  { src: 'sprites/survivor.png',  frame: 32 },
  killer:    { src: 'sprites/killer.png',    frame: 48 },
};

// Placeholder colors used when a sprite file is missing.
export const PLACEHOLDER_COLORS = {
  floor: '#1d1f28',
  wall: '#2b2f3e',
  crate: '#7a5a30',
  generator: '#ffd23f',
  exit: '#43b85f',
  survivor: '#4ea3ff',
  killer: '#d2483d',
};
