/**
 * 토큰 분석 · 사용 가이드 · Gemini AI 분석
 * window.TDA 로 노출. 화면 그리기는 dashboard.js 가 맡는다.
 */
(() => {
  'use strict';
  const DAY = 864e5;
  const W = { in: 1, cw: 1.25, cr: 0.1, out: 5 };   // 입력 환산 가중치 (서버 보고서와 같은 값)

  const weighted = (r) => r.in * W.in + r.cw * W.cw + r.cr * W.cr + r.out * W.out;
  const provider = (src) => (src === 'claude' ? 'Claude' : src === 'codex' ? 'ChatGPT' : src);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  function prettyModel(m) {
    let x = /^claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(m);
    if (x) return `${cap(x[1])} ${x[2]}${x[3] ? '.' + x[3] : ''}`;
    x = /^gpt-([\d.]+)(?:-(.+))?$/.exec(m);
    if (x) return `GPT-${x[1]}${x[2] ? ' ' + cap(x[2]) : ''}`;
    return m;
  }

  function dayKey(date) {
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** 기간(일) 동안의 합계와 직전 같은 기간 비교 */
  function summarize(report, period) {
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
    const daily = Object.fromEntries(days.map((d) => [d, { Claude: 0, ChatGPT: 0 }]));

    for (const r of (report && report.daily) || []) {
      if (prevDays.has(r.d)) { add(prev, r); continue; }
      if (!inCur.has(r.d)) continue;
      add(cur, r);
      const p = provider(r.src);
      add(byProvider[p] = byProvider[p] || zero(), r);
      const mk = `${p}|${r.model}`;
      const m = byModel[mk] = byModel[mk] || Object.assign(zero(), { provider: p, model: r.model, name: prettyModel(r.model) });
      add(m, r);
      add(byProject[r.project] = byProject[r.project] || zero(), r);
      daily[r.d][p] = (daily[r.d][p] || 0) + weighted(r);
    }

    const hours = new Array(24).fill(0);
    for (const h of (report && report.hourly) || []) if (inCur.has(h.d)) hours[h.h] += h.w;

    const ctxIn = cur.in + cur.cw + cur.cr;
    const claudeModels = Object.values(byModel).filter((m) => m.provider === 'Claude');
    const claudeW = claudeModels.reduce((a, m) => a + m.w, 0);
    const opusW = claudeModels.filter((m) => /opus/i.test(m.model)).reduce((a, m) => a + m.w, 0);
    const activeDays = days.filter((d) => daily[d].Claude + daily[d].ChatGPT > 0).length;

    return {
      period, days, cur, prev, daily, hours,
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

  /** 규칙 기반 가이드. live = 현재 한도 상태 */
  function buildTips(s, live) {
    const tips = [];
    const push = (lv, title, body) => tips.push({ lv, title, body });
    const now = Date.now();

    // 1) 한도 페이스
    const c = live.claude || {};
    const p5 = projection(c.five, c.fiveReset, 5 * 36e5, now);
    if (c.five >= 100) push('bad', 'Claude 5시간 한도 소진', `초기화(${fmtClock(c.fiveReset)})까지는 ChatGPT 나 Gemini 로 작업을 넘기세요.`);
    else if (p5 && p5.hitAt) push('bad', `Claude 5시간 한도, ${fmtClock(p5.hitAt)}쯤 소진 예상`, `지금 속도면 초기화(${fmtClock(c.fiveReset)}) 전에 막힙니다. 긴 리팩터링 · 대용량 파일 읽기는 초기화 뒤로 미루고, 지금은 짧은 질문 위주로 쓰세요.`);
    const pw = projection(c.week, c.weekReset, 7 * DAY, now);
    if (pw && pw.proj >= 90) push('warn', `Claude 주간 한도 빠듯 (예상 ${pct(Math.min(pw.proj, 999))})`, '주 후반에 막히지 않도록 단순 작업(요약 · 번역 · 포맷 정리)은 다른 서비스로 나눠 쓰세요.');

    const g = live.gpt;
    if (g && g.used != null) {
      const pg = projection(g.used, g.resetsAt, g.windowMin * 60e3, now);
      if (pg && pg.proj >= 90) push('warn', `ChatGPT(Codex) 한도 페이스 빠름 (예상 ${pct(Math.min(pg.proj, 999))})`, `초기화 ${new Date(g.resetsAt).toLocaleDateString('ko-KR')} 전에 닿을 수 있습니다. 자동 리뷰 같은 반복 작업 빈도를 줄이세요.`);
    }

    // 2) Antigravity 모델 간 전환
    const ag = (live.ag || []).filter((m) => m.left != null);
    const low = ag.filter((m) => m.left < 15), roomy = ag.filter((m) => m.left >= 60);
    if (low.length && roomy.length) {
      push('warn', `${low.map((m) => m.names[0]).join(', ')} 거의 소진 (${pct(low[0].left)} 남음)`,
        `Antigravity 에서 ${roomy.map((m) => `${m.names[0]}(${pct(m.left)} 남음)`).join(', ')} 로 바꿔 쓰면 막히지 않습니다.`);
    }

    // 3) 토큰 사용 습관
    if (s.cur.n > 0) {
      if (s.cacheRate != null && s.cacheRate >= 85) push('good', `캐시 재사용률 ${pct(s.cacheRate)} · 잘 쓰고 있어요`, '같은 작업을 한 대화에서 이어가 이전 내용을 싸게 다시 읽고 있습니다. 이 습관을 유지하세요.');
      else if (s.cacheRate != null && s.cacheRate < 60) push('warn', `캐시 재사용률 ${pct(s.cacheRate)} · 낮음`, '새 대화를 자주 시작하거나 같은 자료를 매번 붙여넣고 있습니다. 같은 주제는 한 대화에서 이어가세요.');

      if (s.avgCtx != null && s.avgCtx > 150000) push('warn', `답변 1회당 평균 ${fmt(s.avgCtx)} 토큰을 다시 읽음`, '대화가 길어질수록 매 답변마다 전체 맥락을 다시 읽습니다. 작업 단위가 끝나면 /compact 하거나 요약을 들고 새 대화로 넘어가세요.');
      if (s.outShare != null && s.outShare > 35) push('info', `출력이 비용의 ${pct(s.outShare)}`, '"변경된 부분만", "요약 3줄로"처럼 답변 길이를 정해 주면 출력 토큰이 크게 줄어듭니다.');
      if (s.opusShare != null && s.opusShare > 70) push('info', `Claude 사용의 ${pct(s.opusShare)} 가 Opus`, '파일 이름 바꾸기 · 간단한 질문 · 문서 정리는 Sonnet 으로도 충분합니다. 어려운 설계 · 디버깅에만 Opus 를 쓰면 한도가 오래갑니다.');
      if (s.deltaPct != null && s.deltaPct > 50) push('warn', `지난 ${s.period === 7 ? '주' : '달'} 대비 ${pct(s.deltaPct)} 증가`, '사용량이 크게 늘었습니다. 늘어난 프로젝트를 아래 비중 표에서 확인해 보세요.');
      else if (s.deltaPct != null && s.deltaPct < -30) push('good', `지난 ${s.period === 7 ? '주' : '달'} 대비 ${pct(-s.deltaPct)} 감소`, '같은 일을 더 적은 토큰으로 하고 있거나 작업량이 줄었습니다.');
      if (s.peakHours.length) push('info', `가장 많이 쓰는 시간: ${s.peakHours.map((h) => `${h}시`).join(' · ')}`, 'Claude 5시간 창은 첫 질문 때 열립니다. 무거운 작업 시간대 직전에 가벼운 질문으로 창을 미리 열어 두면, 집중 시간 중간에 초기화가 겹쳐 한도를 두 번 쓸 수 있습니다.');
      const top = s.byProject[0];
      if (top && s.cur.w > 0 && top.w / s.cur.w > 0.6 && s.byProject.length > 1) push('info', `토큰의 ${pct((top.w / s.cur.w) * 100)} 가 ${top.name}`, '이 프로젝트에 CLAUDE.md / AGENTS.md 같은 요약 문서를 두면 매번 탐색하는 토큰을 줄일 수 있습니다.');
    } else {
      push('info', '이 기간의 토큰 기록이 없습니다', 'Claude Code · Codex 를 쓰면 자동으로 집계됩니다.');
    }
    if (!tips.some((t) => t.lv === 'bad' || t.lv === 'warn')) push('good', '지금은 한도 걱정 없음', '모든 한도가 여유 있는 페이스입니다.');
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

  async function geminiError(res) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json(); if (j.error && j.error.message) msg = j.error.message; } catch { /* 본문 없음 */ }
    if (res.status === 400 && /API key/i.test(msg)) return 'API 키가 올바르지 않습니다. AI Studio 에서 키를 다시 확인하세요.';
    if (res.status === 403) return `권한이 없습니다: ${msg}`;
    if (res.status === 429) return '무료 사용량 한도(분당/일일 요청 수)에 걸렸습니다. 잠시 뒤 다시 시도하거나 더 가벼운 모델을 고르세요.';
    return `Gemini 오류: ${msg}`;
  }

  async function listModels(key) {
    const res = await fetch(`${GEMINI}/models?pageSize=200`, { headers: { 'x-goog-api-key': key } });
    if (!res.ok) throw new Error(await geminiError(res));
    const j = await res.json();
    const ver = (n) => { const m = /gemini-(\d+(?:\.\d+)?)/.exec(n); return m ? parseFloat(m[1]) : 0; };
    return (j.models || [])
      .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name) && !/embedding|aqa|tts|image|audio|live/i.test(m.name))
      .map((m) => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name }))
      .sort((a, b) => {
        // 무료로 넉넉한 flash 계열 · 정식(비-preview) · 최신 버전 순
        const score = (x) => (/flash/i.test(x.id) ? 2 : 0) + (/preview|exp/i.test(x.id) ? 0 : 1) - (/lite/i.test(x.id) ? 0.5 : 0);
        return score(b) - score(a) || ver(b.id) - ver(a.id);
      });
  }

  async function generate(key, model, prompt, signal) {
    const res = await fetch(`${GEMINI}/models/${encodeURIComponent(model)}:generateContent`, {
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

  window.TDA = { summarize, projection, buildTips, buildPayload, buildPrompt, listModels, generate, renderMarkdown, prettyModel, weighted, provider, dayKey };
})();
