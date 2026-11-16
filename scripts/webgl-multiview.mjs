// Used by scripts/emu-perf.py through `iwsdk browser run`: does this browser's WebGL2 offer
// multiview (both eyes in one pass)? Without it, three.js draws every object once per eye.
export default async function ({ frame, page }) {
  return await (frame ?? page).evaluate(() => {
    const gl = document.createElement('canvas').getContext('webgl2');
    const exts = (gl && gl.getSupportedExtensions()) || [];
    return { multiview: exts.includes('OCULUS_multiview') || exts.includes('OVR_multiview2') };
  });
}
