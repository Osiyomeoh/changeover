// Used by scripts/emu-stills.py through `iwsdk browser run`: a full-resolution screenshot
// of the app frame (`browser screenshot` returns a downscaled image). Writes .stills-tmp/shot.png.
import fs from 'node:fs';
import path from 'node:path';

export default async function ({ page, frame, workspaceRoot }) {
  const dir = path.join(workspaceRoot, '.stills-tmp');
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, 'shot.png');
  const el = frame ? await frame.frameElement() : null;
  await (el ?? page).screenshot({ path: out });
  return { out };
}
