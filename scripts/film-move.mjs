/**
 * Smooth emulated input for scripts/emu-film.py. Runs a list of moves inside the app frame and
 * updates IWER's device on every animation frame, with the same calls the CLI's
 * `xr set-transform` and `xr set-select-value` make (hands[side].position.set,
 * hands[side].updatePinchValue, the headset quaternion). Hands and head glide on video
 * instead of jumping once per CLI call.
 *
 * Input: CO_MOVES, a JSON list run in order. Each move is one of:
 *   {hand: 'left'|'right', to: [x, y, z], ms, lift?}   glide a hand; lift = arc height in metres
 *   {pinch: 'left'|'right', value: 0..1, ms?}          close or open a pinch (default 150 ms)
 *   {head: [pitchDeg, yawDeg], ms}                     turn the head; its position is unchanged
 *   {wait: ms}
 *   {overlay: true|false}                              show or hide the emulator's own dev overlay
 *                                                      (toolbar, hand panels, axis gizmos); the game's hands stay
 * Each CLI `xr` command puts IWER in "programmatic" control for 30 s; after that its dev overlay
 * drives the devices from its own copy of their poses. So every frame here renews that capture,
 * as each CLI command does, and each move ends with notifyStateChange() so the overlay's copy
 * matches where the move left the device.
 * Returns the head's pitch/yaw and both hands' positions and pinch values afterwards.
 * Usage: CO_MOVES='[...]' iwsdk browser run scripts/film-move.mjs
 */
export default async ({ frame, page }) => {
  const moves = JSON.parse(process.env.CO_MOVES ?? '[]');
  return (frame ?? page).evaluate(async (moves) => {
    const d = globalThis.IWER_DEVICE;
    if (!d) throw new Error('IWER_DEVICE not found: is the emulator running in this frame?');
    const hold = () => (d.remote?.activateCaptureMode ? d.remote.activateCaptureMode() : (d.controlMode = 'programmatic'));
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
    const nextFrame = () =>
      new Promise((r) => {
        const id = setTimeout(r, 34);
        requestAnimationFrame(() => { clearTimeout(id); r(); });
      });
    const over = async (ms, f) => {
      const t0 = performance.now();
      for (;;) {
        const t = Math.min(1, (performance.now() - t0) / Math.max(1, ms));
        hold();
        f(ease(t), t);
        if (t >= 1) return;
        await nextFrame();
      }
    };
    const rad = Math.PI / 180;
    // Yaw about +Y, then pitch about +X (the CLI's {pitch, yaw, roll: 0}).
    const setHead = (pitch, yaw) => {
      const cx = Math.cos((pitch * rad) / 2), sx = Math.sin((pitch * rad) / 2);
      const cy = Math.cos((yaw * rad) / 2), sy = Math.sin((yaw * rad) / 2);
      d.quaternion.set(cy * sx, sy * cx, -sy * sx, cy * cx);
    };
    const getHead = () => {
      const { x, y, z, w } = d.quaternion;
      const fx = -2 * (x * z + w * y), fy = -2 * (y * z - w * x), fz = -(1 - 2 * (x * x + y * y));
      return [Math.atan2(fy, Math.hypot(fx, fz)) / rad, Math.atan2(-fx, -fz) / rad];
    };
    for (const m of moves) {
      if (m.wait !== undefined) {
        await over(m.wait, () => {});
      } else if (m.hand) {
        const h = d.hands[m.hand];
        if (!h) throw new Error(`no ${m.hand} hand`);
        const a = [h.position.x, h.position.y, h.position.z], b = m.to, lift = m.lift ?? 0;
        await over(m.ms ?? 700, (e) => {
          const arc = lift * Math.sin(Math.PI * e);
          h.position.set(a[0] + (b[0] - a[0]) * e, a[1] + (b[1] - a[1]) * e + arc, a[2] + (b[2] - a[2]) * e);
        });
      } else if (m.pinch) {
        const h = d.hands[m.pinch];
        if (!h) throw new Error(`no ${m.pinch} hand`);
        const v0 = h.pinchValue ?? 0, v1 = m.value;
        await over(m.ms ?? 150, (e, t) => h.updatePinchValue(t >= 1 ? v1 : v0 + (v1 - v0) * e));
      } else if (m.head) {
        const [p0, y0] = getHead(), [p1, y1] = m.head;
        await over(m.ms ?? 1500, (e) => setHead(p0 + (p1 - p0) * e, y0 + (y1 - y0) * e));
      } else if (m.overlay !== undefined) {
        const ui = d.devui;
        for (const el of [ui?.devUIContainer, ui?.devUICanvas]) if (el) el.style.visibility = m.overlay ? '' : 'hidden';
      } else {
        throw new Error(`unknown move ${JSON.stringify(m)}`);
      }
      d.notifyStateChange?.();
    }
    const hand = (s) => {
      const h = d.hands[s];
      return h ? { pos: [h.position.x, h.position.y, h.position.z], pinch: h.pinchValue } : null;
    };
    const ui = d.devui?.devUIContainer;
    return { head: getHead(), left: hand('left'), right: hand('right'), controlMode: d.controlMode,
             overlay: ui ? ui.style.visibility !== 'hidden' : null };
  }, moves);
};
