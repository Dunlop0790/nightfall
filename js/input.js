// Keyboard movement + action, mouse aim for the flashlight. Calls onChange
// whenever the movement/action booleans flip, so main can push input to the
// server only on change instead of every frame.

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up',
  KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
};

export class Input {
  constructor(canvas, onChange) {
    this.state = { up: false, down: false, left: false, right: false, action: false };
    this.aim = 0;            // radians, flashlight direction
    this.onChange = onChange;

    window.addEventListener('keydown', (e) => this.setKey(e, true));
    window.addEventListener('keyup', (e) => this.setKey(e, false));

    // Aim is measured from the screen centre, since the local player is always
    // drawn at the centre of the canvas.
    canvas.addEventListener('mousemove', (e) => {
      const rect = canvas.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      this.aim = Math.atan2(my - rect.height / 2, mx - rect.width / 2);
    });
  }

  setKey(e, down) {
    let changed = false;
    const dir = KEYMAP[e.code];
    if (dir) {
      if (this.state[dir] !== down) { this.state[dir] = down; changed = true; }
      e.preventDefault();
    }
    if (e.code === 'Space' || e.code === 'KeyE' || e.code === 'ShiftLeft') {
      if (this.state.action !== down) { this.state.action = down; changed = true; }
      e.preventDefault();
    }
    if (changed) this.onChange(this.snapshot());
  }

  snapshot() { return { ...this.state }; }
}
