const { chromium, devices } = require('playwright');
const [P, BYP, JK] = process.argv.slice(2);
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ ...devices['iPhone 13'], extraHTTPHeaders: { 'x-vercel-protection-bypass': BYP, 'x-judges-key': JK } });
  const p = await ctx.newPage();
  for (const v of ['/', '/judges?view=shortlist', '/judges?view=order', '/judges?view=order&present=1', '/judges?view=score', '/judges?view=results']) {
    await p.goto(P + v, { waitUntil: 'networkidle' });
    const w = await p.evaluate(() => document.documentElement.scrollWidth);
    console.log((w <= 390 ? 'PASS ' : 'FAIL ') + v + ' scrollWidth=' + w);
  }
  await b.close();
})();
