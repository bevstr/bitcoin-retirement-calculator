// A small SVG line/area chart: one series, hairline chrome, crosshair tooltip.
// Re-renders at the container's real pixel width so label sizes stay honest.

const NS = 'http://www.w3.org/2000/svg';
const PAD = {top: 16, right: 18, bottom: 28, left: 62};

const el = (name, attrs = {}) => {
  const node = document.createElementNS(NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};

/** Round tick steps a human would choose: 1, 2, 2.5, 5, 10 × 10^n. */
export function niceTicks(min, max, target = 5) {
  if (!isFinite(min) || !isFinite(max) || max <= min) return [min || 0];
  const raw = (max - min) / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm >= 7.5 ? 10 : norm >= 3.5 ? 5 : norm >= 2.25 ? 2.5 : norm >= 1.5 ? 2 : 1) * mag;
  const ticks = [];
  for (let t = Math.ceil(min / step) * step; t <= max + step * 1e-9; t += step) {
    ticks.push(Math.abs(t) < step * 1e-9 ? 0 : t);
  }
  return ticks;
}

/** Tick values for a log axis: 1, 3, 10, 30, 100 … spanning [min, max]. */
export function logTicks(min, max) {
  const lo = Math.floor(Math.log10(min));
  const hi = Math.ceil(Math.log10(max));
  const ticks = [];
  for (let e = lo; e <= hi; e++) {
    for (const m of [1, 3]) {
      const v = m * Math.pow(10, e);
      if (v >= min && v <= max) ticks.push(v);
    }
  }
  return ticks.length >= 3 ? ticks : niceTicks(min, max, 4);
}

