/**
 * 토큰 분석 · 사용 가이드 · Gemini AI 분석
 * window.TDA 로 노출. 화면 그리기는 dashboard.js 가 맡는다.
 */
(() => {
  'use strict';
  const DAY = 864e5;
  const W = { in: 1, cw: 1.25, cr: 0.1, out: 5 };   // 입력 환산 가중치 (서버 보고서와 같은 값)

  const weighted = (r) => r.in * W.in + r.cw * W.cw + r.cr * W.cr + r.out * W.out;
  const provider = (src) => (src === 'claude' ? 'Claude' : src === 'codex' ? 'ChatGPT' : src === 'antigravity' || src === 'gemini' ? 'Gemini' : src);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function prettyModel(m) {
    let x = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(m);
    if (x) return `${cap(x[1])} ${x[2]}${x[3] ? '.' + x[3] : ''}`;
    x = /^gpt-([\d.]+)(?:-(.+))?$/.exec(m);
    if (x) return `GPT-${x[1]}${x[2] ? ' ' + cap(x[2]) : ''}`;
    x = /^(Gemini\s+[\d.]+\s+[A-Za-z0-9]+)(?:\s*\([^)]*\))?/i.exec(m);
    if (x) return x[1];
    return m;
  }

  function dayKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** 기간(일) 동안의 합계와 직전 같은 기간 비교. targetProvider 지정 시 해당 제공자만 집계 */
  function summarize(report, period, targetProvider) {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const days = [];
    for (let i = period - 1; i >= 0; i--) days.push(dayKey(today.getTime() - i * DAY));
    const prevDays = new Set();
    for (let i = 2 * period - 1; i >= period; i--) prevDays.add(dayKey(today.getTime() - i * DAY));
    const inCur = new Set(days);

    const zero = () => ({ in: 0, cw: 0, cr: 0, out: 0, n: 0, w: 0 });
    const add = (a, r) => { a.in += r.in; a.cw += r.cw; a.cr += r.cr; a.out += r.out; a.n += r.n; a.w += weighted(r); };
    const cur = zero(), prev = zero();
    const byProvider = {}, byModel = {}, byProject = {};
    const daily = Object.fromEntries(days.map((d) => [d, { Claude: 0, ChatGPT: 0, Gemini: 0 }]));

    for (const r of (report && report.daily) || []) {
      const p = provider(r.src);
      if (targetProvider && targetProvider !== 'all' && p !== targetProvider) continue;
      if (prevDays.has(r.d)) { add(prev, r); continue; }
      if (!inCur.has(r.d)) continue;
      add(cur, r);
      add(byProvider[p] = byProvider[p] || zero(), r);
      const mk = `${p}|${r.model}`;
      const m = byModel[mk] = byModel[mk] || Object.assign(zero(), { provider: p, model: r.model, name: prettyModel(r.model) });
      add(m, r);
      add(byProject[r.project] = byProject[r.project] || zero(), r);
      daily[r.d][p] = (daily[r.d][p] || 0) + weighted(r);
    }

    const hours = new Array(24).fill(0);
    for (const h of (report && report.hourly) || []) {
      if (targetProvider && targetProvider !== 'all' && h.src && provider(h.src) !== targetProvider) continue;
      if (inCur.has(h.d)) hours[h.h] += h.w;
    }

    const ctxIn = cur.in + cur.cw + cur.cr;
    const claudeModels = Object.values(byModel).filter((m) => m.provider === 'Claude');
    const claudeW = claudeModels.reduce((a, m) => a + m.w, 0);
    const opusW = claudeModels.filter((m) => /opus/i.test(m.model)).reduce((a, m) => a + m.w, 0);
    const activeDays = days.filter((d) => ((daily[d].Claude || 0) + (daily[d].ChatGPT || 0) + (daily[d].Gemini || 0)) > 0).length;

    return {
      period, targetProvider: targetProvider || 'all', days, cur, prev, daily, hours,
      byProvider,
      byModel: Object.values(byModel).sort((a, b) => b.w - a.w),
      byProject: Object.entries(byProject).map(([name, v]) => Object.assign({ name }, v)).sort((a, b) => b.w - a.w),
      deltaPct: prev.w > 0 ? ((cur.w - prev.w) / prev.w) * 100 : null,
      cacheRate: ctxIn > 0 ? (cur.cr / ctxIn) * 100 : null,
      outShare: cur.w > 0 ? ((cur.out * W.out) / cur.w) * 100 : null,
      avgCtx: cur.n > 0 ? ctxIn / cur.n : null,
      opusShare: claudeW > 0 ? (opusW / claudeW) * 100 : null,
      activeDays,
      peakHours: hours.map((w, h) => ({ h, w })).filter((x) => x.w > 0).sort((a, b) => b.w - a.w).slice(0, 3).map((x) => x.h)
    };
  }

  /** 지금 속도로 쓰면 초기화 시점에 몇 % 인지, 100% 에 닿는 시각은 언제인지 */
  function projection(used, resetAt, windowMs, now = Date.now()) {
    if (used == null || !resetAt || resetAt <= now || !windowMs) return null;
    const elapsed = now - (resetAt - windowMs);
    // 창의 4%(최소 20분)는 지나야 추세로 본다 — 30일 창을 몇 시간 만에 외삽하면 터무니없는 값이 나온다
    if (elapsed < Math.max(windowMs * 0.04, 20 * 60e3) || used <= 0) return { proj: used, hitAt: null, early: true };
    const rate = used / elapsed;
    const proj = used + rate * (resetAt - now);
    return { proj, hitAt: proj >= 100 ? now + (100 - used) / rate : null, early: false, elapsedFrac: elapsed / windowMs };
  }

  const fmtClock = (ts) => new Date(ts).toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
  const pct = (v) => `${Math.round(v)}%`;
  const fmt = (n) => window.TDViz.fmtNum(n);

  /** 규칙 기반 가이드. live = 현재 한도 상태, targetProvider 지정 시 해당 제공자 맞춤 */
  function buildTips(s, live, targetProvider) {
    const tips = [];
    const push = (lv, title, body) => tips.push({ lv, title, body });
    const now = Date.now();
    const isAll = !targetProvider || targetProvider === 'all';

    // 1) 한도 페이스
    const c = live.claude || {};
    if (isAll || targetProvider === 'Claude') {
      const p5 = projection(c.five, c.fiveReset, 5 * 36e5, now);
      if (c.five >= 100) push('bad', 'Claude 5시간 한도 소진', `초기화(${fmtClock(c.fiveReset)})까지는 ChatGPT 나 Gemini 로 작업을 넘기세요.`);
      else if (p5 && p5.hitAt) push('bad', `Claude 5시간 한도, ${fmtClock(p5.hitAt)}쯤 소진 예상`, `지금 속도면 초기화(${fmtClock(c.fiveReset)}) 전에 막힙니다. 긴 리팩터링은 초기화 뒤로 미루고, 짧은 질문 위주로 쓰세요.`);
      const pw = projection(c.week, c.weekReset, 7 * DAY, now);
      if (pw && pw.proj >= 90) push('warn', `Claude 주간 한도 빠듯 (예상 ${pct(Math.min(pw.proj, 999))})`, '주 후반에 막히지 않도록 단순 작업(요약 · 포맷 정리)은 다른 모델로 나눠 쓰세요.');
    }

    const g = live.gpt;
    if ((isAll || targetProvider === 'ChatGPT') && g && g.used != null) {
      const pg = projection(g.used, g.resetsAt, g.windowMin * 60e3, now);
      if (pg && pg.proj >= 90) push('warn', `ChatGPT(Codex) 한도 페이스 빠름 (예상 ${pct(Math.min(pg.proj, 999))})`, `초기화 ${new Date(g.resetsAt).toLocaleDateString('ko-KR')} 전에 닿을 수 있습니다. 자동 리뷰 같은 반복 작업 빈도를 조절하세요.`);
    }

    // 2) Antigravity / Gemini 한도 진단
    if (isAll || targetProvider === 'Gemini') {
      const agGroups = live.agGroups || [];
      agGroups.forEach((group) => {
        if (/argon/i.test(group.name)) {
          const b = (group.buckets || [])[0];
          if (b && b.left != null && b.left <= 15) {
            push('bad', `Gemini 4 Argon 거의 소진 (${pct(b.left)} 남음)`, '고성능 전용 모델 한도가 부족합니다. 일반 코딩 및 리팩터링은 Gemini Models (Flash/Pro)로 전환하세요.');
          }
        } else if (/gemini/i.test(group.name)) {
          group.buckets.forEach((b) => {
            if (b.window === '5h' && b.left != null && b.left <= 25) {
              push('warn', `Gemini 5시간 세션 한도 소진 임박 (${pct(b.left)} 남음)`, `${b.resetTime ? `${fmtClock(b.resetTime)} 초기화 예정입니다.` : ''} 무거운 작업은 초기화 이후 진행하세요.`);
            } else if (b.window === 'weekly' && b.left != null && b.left <= 30) {
              push('warn', `Gemini 주간 공유 한도 잔여 부족 (${pct(b.left)} 남음)`, '주간 쿼터 여유가 적습니다. 단순 질의는 경량 Flash 모델 위주로 사용을 권장합니다.');
            }
          });
        }
      });
      const ag = (live.ag || []).filter((m) => m.left != null);
      const low = ag.filter((m) => m.left < 15), roomy = ag.filter((m) => m.left >= 60);
      if (low.length && roomy.length && !tips.some((t) => t.title.includes('거의 소진'))) {
        push('warn', `${low.map((m) => m.names[0]).join(', ')} 거의 소진 (${pct(low[0].left)} 남음)`,
          `Antigravity 에서 ${roomy.map((m) => `${m.names[0]}(${pct(m.left)} 남음)`).join(', ')} 로 바꿔 쓰면 막히지 않습니다.`);
      }
    }

    // 3) 토큰 사용 습관
    if (s.cur.n > 0) {
      if (s.cacheRate != null && s.cacheRate >= 85) push('good', `캐시 재사용률 ${pct(s.cacheRate)} · 효율적 사용 중`, '이전 대화 맥락을 저렴하게 읽어 토큰을 크게 아끼고 있습니다.');
      else if (s.cacheRate != null && s.cacheRate < 60) push('warn', `캐시 재사용률 ${pct(s.cacheRate)} · 낮음`, '새 세션을 너무 자주 시작하고 있습니다. 관련된 작업은 같은 대화에서 이어가세요.');

      if (s.avgCtx != null && s.avgCtx > 150000) push('warn', `답변 1회당 평균 ${fmt(s.avgCtx)} 토큰을 다시 읽음`, '대화가 길어질수록 비용이 급증합니다. 작업 단위가 끝나면 요약 후 새 대화로 분리하세요.');
      if (s.outShare != null && s.outShare > 35) push('info', `출력이 비용의 ${pct(s.outShare)}`, '"변경된 부분만", "요약 3줄로"처럼 답변 길이를 정해 주면 토큰이 절약됩니다.');
      if ((isAll || targetProvider === 'Claude') && s.opusShare != null && s.opusShare > 70) push('info', `Claude 사용의 ${pct(s.opusShare)} 가 Opus`, '설계/디버깅에만 Opus 를 쓰고, 단순 질문 · 문서 정리는 Sonnet 으로도 충분합니다.');
      if (s.deltaPct != null && s.deltaPct > 50) push('warn', `지난 ${s.period === 7 ? '주' : '달'} 대비 ${pct(s.deltaPct)} 증가`, '사용량이 크게 증가했습니다.');
      if ((isAll || targetProvider === 'Claude') && s.peakHours.length) push('info', `주요 사용 시간대: ${s.peakHours.map((h) => `${h}시`).join(' · ')}`, '집중 작업 시작 직전에 짧은 질문으로 세션 창을 미리 열어두면 작업 도중 초기화되어 2회 분량을 쓸 수 있습니다.');
    } else {
      push('info', '이 기간의 토큰 기록이 없습니다', 'AI 도구를 사용하면 자동으로 사용량이 집계됩니다.');
    }
    if (!tips.some((t) => t.lv === 'bad' || t.lv === 'warn')) push('good', '현재 한도 및 쿼터 여유 양호', '모든 세션 및 주간 한도가 안정적으로 유지되고 있습니다.');
    const order = { bad: 0, warn: 1, info: 2, good: 3 };
    return tips.sort((a, b) => order[a.lv] - order[b.lv]);
  }

  /** Gemini 에 보낼 요약 (숫자만) */
  function buildPayload(s, live, tips) {
    const r = (n) => Math.round(n);
    return {
      기간: s.period === 7 ? '최근 7일' : '최근 30일',
      입력환산가중치: '입력1 · 캐시쓰기1.25 · 캐시읽기0.1 · 출력5',
      합계: { 입력환산: r(s.cur.w), 답변수: s.cur.n, 새입력: r(s.cur.in), 캐시쓰기: r(s.cur.cw), 캐시읽기: r(s.cur.cr), 출력: r(s.cur.out) },
      직전기간대비: s.deltaPct == null ? '비교 불가' : `${r(s.deltaPct)}%`,
      캐시재사용률: s.cacheRate == null ? null : `${r(s.cacheRate)}%`,
      출력비중: s.outShare == null ? null : `${r(s.outShare)}%`,
      답변당평균맥락토큰: s.avgCtx == null ? null : r(s.avgCtx),
      사용한날: `${s.activeDays}/${s.period}일`,
      피크시간대: s.peakHours.map((h) => `${h}시`),
      제공자별: Object.fromEntries(Object.entries(s.byProvider).map(([k, v]) => [k, { 입력환산: r(v.w), 답변수: v.n }])),
      모델별상위: s.byModel.slice(0, 6).map((m) => ({ 모델: m.name, 제공자: m.provider, 입력환산: r(m.w), 답변수: m.n })),
      프로젝트별상위: s.byProject.slice(0, 5).map((p) => ({ 프로젝트: p.name, 입력환산: r(p.w) })),
      현재한도: {
        Claude: live.claude ? { '5시간사용%': live.claude.five, '주간사용%': live.claude.week } : null,
        ChatGPT_Codex: live.gpt ? { '사용%': live.gpt.used, 창: `${Math.round(live.gpt.windowMin / 60)}시간` } : null,
        Antigravity: (live.ag || []).map((m) => ({ 모델: m.names.join(', '), '남음%': m.left }))
      },
      자동진단: tips.map((t) => t.title)
    };
  }

  function buildPrompt(payload) {
    return [
      '너는 AI 코딩 도구(Claude, ChatGPT/Codex, Gemini) 사용 습관을 코칭하는 전문가다.',
      '아래는 한 사용자의 실제 토큰 사용 통계(숫자 요약)다. 한국어로, 구체적이고 실행 가능한 조언을 해라.',
      '형식: 마크다운. 다음 4개 절만 사용한다.',
      '## 한눈에 요약 (2~3문장)',
      '## 토큰이 새는 곳 (근거 숫자와 함께 최대 3개)',
      '## 바로 바꿀 습관 5가지 (각 항목: 무엇을 → 예상 효과)',
      '## 다음 기간 계획 (도구별 역할 분담: 어떤 일에 Claude / ChatGPT / Gemini 를 쓸지)',
      '추측은 추측이라고 밝히고, 숫자가 없는 내용은 지어내지 마라. 전체 600자~1200자.',
      '',
      '```json',
      JSON.stringify(payload, null, 2),
      '```'
    ].join('\n');
  }

  // ---------- Gemini API (브라우저에서 직접 호출, 키는 localStorage 에만) ----------
  const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';

  const DEFAULT_MODELS = [
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (추천 · 최신/고속)' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash (안정적 고속)' },
    { id: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash (기본형)' },
    { id: 'gemini-1.5-pro',   label: 'Gemini 1.5 Pro (정밀 분석)' }
  ];

  async function geminiError(res) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j.error && j.error.message) msg = j.error.message; } catch { /* 본문 없음 */ }
    if (res.status === 400 && /API key/i.test(msg)) return 'API 키가 올바르지 않습니다. AI Studio 에서 키를 다시 확인하세요.';
    if (res.status === 403) return `권한이 없습니다: ${msg}`;
    if (res.status === 429) return '무료 사용량 한도(분당/일일 요청 수)에 걸렸습니다. 잠시 뒤 다시 시도하거나 더 가벼운 모델을 고르세요.';
    return `Gemini 오류: ${msg}`;
  }

  async function listModels(key) {
    if (!key) return DEFAULT_MODELS;
    try {
      const url = `${GEMINI}/models?pageSize=100&key=${encodeURIComponent(key)}`;
      const res = await fetch(url, { headers: { 'x-goog-api-key': key } });
      if (!res.ok) return DEFAULT_MODELS;
      const j = await res.json();
      const ver = (n) => { const m = /gemini-(\d+(?:\.\d+)?)/.exec(n); return m ? parseFloat(m[1]) : 0; };
      const fetched = (j.models || [])
        .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name) && !/embedding|aqa|tts|image|audio|live/i.test(m.name))
        .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name }))
        .sort((a, b) => {
          const score = (x) => (/flash/i.test(x.id) ? 2 : 0) + (/preview|exp/i.test(x.id) ? 0 : 1) - (/lite/i.test(x.id) ? 0.5 : 0);
          return score(b) - score(a) || ver(b.id) - ver(a.id);
        });
      return fetched.length ? fetched : DEFAULT_MODELS;
    } catch {
      return DEFAULT_MODELS;
    }
  }

  async function generate(key, model, prompt, signal) {
    const targetModel = model || 'gemini-2.5-flash';
    const url = `${GEMINI}/models/${encodeURIComponent(targetModel)}:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.4 } }),
      signal
    });
    if (!res.ok) throw new Error(await geminiError(res));
    const j = await res.json();
    const cand = (j.candidates || [])[0];
    const text = cand && cand.content && (cand.content.parts || []).map((p) => p.text || '').join('');
    if (!text) throw new Error(`응답이 비어 있습니다${cand && cand.finishReason ? ` (${cand.finishReason})` : ''}.`);
    return { text, usage: j.usageMetadata || null };
  }

  /** 아주 작은 마크다운 → DOM (텍스트 노드로만 넣어 스크립트 주입 불가) */
  function renderMarkdown(text) {
    const frag = document.createDocumentFragment();
    let list = null;
    const inline = (parent, s) => {
      s.split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
        if (/^\*\*[^*]+\*\*$/.test(part)) { const b = document.createElement('b'); b.textContent = part.slice(2, -2); parent.append(b); }
        else if (part) parent.append(document.createTextNode(part.replace(/`/g, '')));
      });
    };
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trimEnd();
      let m;
      if ((m = /^#{1,4}\s+(.*)$/.exec(line))) { list = null; const h = document.createElement('h3'); inline(h, m[1]); frag.append(h); continue; }
      if ((m = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line))) {
        if (!list) { list = document.createElement(/^\s*\d/.test(line) ? 'ol' : 'ul'); frag.append(list); }
        const li = document.createElement('li'); inline(li, m[1]); list.append(li); continue;
      }
      if (!line.trim()) { list = null; continue; }
      list = null;
      const p = document.createElement('p'); inline(p, line); frag.append(p);
    }
    return frag;
  }

  // ---------- 알뜰 토큰 사용 및 낭비 방지 지수 (Token Frugality Hub) ----------
  function calcFrugality(sum) {
    if (!sum || !sum.cur || sum.cur.w === 0) {
      return {
        score: 100, grade: 'S', gradeLabel: '데이터 대기 중',
        cacheRate: 0, savedTokens: 0, savedCostUsd: 0, savedCostKrw: 0,
        avgTokensPerTurn: 0, heavyRatio: 0,
        sub: { cache: 35, model: 30, context: 20, pacing: 15 },
        alerts: [{ lv: 'info', icon: 'ℹ️', title: '사용 기록 수집 중', desc: '로컬 Claude Code, Codex, Antigravity 기록을 분석하여 알뜰 지수를 산출합니다.' }]
      };
    }

    const c = sum.cur;
    const totalIn = c.in + c.cw + c.cr;
    const cacheRate = totalIn > 0 ? (c.cr / totalIn) * 100 : 0;

    // 1. 캐시 절약률 (35점 만점)
    // 캐시 적중률이 70% 이상이면 만점
    const cacheScore = Math.min(35, Math.max(5, Math.round((cacheRate / 70) * 35)));
    const savedTokens = Math.round(c.cr * 0.9); // 캐시 읽기는 정상 입력 대비 90% 저렴함
    const savedCostUsd = Math.round(((savedTokens / 1e6) * 3.0) * 100) / 100; // 100만 토큰당 약 $3 절감 기준
    const savedCostKrw = Math.round(savedCostUsd * 1400);

    // 2. 모델 적정 분배율 (30점 만점)
    // 고비용 모델(Opus, Pro) 편중도 점검
    const heavyW = (sum.byModel || []).filter((m) => /opus|pro/i.test(m.model)).reduce((a, m) => a + m.w, 0);
    const heavyRatio = c.w > 0 ? (heavyW / c.w) * 100 : 0;
    let modelScore = 30;
    if (heavyRatio > 95) modelScore = 14;
    else if (heavyRatio > 80) modelScore = 22;
    else if (heavyRatio > 60) modelScore = 28;

    // 3. 컨텍스트 재독해 효율 (20점 만점)
    // 답변 1회당 재독해 토큰이 너무 크면 대화 비대화로 인한 낭비 발생
    const avgTokensPerTurn = c.n > 0 ? Math.round(totalIn / c.n) : 0;
    let contextScore = 20;
    if (avgTokensPerTurn > 150000) contextScore = 6;
    else if (avgTokensPerTurn > 100000) contextScore = 12;
    else if (avgTokensPerTurn > 60000) contextScore = 17;

    // 4. 생산성 분산 활용률 (15점 만점)
    const activeRate = sum.days.length > 0 ? sum.activeDays / sum.days.length : 1;
    const pacingScore = Math.min(15, Math.max(8, Math.round(activeRate * 12) + 3));

    const totalScore = Math.min(100, Math.max(0, cacheScore + modelScore + contextScore + pacingScore));
    let grade = 'S', gradeLabel = '초절약 마스터';
    if (totalScore < 60) { grade = 'D'; gradeLabel = '토큰 낭비 주의'; }
    else if (totalScore < 75) { grade = 'C'; gradeLabel = '절약 개선 권장'; }
    else if (totalScore < 85) { grade = 'B'; gradeLabel = '우수 알뜰 실천'; }
    else if (totalScore < 95) { grade = 'A'; gradeLabel = '최상위 알뜰 사용자'; }

    const alerts = [];
    if (cacheRate >= 60) {
      alerts.push({ lv: 'good', icon: '💎', title: '프롬프트 캐시 최적화 우수', desc: `캐시 적중률 ${Math.round(cacheRate)}% 달성! 약 ${savedTokens.toLocaleString('ko-KR')} 토큰 (약 ₩${savedCostKrw.toLocaleString('ko-KR')} 상당)을 낭비 없이 아꼈습니다.` });
    } else {
      alerts.push({ lv: 'warn', icon: '💡', title: '캐시 활용도 개선 여지', desc: `캐시 적중률이 ${Math.round(cacheRate)}%입니다. 반복 질문 시 프로젝트 문서나 CLAUDE.md 등을 앞단에 두면 캐시 적중률이 높아집니다.` });
    }

    if (heavyRatio > 85) {
      alerts.push({ lv: 'warn', icon: '⚖️', title: 'Opus/Pro 모델 집중', desc: `전체 토큰의 ${Math.round(heavyRatio)}%가 최상위 모델입니다. 단순 탐색·테스트는 Sonnet이나 Flash를 쓰면 한도가 훨씬 오래갑니다.` });
    } else {
      alerts.push({ lv: 'good', icon: '🎯', title: '적정 모델 황금 분배', desc: `용도별로 가벼운 모델과 고성능 모델을 알뜰하게 조합하여 불필요한 과금과 한도 소진을 막고 있습니다.` });
    }

    if (avgTokensPerTurn > 120000) {
      alerts.push({ lv: 'bad', icon: '✂️', title: '대화 컨텍스트 비대화 주의', desc: `답변 1회당 평균 ${Math.round(avgTokensPerTurn / 1e4)}만 토큰이 재전송되고 있습니다. 작업 단위가 끝나면 /compact 하거나 새 세션으로 분리하세요.` });
    } else {
      alerts.push({ lv: 'good', icon: '⚡', title: '슬림한 대화 맥락 유지', desc: `답변당 평균 ${Math.round(avgTokensPerTurn / 1e3)}k 토큰으로 컨텍스트를 간결하고 낭비 없이 유지하고 있습니다.` });
    }

    return {
      score: totalScore, grade, gradeLabel,
      cacheRate: Math.round(cacheRate), savedTokens, savedCostUsd, savedCostKrw,
      avgTokensPerTurn, heavyRatio: Math.round(heavyRatio),
      sub: { cache: cacheScore, model: modelScore, context: contextScore, pacing: pacingScore },
      alerts
    };
  }

  // ---------- 월간 / 년간 영구 DB 분석 도우미 ----------
  function summarizeVault(vault) {
    if (!vault || !vault.months) return { months: [], years: [], latestMonth: null };
    const monthKeys = Object.keys(vault.months).sort().reverse();
    const yearKeys = Object.keys(vault.years || {}).sort().reverse();
    const months = monthKeys.map((k) => vault.months[k]);
    const years = yearKeys.map((k) => vault.years[k]);
    return {
      months,
      years,
      latestMonth: months[0] || null,
      totalMonths: months.length
    };
  }

  window.TDA = {
    DEFAULT_MODELS, summarize, projection, buildTips, buildPayload, buildPrompt,
    listModels, generate, renderMarkdown, prettyModel, weighted, provider, dayKey,
    calcFrugality, summarizeVault
  };
})();
