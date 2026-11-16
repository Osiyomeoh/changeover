# Changeover — build plan

Event: Meta VR Start Developer Competition 2026 · Gaming track · New Experience division.
Deadline Nov 18 2026 12:00 PST (21:00 Lagos). Feature freeze Nov 17 21:00 Lagos.

## Constraints (do not drift)
- Pure VR, seated, hands-only end to end. No MR claims: no headset was available for testing.
- Every interaction must recover safely when a hand drops out of tracking.
- No downloaded art or audio: primitives + procedural Web Audio only.
- No brands, no identifiable people, no fake data, no empty panels.
- Glasses mode (gaze + pinch, FoV crop) and the Daily Outage are never cut.
- Device fps is **not measured** (no headset); we report emulator budgets only.

## Schedule (Lagos dates)
| Date | Work | Exit check |
|---|---|---|
| Oct 31 | Spike: scaffold, interlock model + tests, emulator kill test | 20/20 runs × 4 scenarios pass → keep Changeover |
| Nov 1 | Remove starter content, CI (typecheck + tests), Pages deploy workflow | CI green, page loads |
| Nov 2–3 | `src/model/power-model.ts` + tests | ≥40 tests, numbers reproduce from `npm test` |
| Nov 4–6 | Diorama, board, appliance tokens, pinch place, load meter, battery clock | Night 1 playable hands-only in the emulator |
| Nov 7–8 | Generator, backfeed refusal, overload trip wired to the interlock | 4 demo moments as emulator tests |
| Nov 9–10 | Nights 1–5, scoring, first five minutes; hand-robustness pass | Fresh user finishes Night 1; drop test on every grabbable |
| Nov 11 | Glasses mode: gaze + pinch, FoV crop | Every critical element inside the crop |
| Nov 12 | Daily Outage (date-seeded), streak, 3 difficulty tiers, save/resume | Same date → same night (tested) |
| Nov 13 | Procedural audio, lighting, art pass | No third-party audio files |
| Nov 14 | Performance pass (≤100 draw calls, ≤150k triangles) | Measured in the emulator |
| Nov 15–16 | Bug fixes, README, stills, deploy checks 390/1280 px, 0 console errors | CHECKLIST all green |
| Nov 17 21:00 | Freeze, tag `submission-meta-vr-start` | — |
| Nov 17–18 | Sam records video, submits by 18:00 Lagos | — |

## Cut order if behind
1. Nights 4–5 · 2. freezer temperature drift · 3. spatial-audio polish · 4. generator sound design.

**Never cut:** Night 1, interlock + tracking-loss fallback, overload trip, hands-only menus,
tested power model, Glasses mode, Daily Outage.
