# Changeover

**When the grid drops in a Lagos flat, you get one battery till dawn. Pinch what stays on, and never backfeed the line. Hands only.**

A seated, hands-only WebXR game built with Meta's Immersive Web SDK (IWSDK) for the
Meta VR Start Developer Competition 2026 (Gaming track, New Experience).

In 2024 Nigeria's national grid collapsed 12 times ([Guardian Nigeria](https://guardian.ng/?p=2492578)).
On a night like that, a family in a flat has a small inverter battery, a fridge that must
stay cold and a child who can't sleep without the fan. Every appliance you switch on is a trade
against the hours left until 6 am. The generator outside can save the night, but only if the
house is isolated from the street first: a generator wired without a changeover can backfeed
the line and kill the person repairing it ([OSHA](https://webarchive.library.unt.edu/web/20080923094111/http:/osha.gov/SLTC/etools/hurricane/electrical.html)).
Changeover puts that night on a table in front of you and makes every decision a pinch.

---

## Play it

| | |
|---|---|
| **Link** | [FILL: GitHub Pages URL once the repo is public] |
| **Headset** | Open the link in the headset's browser → **Enter VR** → put the controllers down. Everything is done with your hands. |
| **Straight to the generator** | add `?daily` to the link: the Daily Outage always has the generator and the changeover. (`?night=3` opens Night 3 only once Nights 1–2 are won; until then it opens the next night not yet won.) |
| **Today's Daily Outage** | add `?daily` (the same night for every player that day; `?tier=easy\|standard\|hard`) |
| **Start a night over** | add `?fresh` |
| **No headset** | `npm ci && npm run dev` (below) opens IWSDK's emulator with emulated hands, eye gaze and the Meta VR Glasses view. |

## How to play

You sit at a lap-sized table: the flat's appliances, a board with four circuits, and the
changeover switch.

1. **Pinch an appliance and drop it on a circuit** to switch it on. Put it back to switch it off.
   The panel shows the load and how long the battery lasts at that load.
2. **Keep the fridge on.** It can be off for a short while; leave it off too long and the food
   spoils and the night is lost.
3. **The flat asks for things** (the TV, the pump, the coffee maker), each for half an hour of
   game time. Serving them costs battery.
4. **Don't overload the inverter.** Fridge plus clothes iron is 2,042 W against a 1,500 W limit,
   so it trips and everything goes off.
5. **From Night 3 the battery can't reach dawn on its own.** To use the generator:
   - **hold the isolator**, which disconnects the street: pinch it with one hand or, on a
     headset with eye tracking, just keep your eyes on it (it glows once your eyes have it);
   - **throw the changeover lever** with a hand while the isolator is held;
   - then **pull the cord**.

   Start the generator without the changeover and it is refused: that is the backfeed that
   kills line workers.

   **Look away, and the power stays off.** If your eyes are holding the isolator and you look
   away before the lever latches, the lever springs back and nothing is energised. Your eyes can
   hold the isolator, but they can never throw the lever: a hand always does that. With eye
   tracking, the changeover takes one hand.
6. **Look and pinch.** On a device with eye tracking, look at an appliance or the cord and pinch
   with either hand, with no reaching. Without eye tracking, aim your hand's ray at it and pinch.

**Safe failures, by design.**
- Lose hand tracking mid-throw and the lever springs back: nothing is energised.
- Look away from the isolator mid-throw, or lose eye tracking, and the lever springs back too.
  The panel says why.
- Lose tracking while holding an appliance and it goes back unplugged.
- A hand that has just come back into tracking cannot pull the cord or press a button until it
  has been tracked for 0.3 s.

**Dawn.** Win a night and the flat on the table opens into the room around you as the sun comes
up: the fridge, the fan over the sleeping child, light through the window. What you kept on is
what you see: the fan turns only if it was on at dawn.

**Five nights, then every day.** Nights 1–5 are fixed and each adds one idea. Win one and the
next unlocks. The Daily Outage is a new night every calendar date at three difficulty tiers,
with a streak. The game has no accounts or server: progress and the streak are saved in your
browser's local storage.

| Night | Outage | Battery | With fridge and fan on, the battery lasts | Generator |
|---|---|---|---|---|
| 1 · First night | 22:00 → 06:00 (8 h) | 5.5 kWh | 12 h 54 m | none |
| 2 · Requests | 21:00 → 06:00 (9 h) | 5.2 kWh | 12 h 12 m | none |
| 3 · The generator | 20:00 → 06:00 (10 h) | 2.8 kWh | 6 h 34 m | 1 kW, 4 h fuel |
| 4 · Not enough for everything | 19:00 → 06:00 (11 h) | 2.9 kWh | 6 h 48 m | 1 kW, 3.5 h fuel |
| 5 · The long night | 19:00 → 06:00 (11 h) | 2.6 kWh | 6 h 6 m | 1 kW, 3 h fuel |

Figures from `src/model/campaign.ts`, pinned by `src/model/campaign.test.ts`. Appliance
wattages: Virginia Cooperative Extension publication 2901-9014 (`src/model/catalogue.ts`).
The battery, inverter and generator are game parameters for a fictional flat.

---

## How it's built

- **IWSDK 1.0.1** (ECS on three.js r181), TypeScript, Vite. Every shape is generated in code,
  with no downloaded models.
- **Hands:** grab and release appliances. The **interlock** energises only in a frame where two
  different tracked holders hold the isolator and the lever: two hands, or the eyes on the
  isolator and a hand on the lever. The eyes never throw the lever. Whoever starts a throw
  must finish it.
- **Look-to-hold:** the eyes are the interlock's third holder, a dead-man's switch.
  `src/model/look-hold.ts` decides when they hold. They take hold after 0.25 s of looking
  within 5° of the isolator, keep it within 8°, and lose it after 0.15 s away or as soon as
  the eye pose is lost. One long frame can't take hold. The angle comes from the raw tracked
  eye pose, not IWSDK's gaze hover: the gaze pointer stops hovering while a hand is grabbing,
  which is exactly when the other hand is on the lever. The module has no imports (no three.js,
  no DOM).
- **Gaze + pinch:** IWSDK's gaze pointer with invisible look targets. A pinch from either hand
  commits.
- **Hand-ray fallback:** without eye tracking, the same look targets take the hand's ray. Every
  select moves its target (the appliance goes to a circuit or back home), so at release the ray
  points at nothing. IWSDK 1.0.1 drops a release like that, and the next pinch was swallowed. A
  ray select now captures the pointer on its target until the pinch is released.
- **Meta VR Glasses field of view:** every critical object sits inside the Glasses view mask at
  the seated pose (35° down), with at least 1.5° to spare and still inside at ±3° of head pitch
  (`src/fov.test.ts`).
- **Dawn reveal:** `src/dawn.ts` is pure numbers with no engine imports: how the room grows
  from the flat's size to full size, and when the ceiling and near wall appear (only once they are
  above and behind the seated eye, so nothing closes over the table). `src/dawn.test.ts` checks
  that, and that the room clears the table, the board and the seat by 10 cm.
- **Sound:** all generated at run time with Web Audio. No audio files, no samples, no music.
  Cues come from the change in game state, so a hand, a look and the clock all sound the same.
- **Pure game model:** the power model, nights, Daily Outage, interlock and session live in
  `src/model/`, with no three.js and no DOM. They're tested directly.

## Tested without a headset

No headset was available, so every interaction claim below comes from IWSDK's emulator (IWER)
driven by scripts, or from unit tests. Each row is reproducible; `CLAIMS.md` lists every
public claim with its command and artefact.

| What | Result | Reproduce |
|---|---|---|
| Unit tests | 298/298 | `npm test` |
| Two-hand interlock: approve, tracking loss mid-throw, throw without isolating, release mid-throw | 80/80 (20 runs × 4) on Meta VR Glasses; 80/80 on Meta Quest 3 (no eye tracking) | `scripts/emu-interlock.py --runs 20` → `evidence/emu-interlock-20runs.txt`, `evidence/emu-interlock-quest3-20runs.txt` |
| Look-to-hold (emulated eye gaze): one hand + eyes latches, look away springs back, two look-aways, eye tracking lost, gaze alone does nothing, two hands with the eyes elsewhere, a held isolator ignores glances | 140/140 (20 runs × 7); again 140/140 after the ray fix (headed browser) | `scripts/emu-look-hold.py --runs 20` → `evidence/emu-look-hold-20runs.txt`, `evidence/emu-look-hold-glasses-after-ray-fix-20runs.txt` |
| Hands: place, overload trip, backfeed refused, generator after changeover, tracking loss, every appliance grabs itself, tracking loss on the cord | 160/160 (20 runs × 8); again 160/160 after the ray fix (headed browser) | `scripts/emu-play.py --runs 20` → `evidence/emu-play-20runs.txt`, `evidence/emu-play-glasses-after-ray-fix-20runs.txt` |
| Look + pinch, eye gaze (emulated Meta VR Glasses; also Meta Quest Pro, Nov 4) | 160/160 (20 runs × 8) on each | `scripts/emu-look.py --runs 20` → `evidence/emu-look-glasses-20runs.txt`, `evidence/emu-look-20runs.txt` |
| Look + pinch, hand ray (emulated Meta Quest 3, no eye tracking): every target hovers only itself, plug then unplug, a release off target then 3 pinches in a row | 60/60 (20 runs × 3); before the fix, plug then unplug was 0/20 | `scripts/emu-look.py --ray --runs 20` → `evidence/emu-look-ray-20runs.txt` |
| Night to dawn → next night; loss → retry; reload resumes | 60/60 (20 runs × 3); again 60/60 with the dawn reveal | `scripts/emu-nights.py --runs 20` → `evidence/emu-nights-20runs.txt`, `evidence/emu-nights-with-dawn-20runs.txt` |
| Dawn reveal: the room grows; what was on at dawn runs in it; fan off shows only the fridge; NEXT while it grows; a lost night grows no room | 20/20 (5 runs × 4) | `scripts/emu-dawn.py --runs 5` → `evidence/emu-dawn-5runs.txt` |
| Render budget inside XR (emulated Meta VR Glasses), night start through the end of dawn | max 71 draw calls and 12,276 triangles per eye pass (budget 100 and 150,000). The emulator draws each eye separately (its WebGL has no multiview), so it counts 142 calls per frame | `scripts/emu-perf.py` → `evidence/emu-perf-glasses.txt` |
| Every Daily Outage of 2027 is winnable, all three tiers | 1,095 nights | `npm test` (`src/model/daily.test.ts`) |
| Interlock fuzz | 2,000 trials × 10 frames (hands) + 4,000 × 10 (eyes as a third holder), 0 violations | `npm test` (`src/model/interlock.test.ts`) |
| Look-to-hold fuzz, against an independent reference | 5,000 trials × 60 frames, 0 violations | `npm test` (`src/model/look-hold.test.ts`) |

**Not claimed:** frame rate, draw calls or comfort on a real headset, anything about the real Meta VR
Glasses beyond the emulator's view mask, mixed reality or passthrough, or that sound starts on
the headset's browser. The emulator's Chromium reports the audio running; nobody has heard it
on a headset. Look-to-hold's timings (0.25 s to take hold, 0.15 s grace, 5° and 8° cones) are
tested only against the emulator's gaze, which is perfectly steady. Real eyes flick and jitter,
so how it feels on a real headset is untested.

## Run it locally

Requires Node 24.

```sh
npm ci
npm test            # model, interlock, nights, layout-in-view tests
npm run dev         # IWSDK dev server + emulator in a managed browser
npm run build       # static site in dist/
```

The emulator scripts in `scripts/` drive the running dev server through IWSDK's CLI
(`python3 scripts/emu-play.py --runs 1`). `iwsdk.config.json` → `dev.emulator.device`
picks the emulated device: `metaVRGlasses`, `metaQuestPro`, or `metaQuest3` for the
no-eye-tracking ray fallback (`python3 scripts/emu-look.py --ray`).

## Sources

- Grid collapses in 2024: [Guardian Nigeria](https://guardian.ng/?p=2492578) (secondary source).
- Generator backfeed danger: [OSHA, archived](https://webarchive.library.unt.edu/web/20080923094111/http:/osha.gov/SLTC/etools/hurricane/electrical.html).
- Appliance wattages: Virginia Cooperative Extension, pub. 2901-9014 (Feb 2020),
  http://pubs.ext.vt.edu/2901/2901-9014/2901-9014.html.

## Licence

MIT, © 2026 Samuel Aleonomoh. Third-party code (IWSDK, three.js, @pmndrs/uikit) is MIT.
