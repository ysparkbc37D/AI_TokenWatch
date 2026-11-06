/**
 * 차트 도우미 (외부 라이브러리 없이 SVG 를 직접 그린다)
 * window.TDViz 로 노출: lineChart, sparkline, donut, stackedBars, ring, fmtNum
 */
(() => {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  let uid = 0;

  function el(tag, attrs = {}, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.append(e);
    return e;
  }

  // 큰 수를 읽기 쉽게: 1234 → 1.2천, 12_345_678 → 1,235만, 1.2억
  function fmtNum(n) {
    if (n == null || !Number.isFinite(n)) return '–';
    const a = Math.abs(n);
    if (a >= 1e8) return `${(n / 1e8).toFixed(a >= 1e9 ? 0 : 1)}억`;
    if (a >= 1e4) return `${Math.round(n / 1e4).toLocaleString('ko-KR')}만`;
    if (a >= 1e3) return `${(n / 1e3).toFixed(1)}천`;
    return `${Math.round(n)}`;
  }

  // 단조 3차 곡선 (값이 튀어 오르지 않는 부드러운 선)
  function smoothPath(pts) {
    const n = pts.length;
    if (!n) return '';
    if (n === 1) return `M${pts[0].x},${pts[0].y}`;
    const d = [], t = new Array(n);
    for (let i = 0; i < n - 1; i++) d.push((pts[i + 1].y - pts[i].y) / ((pts[i + 1].x - pts[i].x) || 1));
    t[0] = d[0]; t[n - 1] = d[n - 2];
    for (let i = 1; i < n - 1; i++) t[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
    for (let i = 0; i < n - 1; i++) {
      if (d[i] === 0) { t[i] = 0; t[i + 1] = 0; continue; }
      const a = t[i] / d[i], b = t[i + 1] / d[i], s = a * a + b * b;
      if (s > 9) { const k = 3 / Math.sqrt(s); t[i] = k * a * d[i]; t[i + 1] = k * b * d[i]; }
    }
    let p = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
    for (let i = 0; i < n - 1; i++) {
      const h = pts[i + 1].x - pts[i].x;
      p += `C${(pts[i].x + h / 3).toFixed(1)},${(pts[i].y + t[i] * h / 3).toFixed(1)} ` +
           `${(pts[i + 1].x - h / 3).toFixed(1)},${(pts[i + 1].y - t[i + 1] * h / 3).toFixed(1)} ` +
           `${pts[i + 1].x.toFixed(1)},${pts[i + 1].y.toFixed(1)}`;
    }
    return p;
  }

  function glowFilter(defs, id) {
    const f = el('filter', { id, x: '-20%', y: '-40%', width: '140%', height: '180%' }, defs);
    el('feGaussianBlur', { stdDeviation: '3', result: 'b' }, f);
    const m = el('feMerge', {}, f);
    el('feMergeNode', { in: 'b' }, m);
    el('feMergeNode', { in: 'SourceGraphic' }, m);
  }

  /**
   * 시간축 선 그래프
   * series: [{ name, color, values:[number|null] }]  (모두 같은 times 길이)
   * times: [ms]  · opts: { yMax, yLabel(v), tLabel(t), ticks, tip, onHover }
   */
  function lineChart(box, times, series, opts = {}) {
    box.querySelector('svg')?.remove();
    const W = box.clientWidth, H = box.clientHeight;
    if (!W || !H) return;
    const pad = { l: 36, r: 10, t: 10, b: 24 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const yMax = opts.yMax || 100;
    const t0 = times[0], t1 = times[times.length - 1];
    const x = (t) => pad.l + ((t - t0) / ((t1 - t0) || 1)) * iw;
    const y = (v) => pad.t + (1 - Math.max(0, Math.min(yMax, v)) / yMax) * ih;
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img' });
    const defs = el('defs', {}, svg);
    const gid = `g${++uid}`;
    glowFilter(defs, gid);

    for (let i = 0; i <= 4; i++) {
      const v = (yMax / 4) * i;
      el('line', { class: 'grid-l', x1: pad.l, x2: W - pad.r, y1: y(v), y2: y(v) }, svg);
      el('text', { class: 'axis', x: pad.l - 8, y: y(v) + 3.5, 'text-anchor': 'end' }, svg).textContent = opts.yLabel ? opts.yLabel(v) : `${v}`;
    }
    const ticks = opts.ticks || 6;
    for (let i = 0; i <= ticks; i++) {
      const t = t0 + ((t1 - t0) * i) / ticks;
      el('text', { class: 'axis', x: x(t), y: H - 6, 'text-anchor': i === 0 ? 'start' : i === ticks ? 'end' : 'middle' }, svg)
        .textContent = opts.tLabel ? opts.tLabel(t) : '';
    }

    series.forEach((s, si) => {
      // null 로 끊긴 구간마다 따로 그린다
      const segs = [];
      let cur = [];
      s.values.forEach((v, i) => {
        if (v == null) { if (cur.length) segs.push(cur); cur = []; return; }
        cur.push({ x: x(times[i]), y: y(v) });
      });
      if (cur.length) segs.push(cur);
      const fid = `f${uid}_${si}`;
      const lg = el('linearGradient', { id: fid, x1: 0, x2: 0, y1: 0, y2: 1 }, defs);
      el('stop', { offset: 0, 'stop-color': s.color, 'stop-opacity': s.fill === false ? 0 : 0.22 }, lg);
      el('stop', { offset: 1, 'stop-color': s.color, 'stop-opacity': 0 }, lg);
      for (const seg of segs) {
        const d = smoothPath(seg);
        if (seg.length > 1 && s.fill !== false) {
          el('path', { d: `${d}L${seg[seg.length - 1].x.toFixed(1)},${pad.t + ih}L${seg[0].x.toFixed(1)},${pad.t + ih}Z`, fill: `url(#${fid})` }, svg);
        }
        el('path', { d, fill: 'none', stroke: s.color, 'stroke-width': s.width || 2.4, 'stroke-linecap': 'round', 'stroke-dasharray': s.dash || '', filter: `url(#${gid})` }, svg);
        if (seg.length === 1) el('circle', { cx: seg[0].x, cy: seg[0].y, r: 3, fill: s.color }, svg);
      }
    });

    const cursor = el('line', { class: 'cursor', y1: pad.t, y2: pad.t + ih, visibility: 'hidden' }, svg);
    const dots = series.map((s) => el('circle', { r: 4.5, fill: s.color, stroke: '#070d1a', 'stroke-width': 2, visibility: 'hidden' }, svg));
    box.prepend(svg);

    const tip = opts.tip;
    if (!tip) return;
    svg.addEventListener('mousemove', (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      let i = Math.round(((px - pad.l) / iw) * (times.length - 1));
      i = Math.max(0, Math.min(times.length - 1, i));
      const any = series.some((s) => s.values[i] != null);
      if (!any) { hide(); return; }
      const cx = x(times[i]);
      cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx); cursor.setAttribute('visibility', 'visible');
      tip.replaceChildren();
      const head = document.createElement('b');
      head.textContent = opts.tipTime ? opts.tipTime(times[i]) : '';
      tip.append(head);
      series.forEach((s, si) => {
        const v = s.values[i];
        if (v == null) { dots[si].setAttribute('visibility', 'hidden'); return; }
        dots[si].setAttribute('cx', cx); dots[si].setAttribute('cy', y(v)); dots[si].setAttribute('visibility', 'visible');
        const row = document.createElement('div');
        row.style.setProperty('--c', s.color);
        row.innerHTML = '<i></i><span></span>';
        row.querySelector('span').textContent = `${s.name} ${Math.round(v)}%`;
        tip.append(row);
      });
      tip.hidden = false;
      const tw = tip.offsetWidth;
      const left = (cx / W) * box.clientWidth;
      tip.style.left = `${left + 14 + tw > box.clientWidth ? Math.max(0, left - tw - 14) : left + 14}px`;
    });
    svg.addEventListener('mouseleave', hide);
    function hide() {
      tip.hidden = true;
      cursor.setAttribute('visibility', 'hidden');
      dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
    }
  }

  // KPI 타일의 작은 그래프
  function sparkline(svg, values, color, kind = 'line') {
    svg.replaceChildren();
    const W = 120, H = 44;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    const vals = values.map((v) => (v == null || !Number.isFinite(v) ? null : v));
    const nums = vals.filter((v) => v != null);
    if (!nums.length) return;
    const max = Math.max(...nums, kind === 'bars' ? 1 : 0), min = kind === 'bars' ? 0 : Math.min(...nums);
    const span = max - min || 1;
    if (kind === 'bars') {
      const bw = W / vals.length;
      vals.forEach((v, i) => {
        if (v == null) return;
        const h = Math.max(2, ((v - min) / span) * (H - 4));
        el('rect', { x: i * bw + bw * 0.18, y: H - h, width: bw * 0.64, height: h, rx: 1.5, fill: color, opacity: i === vals.length - 1 ? 1 : 0.55 }, svg);
      });
      return;
    }
    const pts = [];
    vals.forEach((v, i) => { if (v != null) pts.push({ x: (i / Math.max(1, vals.length - 1)) * W, y: 4 + (1 - (v - min) / span) * (H - 8) }); });
    const id = `sp${++uid}`;
    const defs = el('defs', {}, svg);
    glowFilter(defs, id);
    const d = smoothPath(pts);
    el('path', { d, fill: 'none', stroke: color, 'stroke-width': 2, filter: `url(#${id})` }, svg);
    const last = pts[pts.length - 1];
    el('circle', { cx: last.x, cy: last.y, r: 3, fill: color }, svg);
  }

  // 도넛: segments [{ label, value, color }]
  function donut(box, segments, centerTop, centerBottom) {
    box.replaceChildren();
    const S = 150, R = 60, SW = 16, C = 2 * Math.PI * R;
    const svg = el('svg', { viewBox: `0 0 ${S} ${S}`, width: '100%', height: '100%' });
    const defs = el('defs', {}, svg);
    const id = `dn${++uid}`;
    glowFilter(defs, id);
    el('circle', { cx: S / 2, cy: S / 2, r: R, fill: 'none', stroke: '#13203a', 'stroke-width': SW }, svg);
    const total = segments.reduce((a, s) => a + s.value, 0);
    let acc = 0;
    if (total > 0) {
      for (const s of segments) {
        const len = (s.value / total) * C;
        const gap = segments.length > 1 ? Math.min(3, len * 0.3) : 0;
        el('circle', {
          cx: S / 2, cy: S / 2, r: R, fill: 'none', stroke: s.color, 'stroke-width': SW,
          'stroke-dasharray': `${Math.max(0, len - gap)} ${C}`, 'stroke-dashoffset': -acc,
          transform: `rotate(-90 ${S / 2} ${S / 2})`, filter: `url(#${id})`
        }, svg);
        acc += len;
      }
    }
    box.append(svg);
    const c = document.createElement('div');
    c.className = 'donut-center';
    c.innerHTML = '<b></b><span></span>';
    c.querySelector('b').textContent = centerTop;
    c.querySelector('span').textContent = centerBottom;
    box.append(c);
  }

  /**
   * 누적 막대: labels [str], stacks [{ name, color, values:[number] }]
   */
  function stackedBars(box, labels, stacks, opts = {}) {
    box.querySelector('svg')?.remove();
    const W = box.clientWidth, H = box.clientHeight;
    if (!W || !H) return;
    const pad = { l: 40, r: 6, t: 8, b: 22 };
    const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b;
    const totals = labels.map((_, i) => stacks.reduce((a, s) => a + (s.values[i] || 0), 0));
    const max = Math.max(1, ...totals);
    const svg = el('svg', { viewBox: `0 0 ${W} ${H}` });
    for (let k = 0; k <= 3; k++) {
      const v = (max / 3) * k, yy = pad.t + (1 - v / max) * ih;
      el('line', { class: 'grid-l', x1: pad.l, x2: W - pad.r, y1: yy, y2: yy }, svg);
      el('text', { class: 'axis', x: pad.l - 6, y: yy + 3.5, 'text-anchor': 'end' }, svg).textContent = fmtNum(v);
    }
    const bw = iw / labels.length;
    const every = Math.ceil(labels.length / 8);
    const groups = [];
    labels.forEach((lb, i) => {
      let yy = pad.t + ih;
      const g = el('g', {}, svg);
      stacks.forEach((s) => {
        const v = s.values[i] || 0;
        if (v <= 0) return;
        const h = (v / max) * ih;
        yy -= h;
        el('rect', { x: pad.l + i * bw + bw * 0.16, y: yy, width: bw * 0.68, height: Math.max(0.5, h), rx: 2, fill: s.color, opacity: 0.9 }, g);
      });
      groups.push(g);
      if (i % every === 0 || i === labels.length - 1) {
        el('text', { class: 'axis', x: pad.l + i * bw + bw / 2, y: H - 6, 'text-anchor': 'middle' }, svg).textContent = opts.short ? opts.short(lb) : lb;
      }
    });
    box.prepend(svg);
    const tip = opts.tip;
    if (!tip) return;
    svg.addEventListener('mousemove', (ev) => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      const i = Math.floor((px - pad.l) / bw);
      if (i < 0 || i >= labels.length) { tip.hidden = true; return; }
      groups.forEach((g, gi) => g.setAttribute('opacity', gi === i ? 1 : 0.45));
      tip.replaceChildren();
      const head = document.createElement('b');
      head.textContent = `${labels[i]} · ${fmtNum(totals[i])}`;
      tip.append(head);
      stacks.forEach((s) => {
        if (!s.values[i]) return;
        const row = document.createElement('div');
        row.style.setProperty('--c', s.color);
        row.innerHTML = '<i></i><span></span>';
        row.querySelector('span').textContent = `${s.name} ${fmtNum(s.values[i])}`;
        tip.append(row);
      });
      tip.hidden = false;
      const left = ((pad.l + i * bw + bw / 2) / W) * box.clientWidth;
      const tw = tip.offsetWidth;
      tip.style.left = `${left + 12 + tw > box.clientWidth ? Math.max(0, left - tw - 12) : left + 12}px`;
    });
    svg.addEventListener('mouseleave', () => { tip.hidden = true; groups.forEach((g) => g.setAttribute('opacity', 1)); });
  }

  // 작은 원형 게이지 (0~100)
  function ring(value, color, label, sub) {
    const wrap = document.createElement('div');
    wrap.className = 'ring';
    const S = 112, R = 44, C = 2 * Math.PI * R;
    const svg = el('svg', { viewBox: `0 0 ${S} ${S}` });
    const defs = el('defs', {}, svg);
    const id = `rg${++uid}`;
    glowFilter(defs, id);
    el('circle', { cx: S / 2, cy: S / 2, r: R, fill: 'none', stroke: '#13203a', 'stroke-width': 10 }, svg);
    const v = value == null ? 0 : Math.max(0, Math.min(100, value));
    if (v > 0) {
      el('circle', {
        cx: S / 2, cy: S / 2, r: R, fill: 'none', stroke: color, 'stroke-width': 10, 'stroke-linecap': 'round',
        'stroke-dasharray': `${(v / 100) * C} ${C}`, transform: `rotate(-90 ${S / 2} ${S / 2})`, filter: `url(#${id})`
      }, svg);
    }
    const t = el('text', { x: S / 2, y: S / 2 + 7, 'text-anchor': 'middle', fill: '#e6edf8', 'font-size': 21, 'font-weight': 700 }, svg);
    t.textContent = value == null ? '–' : `${Math.round(value)}%`;
    wrap.append(svg);
    const b = document.createElement('b'); b.textContent = label; wrap.append(b);
    const s = document.createElement('span'); s.textContent = sub || ''; wrap.append(s);
    return wrap;
  }

  window.TDViz = { lineChart, sparkline, donut, stackedBars, ring, fmtNum, smoothPath };
})();
