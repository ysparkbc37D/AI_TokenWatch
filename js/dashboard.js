/**
 * AI 토큰 관제 대시보드 (메인)
 * 서버(serve.ps1)에서 읽는 것:
 *   /api/quota       5초마다  Claude(확장 프로그램) · Antigravity 현재 한도
 *   /api/history*    1분마다  Claude · Antigravity · ChatGPT(Codex) 한도 기록
 *   /api/tokens      2분마다  로컬 Claude Code / Codex 토큰 집계
 * 차트는 viz.js, 분석 · 가이드 · Gemini 는 analysis.js.
 */
(() => {
  'use strict';
  const V = window.TDViz, A = window.TDA;
  const API = location.protocol === 'file:' ? 'http://localhost:8089' : '';
  const MIN = 60e3, HOUR = 60 * MIN, DAY = 24 * HOUR;
  const STALE = 3 * MIN, GAP = 25 * MIN;
  const COLOR = { claude: '#f59e0b', claudeW: '#fb923c', gpt: '#34d399', gpt2: '#2dd4bf', ag: ['#38bdf8', '#a78bfa', '#f472b6', '#60a5fa'] };
  const SHADES = { Claude: ['#f59e0b', '#fbbf24', '#fb923c', '#fde68a'], ChatGPT: ['#34d399', '#2dd4bf', '#10b981', '#6ee7b7', '#5eead4', '#059669'] };

  const $ = (s, r = document) => r.querySelector(s);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* 저장 불가 */ } }
  };

  const S = {
    quota: null, hist: [], histAg: [], histCx: [], report: null, serverOk: null,
    range: store.get('td.range', DAY), period: store.get('td.period', 7),
    hidden: new Set(store.get('td.hidden', []))
  };

  // ---------- 형식 ----------
  const num = (v) => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
  const lvClass = (used) => (used >= 85 ? 'lv-bad' : used >= 60 ? 'lv-warn' : 'lv-ok');
  function fmtDur(ms) {
    if (ms <= 0) return '곧';
    const m = Math.ceil(ms / MIN), d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60;
    return d ? `${d}일 ${h}시간` : h ? `${h}시간 ${mm}분` : `${mm}분`;
  }
  const clock = (ts) => new Date(ts).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  function when(ts) {
    const d = new Date(ts), t0 = new Date(); t0.setHours(0, 0, 0, 0);
    const diff = Math.floor((new Date(d).setHours(0, 0, 0, 0) - t0) / DAY);
    if (diff === 0) return `오늘 ${clock(ts)}`;
    if (diff === 1) return `내일 ${clock(ts)}`;
    return `${d.getMonth() + 1}/${d.getDate()}(${'일월화수목금토'[d.getDay()]}) ${clock(ts)}`;
  }
  function ago(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    return s < 60 ? `${s}초 전` : s < 3600 ? `${Math.round(s / 60)}분 전` : s < 86400 ? `${Math.round(s / 3600)}시간 전` : `${Math.round(s / 86400)}일 전`;
  }
  const windowName = (min) => (min === 300 ? '5시간' : min === 10080 ? '주간' : min === 43200 ? '30일' : min >= 1440 ? `${Math.round(min / 1440)}일` : `${Math.round(min / 60)}시간`);
  function chip(id, kind, title) { const c = document.getElementById(id); c.dataset.kind = kind; c.title = title || ''; }

  // ---------- 현재 한도 정리 ----------
  function live() {
    const now = Date.now();
    const c = (S.quota && S.quota.claude) || {};
    const fiveReset = num(c.fiveHourResetTime), weekReset = num(c.weeklyResetTime);
    const claude = c.lastUpdated ? {
      five: fiveReset && fiveReset <= now ? 0 : num(c.fiveHourPct),
      week: weekReset && weekReset <= now ? 0 : num(c.weeklyPct),
      fiveReset, weekReset, at: new Date(c.lastUpdated).getTime()
    } : null;
    const cl = S.report && S.report.codexLimits;
    const gptWins = [];
    if (cl) for (const k of ['primary', 'secondary']) {
      const w = cl[k];
      if (!w) continue;
      const expired = w.resetsAt && w.resetsAt <= now;
      gptWins.push({ key: k, used: expired ? 0 : num(w.used), windowMin: num(w.windowMin), resetsAt: num(w.resetsAt), at: cl.at });
    }
    const agRaw = S.quota && S.quota.antigravity;
    const ag = agRaw && Array.isArray(agRaw.models) ? agRaw.models.map((m) => {
      const reset = num(m.resetTime);
      return { names: Array.isArray(m.names) ? m.names : [m.names], left: reset && reset <= now ? 100 : num(m.left), resetTime: reset };
    }) : [];
    return { claude, gpt: gptWins[0] || null, gptWins, ag, agRunning: !!(agRaw && agRaw.running), agAt: agRaw && agRaw.lastUpdated ? new Date(agRaw.lastUpdated).getTime() : null };
  }

  // ---------- 기록 → 일정 간격 값 ----------
  function sampleAt(samples, pick, times) {
    let j = 0, last = null;
    return times.map((t) => {
      while (j < samples.length && samples[j].t <= t) { last = samples[j]; j++; }
      if (!last || t - last.t > GAP) return null;
      const v = pick(last);
      return v == null ? null : v;
    });
  }
  function bucketTimes(range, n) {
    const now = Date.now(), t0 = now - range;
    return Array.from({ length: n }, (_, i) => t0 + (range * i) / (n - 1));
  }

  function trendSeries(times) {
    const out = [
      { id: 'c5', name: 'Claude 5시간', color: COLOR.claude, values: sampleAt(S.hist, (p) => num(p.f), times) },
      { id: 'cw', name: 'Claude 주간', color: COLOR.claudeW, dash: '5 4', fill: false, width: 2, values: sampleAt(S.hist, (p) => num(p.w), times) },
      { id: 'gp', name: 'ChatGPT', color: COLOR.gpt, values: sampleAt(S.histCx, (p) => num(p.p), times) },
      { id: 'gs', name: 'ChatGPT 2', color: COLOR.gpt2, fill: false, values: sampleAt(S.histCx, (p) => num(p.s), times) }
    ];
    const agNames = [...new Set(S.histAg.flatMap((p) => Object.keys(p.m || {})))];
    agNames.forEach((name, i) => out.push({
      id: `ag:${name}`, name, color: COLOR.ag[i % COLOR.ag.length], fill: false,
      values: sampleAt(S.histAg, (p) => (p.m && p.m[name] != null ? 100 - p.m[name] : null), times)
    }));
    return out.filter((s) => s.values.some((v) => v != null));
  }

  // ---------- KPI ----------
  function kpi(id, value, valueCls, sub, spark, sparkColor, kind) {
    const el = document.getElementById(id);
    const v = $('.kpi-value', el);
    v.className = `kpi-value ${valueCls || ''}`;
    v.replaceChildren();
    if (Array.isArray(value)) { v.append(value[0]); const sm = document.createElement('small'); sm.textContent = value[1]; v.append(sm); }
    else v.textContent = value;
    const s = $('.kpi-sub', el);
    s.replaceChildren(...(Array.isArray(sub) ? sub : [sub]).map((x) => (typeof x === 'string' ? document.createTextNode(x) : x)));
    V.sparkline($('.kpi-spark', el), spark || [], sparkColor, kind);
  }
  const span = (text, cls) => { const e = document.createElement('b'); e.textContent = text; if (cls) e.className = cls; return e; };

  function renderKpis(L, sum) {
    const now = Date.now();
    const t6 = bucketTimes(6 * HOUR, 30), t24 = bucketTimes(DAY, 30);

    if (L.claude && L.claude.five != null) {
      const c = L.claude;
      kpi('kpiClaude', [`${Math.round(c.five)}`, '%'], lvClass(c.five),
        [`주간 `, span(c.week == null ? '–' : `${Math.round(c.week)}%`), c.fiveReset && c.fiveReset > now ? ` · ${fmtDur(c.fiveReset - now)} 후 초기화` : ''],
        sampleAt(S.hist, (p) => num(p.f), t6), COLOR.claude);
    } else kpi('kpiClaude', '–', '', '확장 프로그램 신호 대기 중', [], COLOR.claude);

    if (L.gpt && L.gpt.used != null) {
      const g = L.gpt;
      kpi('kpiGpt', [`${Math.round(g.used)}`, '%'], lvClass(g.used),
        [`${windowName(g.windowMin)} 한도 · `, g.resetsAt ? `${fmtDur(g.resetsAt - now)} 후 초기화` : ''],
        sampleAt(S.histCx, (p) => num(p.p), t24), COLOR.gpt);
    } else kpi('kpiGpt', '–', '', S.report ? 'Codex 한도 기록 없음' : '집계 중…', [], COLOR.gpt);

    const agSorted = L.ag.filter((m) => m.left != null).sort((a, b) => a.left - b.left);
    if (agSorted.length) {
      const m = agSorted[0];
      kpi('kpiAg', [`${Math.round(m.left)}`, '% 남음'], lvClass(100 - m.left),
        [span(m.names[0]), m.resetTime ? ` · ${fmtDur(m.resetTime - now)} 후 초기화` : ''],
        sampleAt(S.histAg, (p) => (p.m && p.m[m.names[0]] != null ? 100 - p.m[m.names[0]] : null), t24), '#38bdf8');
    } else kpi('kpiAg', '–', '', 'Antigravity 를 켜면 자동으로 읽습니다', [], '#38bdf8');

    if (sum) {
      const s7 = A.summarize(S.report, 7);
      const d = s7.deltaPct;
      kpi('kpiTokens', V.fmtNum(s7.cur.w), '',
        d == null ? '지난주 기록 없음' : [span(`${d >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(d))}%`, d > 10 ? 'up' : d < -10 ? 'down' : 'flat'), ' 지난주 대비 · 입력 환산'],
        s7.days.map((day) => s7.daily[day].Claude + s7.daily[day].ChatGPT), '#a78bfa', 'bars');
    } else kpi('kpiTokens', '–', '', '로컬 기록 집계 중…', [], '#a78bfa');
  }

  // ---------- 한도 현황 ----------
  function limitRow(color, who, what, used, resetAt, windowMs, note) {
    const now = Date.now();
    const li = document.createElement('li');
    li.innerHTML = '<div class="lim-top"><span class="who"></span><span class="what"></span><span class="pct"></span></div><div class="lim-bar"><i></i></div><div class="lim-meta"><span class="reset"></span><span class="pace"></span></div>';
    li.style.setProperty('--c', color);
    $('.who', li).textContent = who;
    $('.what', li).textContent = what;
    $('.what', li).title = what;
    const pct = $('.pct', li);
    pct.textContent = used == null ? '–' : `${Math.round(used)}%`;
    if (used != null) pct.classList.add(lvClass(used));
    $('i', li).style.width = `${used == null ? 0 : Math.max(0, Math.min(100, used))}%`;
    if (resetAt && windowMs && resetAt > now) {
      const frac = 1 - (resetAt - now) / windowMs;
      if (frac > 0 && frac < 1) { const s = document.createElement('s'); s.style.left = `${frac * 100}%`; $('.lim-bar', li).append(s); }
    }
    $('.reset', li).textContent = resetAt ? (resetAt > now ? `${fmtDur(resetAt - now)} 후 초기화 · ${when(resetAt)}` : '초기화됨') : (note || '');
    const p = A.projection(used, resetAt, windowMs, now);
    const pace = $('.pace', li);
    if (used >= 100) { pace.textContent = '소진'; pace.className = 'pace lv-bad'; }
    else if (p && !p.early) {
      pace.textContent = p.hitAt ? `${when(p.hitAt)} 소진 예상` : `예상 ${Math.round(p.proj)}%`;
      pace.className = `pace ${p.hitAt ? 'lv-bad' : p.proj >= 80 ? 'lv-warn' : 'lv-ok'}`;
    }
    return li;
  }
  function groupTitle(text) { const li = document.createElement('li'); li.className = 'group-title'; li.textContent = text; return li; }

  function renderLimits(L) {
    const ul = $('#limits');
    const rows = [];
    rows.push(groupTitle('Claude'));
    if (L.claude) {
      rows.push(limitRow(COLOR.claude, '5시간', '세션 한도', L.claude.five, L.claude.fiveReset, 5 * HOUR));
      rows.push(limitRow(COLOR.claudeW, '주간', '모든 모델', L.claude.week, L.claude.weekReset, 7 * DAY));
    } else rows.push(limitRow(COLOR.claude, '연결 대기', '확장 프로그램 설치 필요', null, null, null));
    rows.push(groupTitle('ChatGPT · Codex'));
    if (L.gptWins.length) L.gptWins.forEach((g, i) => rows.push(limitRow(i ? COLOR.gpt2 : COLOR.gpt, windowName(g.windowMin), 'Codex 사용 한도', g.used, g.resetsAt, g.windowMin * MIN, `기록 ${ago(Date.now() - g.at)}`)));
    else rows.push(limitRow(COLOR.gpt, '기록 없음', 'Codex 를 쓰면 채워집니다', null, null, null));
    rows.push(groupTitle(`Gemini · Antigravity${L.ag.length && !L.agRunning ? ' (꺼짐 · 마지막 값)' : ''}`));
    if (L.ag.length) L.ag.forEach((m, i) => rows.push(limitRow(COLOR.ag[i % COLOR.ag.length], m.names[0], m.names.slice(1).join(' · ') || '모델 한도', m.left == null ? null : 100 - m.left, m.resetTime, null)));
    else rows.push(limitRow(COLOR.ag[0], '꺼짐', 'Antigravity 를 켜면 읽습니다', null, null, null));
    ul.replaceChildren(...rows);
  }

  // ---------- 추이 ----------
  function renderTrend() {
    const times = bucketTimes(S.range, S.range <= 6 * HOUR ? 73 : S.range <= DAY ? 97 : 169);
    const all = trendSeries(times);
    const legend = $('#trendLegend');
    legend.replaceChildren(...all.map((s) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.style.setProperty('--c', s.color);
      b.setAttribute('aria-pressed', String(!S.hidden.has(s.id)));
      b.innerHTML = '<i></i><span></span>';
      $('span', b).textContent = s.name;
      b.addEventListener('click', () => {
        if (S.hidden.has(s.id)) S.hidden.delete(s.id); else S.hidden.add(s.id);
        store.set('td.hidden', [...S.hidden]);
        renderTrend();
      });
      return b;
    }));
    const shown = all.filter((s) => !S.hidden.has(s.id));
    $('#trendEmpty').hidden = all.length > 0;
    const two = (n) => String(n).padStart(2, '0');
    V.lineChart($('#trend'), times, shown, {
      yLabel: (v) => `${v}%`,
      tLabel: (t) => { const d = new Date(t); return S.range > DAY ? `${d.getMonth() + 1}/${d.getDate()}` : `${two(d.getHours())}:${two(d.getMinutes())}`; },
      tipTime: (t) => when(t),
      tip: $('#trendTip'),
      ticks: S.range > DAY ? 7 : 6
    });
  }

  // ---------- 토큰 분석 ----------
  function renderAnalysis(sum) {
    if (!sum) {
      $('#donut').replaceChildren(); $('#donutLegend').replaceChildren(); $('#stats').replaceChildren();
      $('#modelRows').innerHTML = '<tr><td colspan="5" class="empty">로컬 기록을 집계하는 중…</td></tr>';
      return;
    }
    // 도넛: 모델 상위 5 + 기타
    const used = { Claude: 0, ChatGPT: 0 };
    const segs = sum.byModel.slice(0, 5).map((m) => ({ label: m.name, sub: m.provider, value: m.w, color: (SHADES[m.provider] || ['#64748b'])[used[m.provider]++ % 6] || '#64748b' }));
    const rest = sum.byModel.slice(5).reduce((a, m) => a + m.w, 0);
    if (rest > 0) segs.push({ label: '기타', value: rest, color: '#475569' });
    V.donut($('#donut'), segs, V.fmtNum(sum.cur.w), sum.period === 7 ? '7일 · 입력 환산' : '30일 · 입력 환산');
    $('#donutLegend').replaceChildren(...segs.map((s) => {
      const li = document.createElement('li');
      li.style.setProperty('--c', s.color);
      li.innerHTML = '<i></i><span></span><b></b>';
      $('span', li).textContent = s.sub ? `${s.label} · ${s.sub}` : s.label;
      $('b', li).textContent = sum.cur.w > 0 ? `${Math.round((s.value / sum.cur.w) * 100)}%` : '–';
      return li;
    }));
    const d = sum.deltaPct;
    const stats = [
      ['답변 수', `${sum.cur.n.toLocaleString('ko-KR')}회`],
      [`지난 ${sum.period === 7 ? '주' : '달'} 대비`, d == null ? '–' : `${d >= 0 ? '+' : ''}${Math.round(d)}%`],
      ['하루 평균', V.fmtNum(sum.cur.w / sum.period)],
      ['실제 토큰 합', V.fmtNum(sum.cur.in + sum.cur.cw + sum.cur.cr + sum.cur.out)]
    ];
    $('#stats').replaceChildren(...stats.map(([k, v]) => { const e = document.createElement('div'); e.className = 'stat'; e.innerHTML = '<span></span><b></b>'; $('span', e).textContent = k; $('b', e).textContent = v; return e; }));

    // 일별 누적 막대
    const labels = sum.days.map((x) => `${Number(x.slice(5, 7))}/${Number(x.slice(8))}`);
    V.stackedBars($('#bars'), labels, [
      { name: 'Claude', color: COLOR.claude, values: sum.days.map((x) => sum.daily[x].Claude) },
      { name: 'ChatGPT', color: COLOR.gpt, values: sum.days.map((x) => sum.daily[x].ChatGPT) }
    ], { tip: $('#barsTip') });

    // 모델 표
    const rows = sum.byModel.slice(0, 6).map((m) => {
      const tr = document.createElement('tr');
      const ctx = m.in + m.cw + m.cr;
      tr.innerHTML = '<td></td><td><span class="pill"></span></td><td class="num"></td><td class="num"></td><td class="num"></td>';
      tr.children[0].textContent = m.name; tr.children[0].title = m.model;
      const pill = $('.pill', tr); pill.textContent = m.provider; pill.style.setProperty('--c', m.provider === 'Claude' ? COLOR.claude : COLOR.gpt);
      tr.children[2].textContent = m.n.toLocaleString('ko-KR');
      tr.children[3].textContent = V.fmtNum(m.w);
      tr.children[4].textContent = ctx > 0 ? `${Math.round((m.cr / ctx) * 100)}%` : '–';
      return tr;
    });
    $('#modelRows').replaceChildren(...(rows.length ? rows : [Object.assign(document.createElement('tr'), { innerHTML: '<td colspan="5" class="empty">이 기간 기록 없음</td>' })]));

    // 효율 링 · 시간대 · 프로젝트
    $('#rings').replaceChildren(
      V.ring(sum.cacheRate, '#38bdf8', '캐시 재사용률', '높을수록 절약'),
      V.ring(sum.outShare, '#f472b6', '출력 비중', '비용 중 답변 몫')
    );
    const maxH = Math.max(1, ...sum.hours);
    $('#heat').replaceChildren(...sum.hours.map((w, h) => {
      const i = document.createElement('i');
      i.style.opacity = String(0.08 + 0.92 * (w / maxH));
      i.title = `${h}시 · ${V.fmtNum(w)}`;
      return i;
    }));
    const projColors = ['#a78bfa', '#38bdf8', '#f472b6', '#34d399', '#fbbf24'];
    $('#projects').replaceChildren(...sum.byProject.slice(0, 5).map((p, i) => {
      const li = document.createElement('li');
      li.style.setProperty('--c', projColors[i]);
      li.innerHTML = '<i></i><span></span><b></b>';
      $('span', li).textContent = p.name;
      $('b', li).textContent = sum.cur.w > 0 ? `${Math.round((p.w / sum.cur.w) * 100)}%` : '–';
      return li;
    }));
  }

  // ---------- 가이드 + AI 요약 ----------
  let lastPayload = null;
  function renderTips(sum, L) {
    const s = sum || A.summarize(null, S.period);
    const tips = A.buildTips(s, L);
    $('#tips').replaceChildren(...tips.map((t) => {
      const li = document.createElement('li');
      li.dataset.lv = t.lv;
      li.innerHTML = '<span class="ico"></span><b></b><p></p>';
      $('.ico', li).textContent = { bad: '!', warn: '!', info: 'i', good: '✓' }[t.lv];
      $('b', li).textContent = t.title;
      $('p', li).textContent = t.body;
      return li;
    }));
    $('#tipsHint').textContent = `최근 ${S.period}일 기록 + 현재 한도 기준 · 자동 분석`;
    lastPayload = A.buildPayload(s, L, tips);
    $('#aiPayload').textContent = JSON.stringify(lastPayload, null, 2);
  }

  // ---------- 전체 ----------
  // full = 토큰 분석 차트까지 다시 그림 (데이터 · 기간 · 창 크기가 바뀔 때만)
  function render(full) {
    const L = live();
    const now = Date.now();
    chip('chipServer', S.serverOk === false ? 'off' : S.serverOk ? 'live' : 'wait', S.serverOk === false ? '서버 꺼짐 · 실행 파일을 다시 눌러 주세요' : '');
    chip('chipClaude', !L.claude ? 'wait' : now - L.claude.at > STALE ? 'stale' : 'live', L.claude ? `마지막 수신 ${ago(now - L.claude.at)}` : '확장 프로그램 신호 없음');
    chip('chipGpt', L.gpt ? 'live' : 'wait', L.gpt ? `Codex 기록 ${ago(now - L.gpt.at)}` : 'Codex 기록 없음');
    chip('chipAg', L.agRunning ? 'live' : L.ag.length ? 'stale' : 'wait', L.agAt ? `마지막 ${ago(now - L.agAt)}` : 'Antigravity 꺼짐');
    $('#guideSetup').hidden = !!L.claude || S.serverOk === false;

    const sum = S.report ? A.summarize(S.report, S.period) : null;
    renderKpis(L, !!S.report);
    renderLimits(L);
    if (full) renderAnalysis(sum);
    renderTips(sum, L);
  }

  // ---------- 서버 ----------
  async function getJson(path) {
    const r = await fetch(`${API}${path}`, { cache: 'no-store' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return r.json();
  }
  async function pollQuota() {
    let delay = 5000;
    try {
      const q = await getJson('/api/quota');
      const changed = !S.quota || JSON.stringify(q.claude) !== JSON.stringify(S.quota.claude);
      S.quota = q; S.serverOk = true;
      if (changed) loadHistory();
    } catch { S.serverOk = false; delay = 10000; }
    render();
    setTimeout(pollQuota, delay);
  }
  async function loadHistory() {
    const sort = (a) => (Array.isArray(a) ? a.filter((p) => Number.isFinite(p.t)).sort((x, y) => x.t - y.t) : []);
    const [h, ag, cx] = await Promise.allSettled([getJson('/api/history'), getJson('/api/history-ag'), getJson('/api/history-cx')]);
    if (h.status === 'fulfilled') S.hist = sort(h.value);
    if (ag.status === 'fulfilled') S.histAg = sort(ag.value);
    if (cx.status === 'fulfilled') S.histCx = sort(cx.value);
    renderTrend();
  }
  async function loadTokens() {
    try { S.report = await getJson('/api/tokens'); render(true); } catch { /* 서버 상태는 pollQuota 가 표시 */ }
  }

  // ---------- 조작 ----------
  function bindSeg(id, attr, key, onChange) {
    const seg = document.getElementById(id);
    const sync = () => seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(Number(b.dataset[attr]) === S[key])));
    seg.addEventListener('click', (e) => {
      const b = e.target.closest(`button[data-${attr}]`);
      if (!b) return;
      S[key] = Number(b.dataset[attr]);
      store.set(`td.${key}`, S[key]);
      sync(); onChange();
    });
    sync();
  }
  if (![6 * HOUR, DAY, 7 * DAY].includes(S.range)) S.range = DAY;
  if (![7, 30].includes(S.period)) S.period = 7;
  bindSeg('rangeSeg', 'range', 'range', renderTrend);
  bindSeg('periodSeg', 'period', 'period', () => render(true));

  // Gemini AI
  const keyInput = $('#aiKey'), modelSel = $('#aiModel'), runBtn = $('#aiRun'), errEl = $('#aiErr'), outEl = $('#aiOut');
  const getKey = () => store.get('td.geminiKey', '');
  async function loadModels() {
    const key = getKey();
    if (!key) { modelSel.innerHTML = '<option value="">키를 저장하면 모델 목록을 불러옵니다</option>'; return; }
    modelSel.innerHTML = '<option value="">모델 목록 불러오는 중…</option>';
    try {
      const models = await A.listModels(key);
      const saved = store.get('td.geminiModel', '');
      modelSel.replaceChildren(...models.map((m) => { const o = document.createElement('option'); o.value = m.id; o.textContent = `${m.label} (${m.id})`; return o; }));
      if (models.some((m) => m.id === saved)) modelSel.value = saved;
      errEl.textContent = models.length ? '' : '사용 가능한 Gemini 모델이 없습니다.';
    } catch (e) {
      modelSel.innerHTML = '<option value="">모델을 불러오지 못했습니다</option>';
      errEl.textContent = e.message;
    }
  }
  keyInput.value = getKey() ? '••••••••••••' : '';
  keyInput.addEventListener('focus', () => { if (keyInput.value.startsWith('•')) keyInput.value = ''; });
  $('#aiKeySave').addEventListener('click', () => {
    const v = keyInput.value.trim();
    if (!v || v.startsWith('•')) return;
    store.set('td.geminiKey', v);
    keyInput.value = '••••••••••••';
    loadModels();
  });
  $('#aiKeyClear').addEventListener('click', () => { store.del('td.geminiKey'); keyInput.value = ''; loadModels(); });
  modelSel.addEventListener('change', () => store.set('td.geminiModel', modelSel.value));
  function showResult(r) {
    outEl.replaceChildren(A.renderMarkdown(r.text));
    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = `${r.model} · ${new Date(r.at).toLocaleString('ko-KR')} · 최근 ${r.period}일 기준${r.tokens ? ` · 사용 토큰 ${r.tokens.toLocaleString('ko-KR')}` : ''}`;
    outEl.append(meta);
  }
  runBtn.addEventListener('click', async () => {
    errEl.textContent = '';
    const key = getKey();
    if (!key) { errEl.textContent = '먼저 Gemini API 키를 저장하세요.'; keyInput.focus(); return; }
    if (!modelSel.value) { errEl.textContent = '모델을 고르세요.'; return; }
    if (!lastPayload) { errEl.textContent = '분석할 데이터가 아직 없습니다.'; return; }
    runBtn.disabled = true; runBtn.textContent = '분석 중…';
    try {
      const r = await A.generate(key, modelSel.value, A.buildPrompt(lastPayload));
      const result = { text: r.text, model: modelSel.value, at: Date.now(), period: S.period, tokens: r.usage && r.usage.totalTokenCount };
      store.set('td.aiLast', result);
      showResult(result);
    } catch (e) {
      errEl.textContent = e.name === 'TypeError' ? '인터넷 연결 또는 Google 서버에 접속할 수 없습니다.' : e.message;
    } finally { runBtn.disabled = false; runBtn.textContent = 'AI 분석 받기'; }
  });
  const prevAi = store.get('td.aiLast', null);
  if (prevAi && prevAi.text) showResult(prevAi);

  let resizeTimer = null;
  window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { renderTrend(); render(true); }, 150); });
  const tick = () => { $('#clock').textContent = new Date().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' }); };

  // ---------- 시작 ----------
  $('#serverAddr').textContent = `서버 ${API ? 'localhost:8089' : location.host}`;
  tick();
  render(true);
  pollQuota();
  loadHistory();
  loadTokens();
  loadModels();
  setInterval(tick, 15000);
  setInterval(loadHistory, 60000);
  setInterval(loadTokens, 120000);
})();
