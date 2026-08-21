# ₿ Bitcoin Retirement Calculator

How long does a bitcoin stack last if you spend it down? Enter what you hold,
what you spend, and what you think bitcoin does — get the runway, the date it
hits zero, and the rate you could sustain forever.

**Live:** [<https://satoshipuzzles.github.io/bitcoin-retirement-calculator/>
](https://bevstr.github.io/bitcoin-retirement-calculator/)
## What it models

Monthly steps. In each month you sell enough bitcoin at that month's price to
cover the month's spending, then the price compounds by one month of the
projected CAGR and the spending compounds by one month of inflation — so the
withdrawal keeps its **purchasing power** rather than its nominal size.

| Input | Meaning |
| --- | --- |
| Bitcoin held | The stack today |
| Price today | Typed in, or pulled live from mempool.space (Coinbase as fallback) |
| Spend | Per day, week, month or year, in today's money |
| Bitcoin CAGR | Projected annual growth — negative is allowed, and worth trying |
| Inflation | Annual increase applied to spending |
| Tax + fees | Percentage skimmed off every sale; withdrawals are grossed up so what you spend is what lands |
| Project for | Horizon, 1–100 years |

Outputs: time to depletion (to the month, including a partial final month), the
calendar date, the most you could spend **forever**, the stack size that would
make the drawdown perpetual, total spent, and bitcoin sold.

### The perpetual case, in closed form

Bitcoin sold in month *m* is `(spend₀ / price₀) · rᵐ` where
`r = (1 + inflation) / (1 + growth)`. The whole infinite drawdown therefore costs

```
(spend₀ / price₀) / (1 − r)   bitcoin,   and converges only when r < 1
```

— that is, only when growth outruns inflation. That closed form gives the
"spend forever" and "stack needed" figures directly, and
`test/model.test.mjs` cross-checks it against the step-by-step simulation:
funding the stack at exactly the computed threshold must survive a 100-year run,
and 2% less must not.

## What it does not model

Constant-rate compounding. Bitcoin does not move at a constant rate, so a
projection assuming it does will be wrong about the *path* even when it is right
about the average — sequence-of-returns risk is real and is not simulated here.
There is no volatility, no drawdown modelling, no tax-lot accounting, no
borrowing against the stack. Treat a long-dated CAGR as a scenario, not a
forecast. This is arithmetic, not advice.

## Design notes

Charts follow a validated palette: series colours are categorical slots 2
(orange, bitcoin remaining) and 1 (blue, stack value), each checked against the
light and dark chart surfaces for the lightness band, chroma floor, CVD
separation and contrast. Light and dark are separately stepped sets, not an
automatic flip.

The two measures live in **two charts, never one with two y-axes** — the stack
value chart switches to a log scale only when the stack *grows* through orders
of magnitude, and stays linear when it depletes to zero (which a log axis cannot
show). Every chart has a crosshair tooltip, keyboard readout (arrow keys /
Home / End), and a table-view twin so no value is reachable only by hover.

## Develop

```bash
npm install
npm test          # 13 model unit tests, then a jsdom boot test of the built bundle
npm run build     # -> dist/
npx serve dist
```

Everything runs client side. Inputs are mirrored into the query string, so a
link reproduces a scenario exactly.

## Deploy

**GitHub Pages** — pushing to `main` builds, tests and publishes `dist/`.

**Vercel** — `vercel.json` pins the build, so the import needs no configuration:

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/import?s=https%3A%2F%2Fgithub.com%2Fsatoshipuzzles%2Fbitcoin-retirement-calculator)

| Setting | Value |
| --- | --- |
| Framework preset | Other |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |

No environment variables are needed.

## Licence

MIT.
