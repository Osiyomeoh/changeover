// Diagnostic: per frame, whether localStorage is blocked and who touched it / what threw uncaught.
export default async function run({ page, frame }) {
  const out = [];
  for (const f of page.frames()) {
    const r = await f
      .evaluate(() => {
        let ls;
        try {
          void window.localStorage;
          ls = 'ok';
        } catch (e) {
          ls = `blocked (${e.name})`;
        }
        return { ls, callers: window.__lsCallers ?? [], uncaught: window.__lsUncaught ?? [], t0: performance.timeOrigin };
      })
      .catch((e) => ({ error: e.message }));
    out.push({ url: f.url(), isApp: f === frame, isMain: f === page.mainFrame(), ...r });
  }
  return out;
}
