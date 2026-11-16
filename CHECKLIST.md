# Ship checklist

## Code
- [x] `npm run typecheck` clean
- [x] `npm test` green (298/298 as of Nov 15, with the dawn reveal)
- [x] Emulator interlock: 80/80, 0 fail (Nov 15, re-run after look-to-hold)
- [x] Look-to-hold: model + fuzz, emulator 140/140, mutation check fails 5/7 as expected (Nov 15)
- [x] emu-play: 160/160, 0 fail (Nov 15; the Nov 4 file had stopped at run 4)
- [x] Hand-ray fallback (Quest 3, no eye tracking): lost second pinch fixed (pointer capture), 60/60, mutation check fails 2/3 as expected (Nov 15)
- [x] Interlock on Quest 3 (no eye tracking): 80/80 (Nov 15)
- [x] Regression after the ray fix on Glasses: gaze look-and-pinch 160/160, nights 60/60 (Nov 15)
- [x] Dawn reveal: unit tests in `src/dawn.test.ts`, emulator 20/20 (5 runs × 4, `evidence/emu-dawn-5runs.txt`, Nov 15); nights 60/60 with it wired in (`evidence/emu-nights-with-dawn-20runs.txt`)
- [x] Video shots: `scripts/emu-film.py --auto` played all 8 in one pass, every take OK against the game's own status (Nov 15, `evidence/emu-film-8shots.txt`); dawn framing checked by screenshot at the three head angles
- [x] Video cut: `scripts/emu-film.py --capture` recorded all 8 shots, every take OK (Nov 16), and `scripts/film-cut.py` cut them to 2:52, 1920×1080, no audio, with the scripted-input closing card (`evidence/emu-film-capture.txt`)
- [x] `npm run build` (Nov 15, after the dawn reveal); the emulator is not bundled into `dist/`
- [x] Regression after the ray fix on Glasses: emu-play 160/160, look-to-hold 140/140 (Nov 15, 09:40–11:21 WAT, headed browser; `evidence/emu-play-glasses-after-ray-fix-20runs.txt`, `evidence/emu-look-hold-glasses-after-ray-fix-20runs.txt`). The two headless attempts crashed the managed browser on its first reload (`evidence/emu-play-20runs-browser-crash-0303WAT.txt`); the headed runs used the same game code (the new dawn files already existed, but nothing imported them yet)
- [x] Starter robot, panel, glTF CDN assets, chime.mp3, webxr banner removed
- [x] Dev audit fixed (sharp override 0.35.5, vitest 5.0.5): `npm audit` 0
- [x] CI workflow (typecheck + tests)
- [x] GitHub Pages deploy workflow (Vite base path)
- [x] Power model ≥40 tests (61)
- [x] Every grabbable passes the tracking-drop test (lever ✅, tokens ✅ 20/20, cord ✅ 20/20 Nov 6: `evidence/emu-cord-drop-20runs.txt`)
- [x] Glasses mode: all critical UI inside the FoV crop (`src/fov.test.ts`, `evidence/glasses-fov-after.png`)
- [x] No grab target within 10 cm of another (each token grabs itself, both hands)
- [x] Daily Outage: same date → same night (test)
- [x] localStorage wrapped in try/catch; works with storage blocked (streak key blocked in emulator: won, 0 errors; full block: unit tests only, IWER limitation)
- [x] ≤100 draw calls, ≤150k triangles (emulator, measured): max 71 calls / 12,276 triangles per eye pass, night through dawn (Nov 15, `evidence/emu-perf-glasses.txt`). Per XR frame as the emulator counts it, 142 calls, because its WebGL has no multiview and draws each eye separately
- [x] Deployed page: 390 px and 1280 px, 0 console errors. Live Pages URL (Nov 16, `CO_DIST_URL=https://osiyomeoh.github.io/changeover/` with `scripts/dist-check.mjs`): 0 errors, 0 page errors, 0 failed requests, no horizontal scroll at 390 and 1280 px; the only messages are the browser's AudioContext autoplay warning before a gesture, as on the local `dist/` (Nov 15)

## Content rules
- [x] No brand names, no identifiable non-entrants (Nov 15 audit of game strings, UI, page, README, CLAIMS, evidence, scripts and the Devpost draft: no brands, no rival projects, judges or handles. Sources are cited as links, not logos)
- [x] No third-party art/audio/music (no media files in `public/` or `src/`; sound is generated, `src/sfx.ts`)
- [x] Every public number has a CLAIMS.md row (Nov 15 audit of README and the Devpost draft: added rows 39 unit-test count, 40 the 0.3 s re-arm, 41 the judge path and minutes; row 26 now covers the whole night table, with the 1 kW generator and the half-hour request window newly asserted in `src/model/campaign.test.ts`)

## Submission (Sam does these)
- [ ] Repo public, MIT licence, tag at freeze
- [ ] Video < 3:00, real footage, no AI video, public YouTube/Vimeo (cut done: `../changeover-video.mp4`, 2:52; Sam watches it and uploads)
- [ ] Devpost fields: name, tagline, track Gaming, division New Experience, link, description, stills
- [ ] Submit by Nov 18 18:00 Lagos (deadline 21:00)