export function createChart(root) {
  root.classList.add('chart');
  const wrap = document.createElement('div');
  wrap.className = 'chart-plot';
  const tip = document.createElement('div');
  tip.className = 'chart-tip';
  tip.hidden = true;
  root.append(wrap, tip);

  let opts = null;
  let geometry = null;

  function draw() {
    if (!opts) return;
    const width = Math.max(wrap.clientWidth || root.clientWidth || 640, 260);
    const height = opts.height || 240;
    const {points, color, formatY, formatX, formatTip, label, marker} = opts;

    wrap.innerHTML = '';
    if (!points.length) return;

    const log = opts.scale === 'log';
    const xs = points.map(p => p.x);
    const ys = points.map(p => p.y);
    const xMin = Math.min(...xs);
    const xMax = Math.max(...xs) || 1;
    const yMax = Math.max(...ys, 0) || 1;
    // A log axis has no zero to sit on, so the baseline is the smallest
    // positive value in view, floored two decades below the peak.
    const positives = ys.filter(y => y > 0);
    const yMin = log
      ? Math.max(Math.min(...positives, yMax), yMax / 1e6) / 1.6
      : 0;

    const plotW = width - PAD.left - PAD.right;
    const plotH = height - PAD.top - PAD.bottom;
    const sx = x => PAD.left + (plotW * (x - xMin)) / (xMax - xMin || 1);
    const sy = log
      ? y => {
          const v = Math.max(y, yMin);
          const span = Math.log10(yMax) - Math.log10(yMin) || 1;
          return PAD.top + plotH - (plotH * (Math.log10(v) - Math.log10(yMin))) / span;
        }
      : y => PAD.top + plotH - (plotH * y) / yMax;

    const svg = el('svg', {
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      'aria-label': `${label}. Values are also listed in the table view below.`,
    });

    // ── recessive chrome ────────────────────────────────────────────────
    const yTicks = log ? logTicks(yMin, yMax) : niceTicks(0, yMax, 4);
    for (const t of yTicks) {
      svg.append(
        el('line', {
          x1: PAD.left, x2: width - PAD.right, y1: sy(t), y2: sy(t),
          class: 'chart-grid',
        })
      );
      const text = el('text', {
        x: PAD.left - 8, y: sy(t) + 4, class: 'chart-tick', 'text-anchor': 'end',
      });
      text.textContent = formatY(t);
      svg.append(text);
    }

    const xTicks = niceTicks(xMin, xMax, 6);
    for (const t of xTicks) {
      if (t < xMin || t > xMax) continue;
      const text = el('text', {
        x: sx(t), y: height - 9, class: 'chart-tick', 'text-anchor': 'middle',
      });
      text.textContent = formatX(t);
      svg.append(text);
    }

    svg.append(
      el('line', {
        x1: PAD.left, x2: width - PAD.right,
        y1: sy(yMin), y2: sy(yMin), class: 'chart-axis',
      })
    );

    // ── the series ──────────────────────────────────────────────────────
    const line = points.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x)},${sy(p.y)}`).join('');
    svg.append(
      el('path', {
        d: `${line}L${sx(points[points.length - 1].x)},${sy(yMin)}L${sx(points[0].x)},${sy(yMin)}Z`,
        fill: color, 'fill-opacity': 0.14, stroke: 'none',
      })
    );
    svg.append(el('path', {d: line, fill: 'none', stroke: color, 'stroke-width': 2,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round'}));

    // ── one selective direct label, at the point that matters ───────────
    if (marker) {
      const mx = sx(marker.x);
      svg.append(
        el('line', {
          x1: mx, x2: mx, y1: PAD.top, y2: sy(yMin), class: 'chart-marker',
        })
      );
      const anchor = mx > width - PAD.right - 90 ? 'end' : 'start';
      const text = el('text', {
        x: mx + (anchor === 'end' ? -8 : 8), y: PAD.top + 12,
        class: 'chart-marker-label', 'text-anchor': anchor,
      });
      text.textContent = marker.label;
      svg.append(text);
    }

    const cross = el('line', {
      x1: 0, x2: 0, y1: PAD.top, y2: sy(yMin), class: 'chart-cross', opacity: 0,
    });
    const dot = el('circle', {
      r: 4.5, class: 'chart-dot', fill: color, opacity: 0,
    });
    svg.append(cross, dot);
    wrap.append(svg);

    geometry = {svg, cross, dot, sx, sy, points, plotW, width, height, formatTip};
  }

  // ── hover / focus readout ─────────────────────────────────────────────
  function nearest(clientX) {
    if (!geometry) return null;
    const box = geometry.svg.getBoundingClientRect();
    const x = clientX - box.left;
    let best = null;
    let bestD = Infinity;
    for (const p of geometry.points) {
      const d = Math.abs(geometry.sx(p.x) - x);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    return best;
  }

  function show(point) {
    if (!geometry || !point) return;
    const px = geometry.sx(point.x);
    const py = geometry.sy(point.y);
    geometry.cross.setAttribute('x1', px);
    geometry.cross.setAttribute('x2', px);
    geometry.cross.setAttribute('opacity', 1);
    geometry.dot.setAttribute('cx', px);
    geometry.dot.setAttribute('cy', py);
    geometry.dot.setAttribute('opacity', 1);

    tip.innerHTML = geometry.formatTip(point);
    tip.hidden = false;
    const tw = tip.offsetWidth;
    tip.style.left = `${Math.min(Math.max(px - tw / 2, 4), geometry.width - tw - 4)}px`;
    tip.style.top = `${Math.max(py - tip.offsetHeight - 12, 2)}px`;
  }

  function hide() {
    tip.hidden = true;
    geometry?.cross.setAttribute('opacity', 0);
    geometry?.dot.setAttribute('opacity', 0);
  }

  wrap.addEventListener('pointermove', e => show(nearest(e.clientX)));
  wrap.addEventListener('pointerleave', hide);
  root.tabIndex = 0;
  let cursor = 0;
  root.addEventListener('keydown', e => {
    if (!geometry) return;
    const n = geometry.points.length;
    if (e.key === 'ArrowRight') cursor = Math.min(cursor + 1, n - 1);
    else if (e.key === 'ArrowLeft') cursor = Math.max(cursor - 1, 0);
    else if (e.key === 'Home') cursor = 0;
    else if (e.key === 'End') cursor = n - 1;
    else if (e.key === 'Escape') return hide();
    else return;
    e.preventDefault();
    show(geometry.points[cursor]);
  });
  root.addEventListener('blur', hide);

  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => draw()).observe(wrap);
  } else {
    window.addEventListener('resize', draw);
  }

  return {
    update(next) {
      opts = next;
      cursor = 0;
      hide();
      draw();
    },
  };
}
