// Tracks movement, action, attack, lunge, and mouse aim. State is polled by
// main and sent to the server at a fixed rate, so there is no change callback.
//
// Space is the universal "do" button: the server reads it as repair for a
// survivor and as attack for the killer. Mouse left-click also attacks. Shift
// lunges (killer only). Aim follows the mouse, measured from screen centre,
// since the focused player is always drawn at the centre.

const MOVE = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
};

export class Input {
  constructor(canvas) {
    this.state = { up: false, down: false, left: false, right: false, action: false, attack: false, lunge: false, sprint: false };
    this.aim = 0;

    window.addEventListener('keydown', (e) => this.setKey(e, true));
    window.addEventListener('keyup', (e) => this.setKey(e, false));

    canvas.addEventListener('mousemove', (e) => {
      const r = canvas.getBoundingClientRect();
      this.aim = Math.atan2(e.clientY - r.top - r.height / 2, e.clientX - r.left - r.width / 2);
    });
    canvas.addEventListener('mousedown', (e) => { if (e.button === 0) this.state.attack = true; });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.state.attack = false; });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setKey(e, down) {
    if (document.activeElement && document.activeElement.tagName === 'INPUT') return;
    const dir = MOVE[e.code];
    if (dir) { this.state[dir] = down; e.preventDefault(); }
    if (e.code === 'Space' || e.code === 'KeyE') {
      this.state.action = down;
      if (e.code === 'Space') this.state.attack = down;
      e.preventDefault();
    }
    if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') { this.state.lunge = down; this.state.sprint = down; e.preventDefault(); }
  }

  snapshot() { return { ...this.state, aim: Math.round(this.aim * 100) / 100 }; }
}
