/**
 * 백그라운드 서비스 워커
 * - 1분마다 claude.ai 사용량 API를 직접 조회 (claude.ai 탭이 없어도 동작, 로그인 쿠키 사용)
 * - content.js가 보낸 값도 받아서 localhost:8089 로 중계
 */
const DASHBOARD = 'http://localhost:8089/api/quota';
const USAGE_PATHS = ['usage', 'usage_limits'];

function toPayload(data, source) {
  // 이 응답 형식이 아니면(키 자체가 없으면) 다른 주소를 시도하도록 null
  if (!data || !('five_hour' in data || 'seven_day' in data)) return null;
  const five = data.five_hour || {};
  const week = data.seven_day || {};
  // 키는 있는데 값이 null = 진행 중인 창이 없음 → 0%
  const pct = (obj, w) => (w === null ? 0 : obj.utilization != null ? Math.round(obj.utilization) : null);
  const ts = (v) => (v ? new Date(v).getTime() : null);
  return {
    claude: {
      fiveHourPct: pct(five, data.five_hour),
      weeklyPct: pct(week, data.seven_day),
      fiveHourResetTime: ts(five.resets_at),
      weeklyResetTime: ts(week.resets_at),
      source
    }
  };
}

async function fetchClaudeUsage() {
  const r = await fetch('https://claude.ai/api/organizations', { credentials: 'include' });
  if (!r.ok) throw new Error(`claude.ai 로그인 필요 (HTTP ${r.status})`);
  const orgs = await r.json();
  if (!Array.isArray(orgs) || !orgs.length) throw new Error('조직 정보 없음');
  // 채팅 구독이 있는 조직을 먼저 시도
  orgs.sort((a, b) => Number((b.capabilities || []).includes('chat')) - Number((a.capabilities || []).includes('chat')));
  for (const org of orgs) {
    const id = org.uuid || org.id;
    for (const p of USAGE_PATHS) {
      const res = await fetch(`https://claude.ai/api/organizations/${id}/${p}`, { credentials: 'include' });
      if (!res.ok) continue;
      const payload = toPayload(await res.json(), 'extension');
      if (payload) return payload;
    }
  }
  throw new Error('사용량 API 응답 없음');
}

async function relay(payload) {
  const res = await fetch(DASHBOARD, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!res.ok) throw new Error(`대시보드 서버 오류 (HTTP ${res.status})`);
  return res.json();
}

async function syncNow() {
  const at = Date.now();
  try {
    const payload = await fetchClaudeUsage();
    await relay(payload);
    const st = { ok: true, at, five: payload.claude.fiveHourPct, week: payload.claude.weeklyPct };
    await chrome.storage.local.set({ lastSync: st });
    return st;
  } catch (e) {
    const st = { ok: false, at, error: String(e.message || e) };
    await chrome.storage.local.set({ lastSync: st });
    return st;
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('quota-sync', { periodInMinutes: 5 });
  syncNow();
});
chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create('quota-sync', { periodInMinutes: 5 });
  syncNow();
});
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'quota-sync') syncNow(); });

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.action === 'sync_now') {
    syncNow().then(sendResponse);
    return true;
  }
  if (msg.action === 'relay_quota') {
    relay(msg.data)
      .then((result) => sendResponse({ success: true, result }))
      .catch((err) => sendResponse({ success: false, error: err.message }));
    return true;
  }
});
