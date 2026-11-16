// Open the app in the managed browser with a query string, optionally with
// localStorage blocked (every access throws, as in a locked-down private window).
// Usage: CO_QUERY='?speed=600' CO_BLOCK_STORAGE=1 iwsdk browser run scripts/pw-open.mjs
// CO_BLOCK_STORAGE=key throws only for the game's streak key: the emulator (IWER 2.7.0)
// itself reads localStorage unguarded when a session starts, so a fully blocked
// page cannot enter XR in the emulator at all. Production builds do not include IWER.
// CO_READ_ONLY=1 skips navigation and only reports storage. CO_CLEAR=all removes the
// game's streak, saved night and campaign progress before navigating.
// Prints the final URL, the emulated device's user agent, and what the page's
// localStorage holds for the game's keys.
export default async function run({ page, frame }) {
  // The managed window hosts the app in a child frame; navigate that frame.
  const app = frame ?? page.mainFrame();
  const readOnly = process.env.CO_READ_ONLY === '1';
  const query = process.env.CO_QUERY ?? '';
  const block = process.env.CO_BLOCK_STORAGE === '1';
  const blockKey = process.env.CO_BLOCK_STORAGE === 'key';
  if (block && !readOnly) {
    await page.addInitScript(() => {
      const keep = (kind, err) => {
        const w = window;
        w.__lsUncaught = (w.__lsUncaught ?? []).concat(`${kind}: ${String(err?.stack ?? err).slice(0, 700)}`);
      };
      window.addEventListener('error', (e) => keep('error', e.error ?? e.message));
      window.addEventListener('unhandledrejection', (e) => keep('rejection', e.reason));
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        get() {
          // Record who asked, so an unguarded caller can be named.
          const w = window;
          w.__lsCallers = (w.__lsCallers ?? []).concat(String(new Error().stack).split('\n').slice(2, 6).join(' | '));
          throw new DOMException('blocked for test', 'SecurityError');
        },
      });
    });
  }
  if (blockKey && !readOnly) {
    await page.addInitScript(() => {
      const KEY = 'changeover.streak.v1';
      const w = window;
      const keep = (kind, err) => {
        w.__lsUncaught = (w.__lsUncaught ?? []).concat(`${kind}: ${String(err?.stack ?? err).slice(0, 700)}`);
      };
      w.addEventListener('error', (e) => keep('error', e.error ?? e.message));
      w.addEventListener('unhandledrejection', (e) => keep('rejection', e.reason));
      for (const name of ['getItem', 'setItem']) {
        const orig = Storage.prototype[name];
        Storage.prototype[name] = function (k, ...rest) {
          if (k === KEY) {
            w.__lsCallers = (w.__lsCallers ?? []).concat(`${name}: ${String(new Error().stack).split('\n').slice(2, 4).join(' | ')}`);
            throw new DOMException('blocked for test', 'SecurityError');
          }
          return orig.call(this, k, ...rest);
        };
      }
    });
  }
  const url = new URL(app.url());
  url.search = query;
  if (process.env.CO_CLEAR === '1' && !block && !blockKey && !readOnly) {
    await app.evaluate(() => localStorage.removeItem('changeover.streak.v1'));
  }
  if (process.env.CO_CLEAR === 'all' && !block && !blockKey && !readOnly) {
    await app.evaluate(() => {
      for (const k of ['changeover.streak.v1', 'changeover.session.v1', 'changeover.nights.v1']) localStorage.removeItem(k);
    });
  }
  if (!readOnly) await app.goto(url.toString(), { waitUntil: 'load' });
  const read = (key) =>
    app.evaluate((k) => {
      try {
        return localStorage.getItem(k);
      } catch (e) {
        return `threw: ${e.name}`;
      }
    }, key);
  const stored = await read('changeover.streak.v1');
  const session = await read('changeover.session.v1');
  const nights = await read('changeover.nights.v1');
  if (!readOnly) await app.waitForTimeout(3000);
  const callers = await app.evaluate(() => window.__lsCallers ?? []);
  const uncaught = await app.evaluate(() => window.__lsUncaught ?? []);
  // The emulated device's user agent: names the headset IWER is emulating
  // (Meta VR Glasses inherits the Quest 3 string; Quest Pro says "Quest Pro").
  const ua = await app.evaluate(() => navigator.userAgent);
  return { url: app.url(), ua, isMain: app === page.mainFrame(), blocked: block ? 'all' : blockKey ? 'key' : 'no', stored, session, nights, callers, uncaught };
}
