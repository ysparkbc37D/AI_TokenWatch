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
  const COLOR = { claude: '#f59e0b', claudeW: '#fb923c', gpt: '#34d399', gpt2: '#2dd4bf', gemini: '#38bdf8', ag: ['#38bdf8', '#818cf8', '#a78bfa', '#f472b6', '#34d399', '#fbbf24'] };
  const SHADES = {
    Claude: ['#f59e0b', '#fbbf24', '#fb923c', '#fde68a'],
    ChatGPT: ['#34d399', '#2dd4bf', '#10b981', '#6ee7b7', '#5eead4', '#059669'],
    Gemini: ['#38bdf8', '#0284c7', '#0ea5e9', '#3b82f6', '#60a5fa', '#93c5fd']
  };

  const $ = (s, r = document) => r.querySelector(s);
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 */ } },
    del(k) { try { localStorage.removeItem(k); } catch { /* 저장 불가 */ } }
  };

  const urlParams = new URLSearchParams(location.search);
  const qRange = urlParams.get('range');
  const initialRange = qRange === '6h' ? 6 * HOUR : qRange === '7d' ? 7 * DAY : qRange === '24h' ? DAY : Number(qRange) || store.get('td.range', DAY);

  const S = {
    quota: null, hist: [], histAg: [], histCx: [], report: null, serverOk: null,
    range: initialRange, period: store.get('td.period', 7),
    company: store.get('td.company', 'all'),
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
  function chip(id, kind, title) { const c = document.getElementById(id); if (!c) return; c.dataset.kind = kind; c.title = title || ''; }

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
    const agGroups = [];
    if (agRaw && Array.isArray(agRaw.groups)) {
      agRaw.groups.forEach((g) => {
        const buckets = (g.buckets || []).map((b) => {
          const reset = num(b.resetTime);
          const left = reset && reset <= now ? 100 : num(b.left);
          return {
            bucketId: b.bucketId,
            window: b.window,
            name: b.name,
            left,
            used: left != null ? Math.max(0, 100 - left) : null,
            resetTime: reset,
            windowMs: b.window === '5h' ? 5 * HOUR : 7 * DAY
          };
        });
        agGroups.push({ name: g.name, description: g.description, buckets });
      });
    }
    const ag = agRaw && Array.isArray(agRaw.models) ? agRaw.models.map((m) => {
      const reset = num(m.resetTime);
      return { names: Array.isArray(m.names) ? m.names : [m.names], left: reset && reset <= now ? 100 : num(m.left), resetTime: reset, group: m.group, window: m.window };
    }) : [];
    return {
      claude,
      gpt: gptWins[0] || null,
      gptWins,
      ag,
      agGroups,
      agRunning: !!(agRaw && agRaw.running),
      agAt: agRaw && agRaw.lastUpdated ? new Date(agRaw.lastUpdated).getTime() : null
    };
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

  const PAGE = document.body.dataset.page || 'all';

  const AG_LABEL_MAP = {
    'Gemini Models (5h)': 'Gemini 5시간',
    'Gemini Models (weekly)': 'Gemini 주간',
    'Gemini 4 Argon (weekly)': 'Gemini 4 Argon',
    'Claude and GPT models (weekly)': 'Claude/GPT (Antigravity 주간)',
    'Claude and GPT models (5h)': 'Claude/GPT (Antigravity 5시간)'
  };

  function trendSeries(times) {
    const all = [
      { id: 'c5', name: 'Claude 5시간', color: COLOR.claude, provider: 'Claude', values: sampleAt(S.hist, (p) => num(p.f), times) },
      { id: 'cw', name: 'Claude 주간', color: COLOR.claudeW, provider: 'Claude', dash: '5 4', fill: false, width: 2, values: sampleAt(S.hist, (p) => num(p.w), times) },
      { id: 'gp', name: 'ChatGPT 30일', color: COLOR.gpt, provider: 'ChatGPT', values: sampleAt(S.histCx, (p) => num(p.p), times) },
      { id: 'gs', name: 'ChatGPT 5시간', color: COLOR.gpt2, provider: 'ChatGPT', fill: false, values: sampleAt(S.histCx, (p) => num(p.s), times) }
    ];
    const agNames = [...new Set(S.histAg.flatMap((p) => Object.keys(p.m || {})))];
    agNames.forEach((name, i) => {
      const displayName = AG_LABEL_MAP[name] || name;
      const prov = /claude/i.test(name) ? 'Claude' : /gpt/i.test(name) ? 'ChatGPT' : 'Gemini';
      all.push({
        id: `ag:${name}`, name: displayName, color: COLOR.ag[i % COLOR.ag.length], fill: false,
        provider: prov,
        values: sampleAt(S.histAg, (p) => (p.m && p.m[name] != null ? 100 - p.m[name] : null), times)
      });
    });

    let filtered = all;
    if (PAGE === 'gemini') filtered = all.filter((s) => s.provider === 'Gemini');
    else if (PAGE === 'claude') filtered = all.filter((s) => s.provider === 'Claude');
    else if (PAGE === 'chatgpt') filtered = all.filter((s) => s.provider === 'ChatGPT');

    return filtered.filter((s) => s.values.some((v) => v != null));
  }

  // ---------- KPI ----------
  function kpi(id, value, valueCls, sub, spark, sparkColor, kind) {
    const el = document.getElementById(id);
    if (!el) return;
    const v = $('.kpi-value', el);
    if (!v) return;
    v.className = `kpi-value ${valueCls || ''}`;
    v.replaceChildren();
    if (Array.isArray(value)) { v.append(value[0]); const sm = document.createElement('small'); sm.textContent = value[1]; v.append(sm); }
    else v.textContent = value;
    const s = $('.kpi-sub', el);
    if (s) s.replaceChildren(...(Array.isArray(sub) ? sub : [sub]).map((x) => (typeof x === 'string' ? document.createTextNode(x) : x)));
    const sp = $('.kpi-spark', el);
    if (sp) V.sparkline(sp, spark || [], sparkColor, kind);
  }
  const span = (text, cls) => { const e = document.createElement('b'); e.textContent = text; if (cls) e.className = cls; return e; };

  function renderKpis(L, sum) {
    const now = Date.now();
    const t6 = bucketTimes(6 * HOUR, 30), t24 = bucketTimes(DAY, 30);

    if (PAGE === 'gemini') {
      const gGem = (L.agGroups || []).find((g) => /gemini models/i.test(g.name));
      const gArgon = (L.agGroups || []).find((g) => /argon/i.test(g.name));
      const b5h = gGem && (gGem.buckets || []).find((b) => b.window === '5h');
      const bWeek = gGem && (gGem.buckets || []).find((b) => b.window === 'weekly');
      const bArgon = gArgon && (gArgon.buckets || [])[0];

      if (b5h && b5h.left != null) {
        kpi('kpi1', [`${Math.round(b5h.left)}`, '% 남음'], lvClass(100 - b5h.left),
          b5h.resetTime && b5h.resetTime > now ? [span(fmtDur(b5h.resetTime - now)), ' 후 초기화 · 5시간 세션'] : '5시간 세션 정상',
          sampleAt(S.histAg, (p) => (p.m && p.m['Gemini Models (5h)'] != null ? 100 - p.m['Gemini Models (5h)'] : null), t6), COLOR.gemini);
      } else kpi('kpi1', '–', '', 'Antigravity 연동 대기 중', [], COLOR.gemini);

      if (bWeek && bWeek.left != null) {
        kpi('kpi2', [`${Math.round(bWeek.left)}`, '% 남음'], lvClass(100 - bWeek.left),
          bWeek.resetTime ? [span(when(bWeek.resetTime)), ' 초기화 · 주간 공유'] : '주간 쿼터 정상',
          sampleAt(S.histAg, (p) => (p.m && p.m['Gemini Models (weekly)'] != null ? 100 - p.m['Gemini Models (weekly)'] : null), t24), '#60a5fa');
      } else kpi('kpi2', '–', '', '주간 한도 대기 중', [], '#60a5fa');

      if (bArgon && bArgon.left != null) {
        kpi('kpi3', [`${Math.round(bArgon.left)}`, '% 남음'], lvClass(100 - bArgon.left),
          bArgon.resetTime ? [span(when(bArgon.resetTime)), ' 초기화 · Argon 전용'] : 'Argon 모델 한도',
          sampleAt(S.histAg, (p) => (p.m && p.m['Gemini 4 Argon (weekly)'] != null ? 100 - p.m['Gemini 4 Argon (weekly)'] : null), t24), '#38bdf8');
      } else kpi('kpi3', '–', '', 'Argon 한도 없음', [], '#38bdf8');

      const sumG = S.report ? A.summarize(S.report, S.period, 'Gemini') : null;
      if (sumG) {
        const d = sumG.deltaPct;
        kpi('kpi4', V.fmtNum(sumG.cur.w), '',
          [span(`답변 ${sumG.cur.n.toLocaleString('ko-KR')}회`), d == null ? '' : ` · 지난주 대비 ${d >= 0 ? '+' : ''}${Math.round(d)}%`],
          sumG.days.map((d) => sumG.daily[d].Gemini || 0), '#38bdf8', 'bars');
      } else kpi('kpi4', '–', '', '로컬 기록 집계 중…', [], '#38bdf8');

    } else if (PAGE === 'claude') {
      const c = L.claude;
      if (c && c.five != null) {
        kpi('kpi1', [`${Math.round(c.five)}`, '%'], lvClass(c.five),
          c.fiveReset && c.fiveReset > now ? [span(fmtDur(c.fiveReset - now)), ' 후 초기화 · 5시간 윈도우'] : '초기화 대기 중',
          sampleAt(S.hist, (p) => num(p.f), t6), COLOR.claude);
      } else kpi('kpi1', '–', '', 'Chrome 확장 프로그램 대기 중', [], COLOR.claude);

      if (c && c.week != null) {
        kpi('kpi2', [`${Math.round(c.week)}`, '%'], lvClass(c.week),
          c.weekReset ? [span(when(c.weekReset)), ' 초기화 · 모든 모델'] : '주간 한도 정상',
          sampleAt(S.hist, (p) => num(p.w), t24), COLOR.claudeW);
      } else kpi('kpi2', '–', '', '주간 한도 기록 없음', [], COLOR.claudeW);

      const agClaude = (L.agGroups || []).find((g) => /claude/i.test(g.name));
      const bAgC = agClaude && (agClaude.buckets || []).find((b) => b.window === 'weekly');
      if (bAgC && bAgC.left != null) {
        kpi('kpi3', [`${Math.round(bAgC.left)}`, '% 남음'], lvClass(100 - bAgC.left),
          [span('Antigravity 내 Claude'), bAgC.resetTime ? ` · ${when(bAgC.resetTime)}` : ''],
          sampleAt(S.histAg, (p) => (p.m && p.m['Claude and GPT models (weekly)'] != null ? 100 - p.m['Claude and GPT models (weekly)'] : null), t24), '#a78bfa');
      } else kpi('kpi3', '–', '', 'Antigravity Claude 기록 없음', [], '#a78bfa');

      const sumC = S.report ? A.summarize(S.report, S.period, 'Claude') : null;
      if (sumC) {
        const d = sumC.deltaPct;
        kpi('kpi4', V.fmtNum(sumC.cur.w), '',
          [span(`답변 ${sumC.cur.n.toLocaleString('ko-KR')}회`), sumC.opusShare ? ` · Opus 비중 ${Math.round(sumC.opusShare)}%` : ''],
          sumC.days.map((d) => sumC.daily[d].Claude || 0), COLOR.claude, 'bars');
      } else kpi('kpi4', '–', '', '로컬 기록 집계 중…', [], COLOR.claude);

    } else if (PAGE === 'chatgpt') {
      const g = L.gpt;
      if (g && g.used != null) {
        kpi('kpi1', [`${Math.round(g.used)}`, '%'], lvClass(g.used),
          g.resetsAt ? [span(when(g.resetsAt)), ' 초기화 · 30일 사용 한도'] : 'Codex 한도 정상',
          sampleAt(S.histCx, (p) => num(p.p), t24), COLOR.gpt);
      } else kpi('kpi1', '–', '', 'Codex 한도 기록 없음', [], COLOR.gpt);

      const w5 = (L.gptWins || []).find((w) => w.windowMin <= 360);
      if (w5 && w5.used != null) {
        kpi('kpi2', [`${Math.round(w5.used)}`, '%'], lvClass(w5.used),
          w5.resetsAt ? [span(fmtDur(w5.resetsAt - now)), ' 후 초기화 · 단기 세션'] : '단기 세션 윈도우',
          sampleAt(S.histCx, (p) => num(p.s), t6), COLOR.gpt2);
      } else kpi('kpi2', '–', '', '단기 세션 기록 없음', [], COLOR.gpt2);

      const agGpt = (L.agGroups || []).find((g) => /gpt/i.test(g.name));
      const bAgG = agGpt && (agGpt.buckets || []).find((b) => b.window === 'weekly');
      if (bAgG && bAgG.left != null) {
        kpi('kpi3', [`${Math.round(bAgG.left)}`, '% 남음'], lvClass(100 - bAgG.left),
          [span('Antigravity GPT-OSS'), bAgG.resetTime ? ` · ${when(bAgG.resetTime)}` : ''],
          sampleAt(S.histAg, (p) => (p.m && p.m['Claude and GPT models (weekly)'] != null ? 100 - p.m['Claude and GPT models (weekly)'] : null), t24), '#10b981');
      } else kpi('kpi3', '–', '', 'Antigravity GPT 쿼터 정상', [], '#10b981');

      const sumP = S.report ? A.summarize(S.report, S.period, 'ChatGPT') : null;
      if (sumP) {
        const d = sumP.deltaPct;
        kpi('kpi4', V.fmtNum(sumP.cur.w), '',
          [span(`답변 ${sumP.cur.n.toLocaleString('ko-KR')}회`), d == null ? '' : ` · 지난주 대비 ${d >= 0 ? '+' : ''}${Math.round(d)}%`],
          sumP.days.map((d) => sumP.daily[d].ChatGPT || 0), COLOR.gpt, 'bars');
      } else kpi('kpi4', '–', '', '로컬 기록 집계 중…', [], COLOR.gpt);

    } else {
      // index.html: 전체 모듈 통합 대시보드 (5시간 및 주간 사용량 위주)
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

      let ag5h = null, agWeek = null;
      if (L.agGroups && L.agGroups.length) {
        const gem = L.agGroups.find((g) => /gemini models/i.test(g.name));
        if (gem) {
          ag5h = (gem.buckets || []).find((b) => b.window === '5h');
          agWeek = (gem.buckets || []).find((b) => b.window === 'weekly');
        }
      }
      if (ag5h && ag5h.left != null) {
        const sub = [span(`주간 ${agWeek && agWeek.left != null ? Math.round(agWeek.left) : '–'}% 남음`), ag5h.resetTime ? ` · ${fmtDur(ag5h.resetTime - now)} 후 초기화` : ''];
        kpi('kpiAg', [`${Math.round(ag5h.left)}`, '% 남음 (5h)'], lvClass(100 - ag5h.left), sub,
          sampleAt(S.histAg, (p) => (p.m && p.m['Gemini Models (5h)'] != null ? 100 - p.m['Gemini Models (5h)'] : null), t6), '#38bdf8');
      } else kpi('kpiAg', '–', '', 'Antigravity 를 켜면 자동으로 읽습니다', [], '#38bdf8');

      if (sum) {
        const s7 = A.summarize(S.report, 7);
        const d = s7.deltaPct;
        kpi('kpiTokens', V.fmtNum(s7.cur.w), '',
          d == null ? '지난주 기록 없음' : [span(`${d >= 0 ? '▲' : '▼'} ${Math.abs(Math.round(d))}%`, d > 10 ? 'up' : d < -10 ? 'down' : 'flat'), ' 지난주 대비 · 3사 통합'],
          s7.days.map((day) => (s7.daily[day].Claude || 0) + (s7.daily[day].ChatGPT || 0) + (s7.daily[day].Gemini || 0)), '#a78bfa', 'bars');
      } else kpi('kpiTokens', '–', '', '로컬 기록 집계 중…', [], '#a78bfa');
    }
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
  function makeModule(id, title, brandColor, badgeText, badgeKind, items) {
    const mod = document.createElement('div');
    mod.className = `comp-mod comp-${id}`;
    mod.dataset.company = id;
    mod.style.setProperty('--brand-c', brandColor);
    if (S.company !== 'all' && S.company !== id) mod.hidden = true;

    const head = document.createElement('div');
    head.className = 'comp-head';
    head.innerHTML = `<span class="comp-title"><i></i>${title}</span><span class="comp-badge ${badgeKind || ''}">${badgeText}</span>`;
    mod.append(head);

    const ul = document.createElement('ul');
    ul.className = 'limits';
    ul.replaceChildren(...items);
    mod.append(ul);
    return mod;
  }

  function renderLimits(L) {
    const wrap = $('#companyModules');
    if (!wrap) return;
    const now = Date.now();

    // 1. Google Gemini Module
    const gemItems = [];
    const gemGroups = (L.agGroups || []).filter((g) => !/claude|gpt/i.test(g.name));
    if (gemGroups.length) {
      gemGroups.forEach((g) => {
        g.buckets.forEach((b) => {
          const who = b.window === '5h' ? '5시간' : '주간';
          const what = `${g.name} · ${b.window === '5h' ? '5시간 세션 한도' : '주간 공유 한도'}`;
          const color = /argon/i.test(g.name) ? '#38bdf8' : b.window === '5h' ? '#34d399' : '#60a5fa';
          gemItems.push(limitRow(color, who, what, b.used, b.resetTime, b.windowMs));
        });
      });
    } else if (L.ag.length) {
      const gemModels = L.ag.filter((m) => !/claude|gpt/i.test(m.names.join(' ')));
      if (gemModels.length) {
        gemModels.forEach((m, i) => gemItems.push(limitRow(COLOR.ag[i % COLOR.ag.length], m.names[0], m.names.slice(1).join(' · ') || '모델 한도', m.left == null ? null : 100 - m.left, m.resetTime, null)));
      } else {
        gemItems.push(limitRow(COLOR.gemini, '대기', 'Antigravity 에서 Gemini 모델 사용 대기 중', null, null, null));
      }
    } else {
      gemItems.push(limitRow(COLOR.gemini, '연결 대기', 'Antigravity 를 켜면 자동으로 읽습니다', null, null, null));
    }
    const gemBadgeText = L.agRunning ? 'Antigravity 연동' : (L.agGroups.length || L.ag.length) ? '꺼짐 (마지막 값)' : '대기 중';
    const gemBadgeKind = L.agRunning ? 'live' : (L.agGroups.length || L.ag.length) ? 'stale' : 'off';
    const modGemini = makeModule('gemini', 'Google Gemini', COLOR.gemini, gemBadgeText, gemBadgeKind, gemItems);

    // 2. Anthropic Claude Module
    const claudeItems = [];
    if (L.claude) {
      claudeItems.push(limitRow(COLOR.claude, '5시간', 'Claude 웹 세션 한도', L.claude.five, L.claude.fiveReset, 5 * HOUR));
      claudeItems.push(limitRow(COLOR.claudeW, '주간', 'Claude 웹 모든 모델 한도', L.claude.week, L.claude.weekReset, 7 * DAY));
    } else {
      claudeItems.push(limitRow(COLOR.claude, 'Chrome 확장', '확장 프로그램 설치 시 실시간 한도 표시', null, null, null));
    }
    const agClaude = (L.agGroups || []).filter((g) => /claude/i.test(g.name));
    agClaude.forEach((g) => {
      g.buckets.forEach((b) => {
        const who = b.window === '5h' ? '5시간' : '주간';
        claudeItems.push(limitRow('#a78bfa', who, `Antigravity · ${g.name}`, b.used, b.resetTime, b.windowMs));
      });
    });
    const claudeBadgeText = !L.claude ? '확장 신호 대기' : (now - L.claude.at > STALE ? '지연됨' : '실시간 연동');
    const claudeBadgeKind = !L.claude ? 'off' : (now - L.claude.at > STALE ? 'stale' : 'live');
    const modClaude = makeModule('claude', 'Anthropic Claude', COLOR.claude, claudeBadgeText, claudeBadgeKind, claudeItems);

    // 3. OpenAI ChatGPT Module
    const gptItems = [];
    if (L.gptWins.length) {
      L.gptWins.forEach((g, i) => {
        gptItems.push(limitRow(i ? COLOR.gpt2 : COLOR.gpt, windowName(g.windowMin), 'Codex 사용 한도', g.used, g.resetsAt, g.windowMin * MIN, g.at ? `기록 ${ago(now - g.at)}` : ''));
      });
    } else {
      gptItems.push(limitRow(COLOR.gpt, 'Codex 기록', 'Codex 를 사용하면 한도가 자동으로 채워집니다', null, null, null));
    }
    const agGpt = (L.agGroups || []).filter((g) => /gpt/i.test(g.name) && !/claude/i.test(g.name));
    agGpt.forEach((g) => {
      g.buckets.forEach((b) => {
        const who = b.window === '5h' ? '5시간' : '주간';
        gptItems.push(limitRow(COLOR.gpt2, who, `Antigravity · ${g.name}`, b.used, b.resetTime, b.windowMs));
      });
    });
    const gptBadgeText = L.gpt ? 'Codex 연동' : '기록 없음';
    const gptBadgeKind = L.gpt ? 'live' : 'off';
    const modGpt = makeModule('gpt', 'OpenAI ChatGPT', COLOR.gpt, gptBadgeText, gptBadgeKind, gptItems);

    if (PAGE === 'gemini') {
      modGemini.hidden = false;
      wrap.replaceChildren(modGemini);
    } else if (PAGE === 'claude') {
      modClaude.hidden = false;
      wrap.replaceChildren(modClaude);
    } else if (PAGE === 'chatgpt') {
      modGpt.hidden = false;
      wrap.replaceChildren(modGpt);
    } else {
      wrap.replaceChildren(modGemini, modClaude, modGpt);
    }
  }

  // ---------- 추이 ----------
  function renderTrend() {
    const times = bucketTimes(S.range, S.range <= 6 * HOUR ? 73 : S.range <= DAY ? 97 : 169);
    const all = trendSeries(times);
    const legend = $('#trendLegend');
    const trendEl = $('#trend');
    if (!legend || !trendEl) return;
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
    const emptyEl = $('#trendEmpty');
    if (emptyEl) emptyEl.hidden = all.length > 0;
    const two = (n) => String(n).padStart(2, '0');
    V.lineChart(trendEl, times, shown, {
      yLabel: (v) => `${v}%`,
      tLabel: (t) => { const d = new Date(t); return S.range > DAY ? `${d.getMonth() + 1}/${d.getDate()}` : `${two(d.getHours())}:${two(d.getMinutes())}`; },
      tipTime: (t) => when(t),
      tip: $('#trendTip'),
      ticks: S.range > DAY ? 7 : 6
    });
  }

  // ---------- 토큰 분석 ----------
  function renderAnalysis(rawSum) {
    if (!$('#donut') || !$('#modelRows')) return;
    const targetProv = PAGE === 'gemini' ? 'Gemini' : PAGE === 'claude' ? 'Claude' : PAGE === 'chatgpt' ? 'ChatGPT' : null;
    const sum = S.report ? A.summarize(S.report, S.period, targetProv) : null;
    if (!sum) {
      $('#donut').replaceChildren(); $('#donutLegend').replaceChildren(); $('#stats').replaceChildren();
      $('#modelRows').innerHTML = '<tr><td colspan="5" class="empty">로컬 기록을 집계하는 중…</td></tr>';
      return;
    }
    // 도넛: 모델 상위 5 + 기타
    const used = { Claude: 0, ChatGPT: 0, Gemini: 0 };
    const segs = sum.byModel.slice(0, 5).map((m) => ({ label: m.name, sub: m.provider, value: m.w, color: (SHADES[m.provider] || ['#64748b'])[used[m.provider]++ % 6] || '#64748b' }));
    const rest = sum.byModel.slice(5).reduce((a, m) => a + m.w, 0);
    if (rest > 0) segs.push({ label: '기타', value: rest, color: '#475569' });
    V.donut($('#donut'), segs, V.fmtNum(sum.cur.w), sum.period === 7 ? '7일 · 입력 환산' : '30일 · 입력 환산');
    $('#donutLegend').replaceChildren(...segs.map((s) => {
      const li = document.createElement('li');
      li.style.setProperty('--c', s.color);
      li.innerHTML = '<i></i><span></span><b></b>';
      $('span', li).textContent = s.sub && PAGE === 'all' ? `${s.label} · ${s.sub}` : s.label;
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
    const barSeries = [];
    if (PAGE === 'gemini') {
      barSeries.push({ name: 'Gemini', color: COLOR.gemini, values: sum.days.map((x) => sum.daily[x].Gemini || 0) });
    } else if (PAGE === 'claude') {
      barSeries.push({ name: 'Claude', color: COLOR.claude, values: sum.days.map((x) => sum.daily[x].Claude || 0) });
    } else if (PAGE === 'chatgpt') {
      barSeries.push({ name: 'ChatGPT', color: COLOR.gpt, values: sum.days.map((x) => sum.daily[x].ChatGPT || 0) });
    } else {
      barSeries.push(
        { name: 'Claude', color: COLOR.claude, values: sum.days.map((x) => sum.daily[x].Claude || 0) },
        { name: 'ChatGPT', color: COLOR.gpt, values: sum.days.map((x) => sum.daily[x].ChatGPT || 0) },
        { name: 'Gemini', color: COLOR.gemini, values: sum.days.map((x) => sum.daily[x].Gemini || 0) }
      );
    }
    V.stackedBars($('#bars'), labels, barSeries, { tip: $('#barsTip') });

    // 모델 표
    const rows = sum.byModel.slice(0, 8).map((m) => {
      const tr = document.createElement('tr');
      const ctx = m.in + m.cw + m.cr;
      tr.innerHTML = '<td></td><td><span class="pill"></span></td><td class="num"></td><td class="num"></td><td class="num"></td>';
      tr.children[0].textContent = m.name; tr.children[0].title = m.model;
      const pill = $('.pill', tr); pill.textContent = m.provider;
      const pillColor = m.provider === 'Claude' ? COLOR.claude : m.provider === 'ChatGPT' ? COLOR.gpt : COLOR.gemini;
      pill.style.setProperty('--c', pillColor);
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
  function renderTips(rawSum, L) {
    const tipsEl = $('#tips');
    if (!tipsEl) return;
    const targetProv = PAGE === 'gemini' ? 'Gemini' : PAGE === 'claude' ? 'Claude' : PAGE === 'chatgpt' ? 'ChatGPT' : null;
    const s = S.report ? A.summarize(S.report, S.period, targetProv) : A.summarize(null, S.period, targetProv);
    const tips = A.buildTips(s, L, targetProv);
    tipsEl.replaceChildren(...tips.map((t) => {
      const li = document.createElement('li');
      li.dataset.lv = t.lv;
      li.innerHTML = '<span class="ico"></span><b></b><p></p>';
      $('.ico', li).textContent = { bad: '!', warn: '!', info: 'i', good: '✓' }[t.lv];
      $('b', li).textContent = t.title;
      $('p', li).textContent = t.body;
      return li;
    }));
    const hintEl = $('#tipsHint');
    if (hintEl) hintEl.textContent = `최근 ${S.period}일 기록 + 현재 한도 기준 · 자동 분석`;
    lastPayload = A.buildPayload(s, L, tips);
    if ($('#aiPayload')) $('#aiPayload').textContent = JSON.stringify(lastPayload, null, 2);
  }

  // ---------- 전체 ----------
  function render(full) {
    const L = live();
    const now = Date.now();
    chip('chipServer', S.serverOk === false ? 'off' : S.serverOk ? 'live' : 'wait', S.serverOk === false ? '서버 꺼짐 · 실행 파일을 다시 눌러 주세요' : '');
    chip('chipClaude', !L.claude ? 'wait' : now - L.claude.at > STALE ? 'stale' : 'live', L.claude ? `마지막 수신 ${ago(now - L.claude.at)}` : '확장 프로그램 신호 없음');
    chip('chipGpt', L.gpt ? 'live' : 'wait', L.gpt ? `Codex 기록 ${ago(now - L.gpt.at)}` : 'Codex 기록 없음');
    chip('chipAg', L.agRunning ? 'live' : L.ag.length ? 'stale' : 'wait', L.agAt ? `마지막 ${ago(now - L.agAt)}` : 'Antigravity 꺼짐');
    if ($('#guideSetup')) $('#guideSetup').hidden = !!L.claude || S.serverOk === false;

    const targetProv = PAGE === 'gemini' ? 'Gemini' : PAGE === 'claude' ? 'Claude' : PAGE === 'chatgpt' ? 'ChatGPT' : null;
    const sum = S.report ? A.summarize(S.report, S.period, targetProv) : null;
    renderKpis(L, sum);
    renderLimits(L);
    if (full) {
      renderAnalysis(sum);
      renderFrugality(sum);
    }
    renderTips(sum, L);
  }

  // ---------- 알뜰 토큰 사용 지수 (Frugality Hub) ----------
  function renderFrugality(sum) {
    const sec = $('#frugalSection');
    if (!sec || !A.calcFrugality) return;
    const f = A.calcFrugality(sum);

    const numEl = $('#frugalScoreNum');
    if (numEl) numEl.textContent = f.score;
    const titleEl = $('#frugalGradeTitle');
    if (titleEl) titleEl.textContent = f.gradeLabel;
    const badgeEl = $('#frugalBadge');
    if (badgeEl) {
      badgeEl.className = `frugal-badge grade-${f.grade}`;
      badgeEl.textContent = `${f.grade}등급`;
    }

    const savedTokEl = $('#frugalSavedTokens');
    if (savedTokEl) savedTokEl.textContent = `+${V.fmtNum(f.savedTokens)}`;
    const savedCostEl = $('#frugalSavedCost');
    if (savedCostEl) savedCostEl.textContent = `약 ₩${f.savedCostKrw.toLocaleString('ko-KR')}`;
    const savedUsdEl = $('#frugalSavedUsd');
    if (savedUsdEl) savedUsdEl.textContent = `~$${f.savedCostUsd}`;

    const turnTokEl = $('#frugalTurnTokens');
    if (turnTokEl) turnTokEl.textContent = `${V.fmtNum(f.avgTokensPerTurn)} 토큰`;
    const turnStatEl = $('#frugalTurnStatus');
    if (turnStatEl) turnStatEl.textContent = f.avgTokensPerTurn > 100000 ? '재독해 과다 주의' : '슬림한 맥락 유지';

    const setBar = (fillId, txtId, score, max) => {
      const pct = Math.round((score / max) * 100);
      const fill = $(fillId); if (fill) fill.style.width = `${pct}%`;
      const txt = $(txtId); if (txt) txt.textContent = `${pct}% (${score}/${max}점)`;
    };
    setBar('#fFillCache', '#fBarCache', f.sub.cache, 35);
    setBar('#fFillModel', '#fBarModel', f.sub.model, 30);
    setBar('#fFillContext', '#fBarContext', f.sub.context, 20);
    setBar('#fFillPacing', '#fBarPacing', f.sub.pacing, 15);

    const alertsEl = $('#frugalAlerts');
    if (alertsEl) {
      alertsEl.replaceChildren(...f.alerts.map((al) => {
        const div = document.createElement('div');
        div.className = `f-alert lv-${al.lv}`;
        div.innerHTML = `<span class="f-alert-icon">${al.icon}</span><div class="f-alert-body"><b>${al.title}</b><span>${al.desc}</span></div>`;
        return div;
      }));
    }
  }

  // ---------- 월간 / 년간 영구 DB 비교 ----------
  function renderVault(vault) {
    const tbody = $('#vaultRows');
    if (!tbody || !A.summarizeVault) return;
    const v = A.summarizeVault(vault);
    if (!v.months.length) {
      tbody.innerHTML = '<tr><td colspan="6" class="empty">누적 데이터베이스 기록이 없습니다.</td></tr>';
      return;
    }
    tbody.replaceChildren(...v.months.map((m) => {
      const tr = document.createElement('tr');
      const provStr = Object.entries(m.byProvider || {}).map(([p, w]) => `${p} ${Math.round((w / (m.total || 1)) * 100)}%`).join(' · ');
      const topModel = Object.entries(m.byModel || {}).sort((a, b) => b[1] - a[1])[0];
      const modelStr = topModel ? `${A.prettyModel(topModel[0])} (${Math.round((topModel[1] / (m.total || 1)) * 100)}%)` : '–';
      tr.innerHTML = `
        <td class="strong">${m.month}</td>
        <td class="strong">${V.fmtNum(m.total)}</td>
        <td>${m.turns ? m.turns.toLocaleString('ko-KR') + '회' : '–'}</td>
        <td style="color:var(--gem)">${V.fmtNum(m.cr)}</td>
        <td>${provStr || '–'}</td>
        <td>${modelStr}</td>
      `;
      return tr;
    }));
  }

  // ---------- 서버 & 원격 PWA 통신 ----------
  const staticFallbacks = {
    '/api/quota': './data/quota.json',
    '/api/history': './data/history.json',
    '/api/history-ag': './data/history-ag.json',
    '/api/history-cx': './data/history-cx.json',
    '/api/tokens': './data/tokens.json',
    '/api/vault': './data/vault_db.json'
  };

  function getBaseApi() {
    const remote = store.get('td.remoteApi', '').trim();
    if (remote) return remote.replace(/\/+$/, '');
    if (location.protocol === 'file:') return 'http://localhost:8089';
    return '';
  }

  async function getJson(path) {
    const base = getBaseApi();
    const isGhPages = !base && (location.hostname.endsWith('github.io') || location.hostname.includes('github.io'));

    // 깃허브 Pages 등 정적 호스팅 환경에서는 정적 스냅샷 파일 즉시 로드
    if (isGhPages && staticFallbacks[path]) {
      try {
        const rStatic = await fetch(`${staticFallbacks[path]}?_t=${Date.now()}`, { cache: 'no-store' });
        if (rStatic.ok) return await rStatic.json();
      } catch {}
    }

    try {
      const url = base ? `${base}${path}` : path;
      const r = await fetch(`${url}${url.includes('?') ? '&' : '?'}_t=${Date.now()}`, { cache: 'no-store' });
      if (r.ok) return await r.json();
      throw new Error(`HTTP ${r.status}`);
    } catch (err) {
      // 로컬 서버 연결 실패 시 스냅샷 데이터로 자동 폴백
      if (staticFallbacks[path]) {
        try {
          const rStatic = await fetch(`${staticFallbacks[path]}?_t=${Date.now()}`, { cache: 'no-store' });
          if (rStatic.ok) return await rStatic.json();
        } catch {}
      }
      throw err;
    }
  }

  async function pollQuota() {
    const isGhPages = !getBaseApi() && (location.hostname.endsWith('github.io') || location.hostname.includes('github.io'));
    let delay = isGhPages ? 60000 : 15000;
    try {
      const q = await getJson('/api/quota');
      const changed = !S.quota || JSON.stringify(q.claude) !== JSON.stringify(S.quota.claude);
      S.quota = q; S.serverOk = true;
      if (changed) loadHistory();
    } catch { S.serverOk = false; delay = isGhPages ? 60000 : 15000; }
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
    loadVault();
  }
  async function loadVault() {
    try {
      const v = await getJson('/api/vault');
      renderVault(v);
    } catch {}
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

  function bindCompanySeg() {
    const seg = document.getElementById('companySeg');
    if (!seg) return;
    const sync = () => seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.company === S.company)));
    seg.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-company]');
      if (!b) return;
      S.company = b.dataset.company || 'all';
      store.set('td.company', S.company);
      sync();
      renderLimits(live());
    });
    sync();
  }

  // Gemini AI
  const keyInput = $('#aiKey'), modelSel = $('#aiModel'), runBtn = $('#aiRun'), errEl = $('#aiErr'), okEl = $('#aiOk'), outEl = $('#aiOut');
  const getKey = () => store.get('td.geminiKey', '');

  function setStatus(type, msg) {
    if (type === 'ok') {
      if (okEl) { okEl.textContent = msg; okEl.hidden = !msg; }
      if (errEl) { errEl.textContent = ''; errEl.hidden = true; }
    } else if (type === 'err') {
      if (errEl) { errEl.textContent = msg; errEl.hidden = !msg; }
      if (okEl) { okEl.textContent = ''; okEl.hidden = true; }
    } else {
      if (okEl) { okEl.textContent = ''; okEl.hidden = true; }
      if (errEl) { errEl.textContent = ''; errEl.hidden = true; }
    }
  }

  function initDefaultModels() {
    if (!modelSel) return;
    const saved = store.get('td.geminiModel', '');
    const defs = A.DEFAULT_MODELS || [
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
      { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash' },
      { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
      { id: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' }
    ];
    modelSel.replaceChildren(...defs.map((m) => {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = `${m.label} (${m.id})`;
      return o;
    }));
    if (saved && defs.some((m) => m.id === saved)) modelSel.value = saved;
    else modelSel.value = 'gemini-2.5-flash';
  }

  async function loadModels(notify) {
    if (!modelSel) return;
    const key = getKey();
    if (!key) {
      initDefaultModels();
      return;
    }
    if (notify) setStatus('ok', '사용 가능한 모델 목록을 확인하는 중…');
    try {
      const models = await A.listModels(key);
      const saved = store.get('td.geminiModel', '');
      modelSel.replaceChildren(...models.map((m) => {
        const o = document.createElement('option');
        o.value = m.id;
        o.textContent = `${m.label} (${m.id})`;
        return o;
      }));
      if (saved && models.some((m) => m.id === saved)) modelSel.value = saved;
      else if (models.length) modelSel.value = models[0].id;
      if (notify) setStatus('ok', '✓ API 키 저장 완료: Gemini 모델 목록을 불러왔습니다.');
    } catch (e) {
      initDefaultModels();
      if (notify) setStatus('err', e.message || '모델 목록을 불러오지 못했습니다. 기본 모델을 사용합니다.');
    }
  }

  if (keyInput) {
    keyInput.value = getKey() ? '••••••••••••' : '';
    keyInput.addEventListener('focus', () => { if (keyInput.value.startsWith('•')) keyInput.value = ''; });
  }

  const keySaveBtn = $('#aiKeySave');
  if (keySaveBtn) {
    keySaveBtn.addEventListener('click', async () => {
      const v = keyInput.value.trim();
      if (!v || v.startsWith('•')) {
        if (getKey()) setStatus('ok', '✓ 이미 저장된 API 키가 적용되어 있습니다.');
        else setStatus('err', '저장할 Gemini API 키를 입력하세요.');
        return;
      }
      store.set('td.geminiKey', v);
      keyInput.value = '••••••••••••';
      await loadModels(true);
    });
  }

  const keyClearBtn = $('#aiKeyClear');
  if (keyClearBtn) {
    keyClearBtn.addEventListener('click', () => {
      store.del('td.geminiKey');
      if (keyInput) keyInput.value = '';
      initDefaultModels();
      setStatus('ok', 'Gemini API 키가 삭제되었습니다.');
    });
  }

  if (modelSel) {
    modelSel.addEventListener('change', () => store.set('td.geminiModel', modelSel.value));
  }

  function showResult(r) {
    if (!outEl) return;
    outEl.replaceChildren(A.renderMarkdown(r.text));
    const meta = document.createElement('p');
    meta.className = 'meta';
    meta.textContent = `${r.model} · ${new Date(r.at).toLocaleString('ko-KR')} · 최근 ${r.period}일 기준${r.tokens ? ` · 사용 토큰 ${r.tokens.toLocaleString('ko-KR')}` : ''}`;
    outEl.append(meta);
  }

  if (runBtn) {
    runBtn.addEventListener('click', async () => {
      setStatus(null);
      let key = getKey();
      const rawInput = keyInput ? keyInput.value.trim() : '';
      if (!key && rawInput && !rawInput.startsWith('•')) {
        store.set('td.geminiKey', rawInput);
        key = rawInput;
        if (keyInput) keyInput.value = '••••••••••••';
      }

      if (!key) {
        setStatus('err', '먼저 Gemini API 키를 입력하거나 저장해 주세요. (Google AI Studio 에서 무료 발급)');
        if (keyInput) keyInput.focus();
        return;
      }

      const selectedModel = (modelSel && modelSel.value) || 'gemini-2.5-flash';

      if (!lastPayload) {
        const sum = S.report ? A.summarize(S.report, S.period) : A.summarize(null, S.period);
        const tips = A.buildTips(sum, live());
        lastPayload = A.buildPayload(sum, live(), tips);
      }

      runBtn.disabled = true;
      runBtn.textContent = 'AI 맞춤 조언 분석 중…';
      setStatus('ok', 'Gemini AI 에게 토큰 및 한도 데이터를 전달하여 맞춤 조언을 생성 중입니다…');

      try {
        const r = await A.generate(key, selectedModel, A.buildPrompt(lastPayload));
        const result = { text: r.text, model: selectedModel, at: Date.now(), period: S.period, tokens: r.usage && r.usage.totalTokenCount };
        store.set('td.aiLast', result);
        showResult(result);
        setStatus(null);
        if (outEl) outEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      } catch (e) {
        setStatus('err', e.message || 'Gemini 분석 요청 중 오류가 발생했습니다.');
      } finally {
        runBtn.disabled = false;
        runBtn.textContent = 'AI 분석 받기';
      }
    });
  }

  const prevAi = store.get('td.aiLast', null);
  if (prevAi && prevAi.text) showResult(prevAi);

  let resizeTimer = null;
  function onLayoutChange() {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      renderTrend();
      render(true);
    }, 80);
  }
  window.addEventListener('resize', onLayoutChange);
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(() => onLayoutChange());
    const trendEl = $('#trend');
    if (trendEl) ro.observe(trendEl);
    const limitsCard = $('#limitsCard');
    if (limitsCard) ro.observe(limitsCard);
  }
  const tick = () => {
    const clk = $('#clock');
    if (clk) clk.textContent = new Date().toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit' });
  };

  // ---------- PWA 지원 (앱 설치 & 오프라인 캐시) ----------
  function initPwa() {
    // 1. Service Worker 등록
    if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }

    // 2. PWA 설치 프롬프트 (설치 가능한 환경에서만 버튼 표시)
    let deferredPrompt;
    const pwaBtn = $('#pwaInstallBtn');
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      if (pwaBtn) pwaBtn.hidden = false;
    });
    if (pwaBtn) {
      pwaBtn.addEventListener('click', async () => {
        if (!deferredPrompt) {
          alert('브라우저 메뉴에서 "홈 화면에 추가" 또는 "앱 설치"를 선택하여 설치할 수 있습니다.');
          return;
        }
        deferredPrompt.prompt();
        const res = await deferredPrompt.userChoice;
        if (res.outcome === 'accepted') pwaBtn.hidden = true;
        deferredPrompt = null;
      });
    }
  }

  // ---------- 수동 즉시 새로고침 버튼 ----------
  function initRefreshBtn() {
    const btn = $('#refreshBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
      const icon = btn.querySelector('.refresh-icon');
      if (icon) icon.classList.add('spinning');
      btn.disabled = true;
      try {
        await Promise.allSettled([
          pollQuota(),
          loadHistory(),
          loadTokens()
        ]);
        tick();
      } finally {
        setTimeout(() => {
          if (icon) icon.classList.remove('spinning');
          btn.disabled = false;
        }, 500);
      }
    });
  }

  // ---------- 시작 ----------
  const srvEl = $('#serverAddr');
  if (srvEl) srvEl.textContent = `서버 ${API ? 'localhost:8089' : location.host}`;
  tick();
  initDefaultModels();
  initPwa();
  initRefreshBtn();
  render(true);
  pollQuota();
  loadHistory();
  loadTokens();
  loadModels(false);
  bindCompanySeg();
  setInterval(tick, 15000);
  const syncInterval = 60000;
  setInterval(loadHistory, syncInterval);
  setInterval(loadTokens, syncInterval);
})();
