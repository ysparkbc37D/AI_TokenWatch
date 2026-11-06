/**
 * AI Model Quota & Session Limit Real-Time Engine
 * Live 1-second countdowns, circular SVG updates, and persistent state.
 */

class QuotaManager {
  constructor() {
    this.soundAlertEnabled = localStorage.getItem('quota_sound_alert') === 'true';
    this.loadState();
    this.init();
  }

  loadState() {
    const now = Date.now();

    // Default target reset timestamps based on screenshots
    // Screenshot 1: Claude 5h resets at 23:30 (today)
    const today2330 = new Date();
    today2330.setHours(23, 30, 0, 0);
    if (today2330.getTime() <= now) {
      today2330.setDate(today2330.getDate() + 1);
    }

    // Claude Weekly resets at Saturday 07:00 AM
    const nextSat7am = new Date();
    const dayOfWeek = nextSat7am.getDay(); // 0: Sun, 6: Sat
    const daysUntilSat = (6 - dayOfWeek + 7) % 7 || 7;
    nextSat7am.setDate(nextSat7am.getDate() + daysUntilSat);
    nextSat7am.setHours(7, 0, 0, 0);

    // Screenshot 2: Gemini 5h resets in ~1h 37m
    const gemini5hTarget = now + (1 * 3600 + 37 * 60) * 1000;
    // Gemini Weekly resets in ~1d 23h
    const geminiWeeklyTarget = now + (24 * 3600 + 23 * 3600) * 1000;
    // Claude & GPT Weekly resets in ~5d 8h
    const claudeGptWeeklyTarget = now + (5 * 24 * 3600 + 8 * 3600) * 1000;
    // Argon Weekly resets in ~1d 22h
    const argonWeeklyTarget = now + (24 * 3600 + 22 * 3600) * 1000;

    // 저장값 읽기: 0%도 유효한 값이므로 `|| 기본값`을 쓰면 안 된다 (0이 기본값으로 바뀜)
    const num = (key, fallback) => {
      const v = parseInt(localStorage.getItem(key), 10);
      return Number.isFinite(v) ? v : fallback;
    };

    // Load saved state or defaults
    this.data = {
      claude: {
        fiveHourPct: num('quota_claude_5h_pct', 35),
        fiveHourResetTime: num('quota_claude_5h_time', today2330.getTime()),
        weeklyPct: num('quota_claude_weekly_pct', 27),
        weeklyResetTime: num('quota_claude_weekly_time', nextSat7am.getTime()),
      },
      gemini: {
        fiveHourLeftPct: num('quota_gemini_5h_left', 92),
        fiveHourResetTime: num('quota_gemini_5h_time', gemini5hTarget),
        weeklyLeftPct: num('quota_gemini_weekly_left', 53),
        weeklyResetTime: num('quota_gemini_weekly_time', geminiWeeklyTarget),
      },
      claudeGpt: {
        weeklyLeftPct: num('quota_claude_gpt_weekly_left', 50),
        weeklyResetTime: num('quota_claude_gpt_weekly_time', claudeGptWeeklyTarget),
        fiveHourLeftPct: num('quota_claude_gpt_5h_left', 100),
      },
      argon: {
        weeklyLeftPct: num('quota_argon_weekly_left', 4),
        weeklyResetTime: num('quota_argon_weekly_time', argonWeeklyTarget),
      }
    };
  }

  saveState() {
    localStorage.setItem('quota_claude_5h_pct', this.data.claude.fiveHourPct);
    localStorage.setItem('quota_claude_5h_time', this.data.claude.fiveHourResetTime);
    localStorage.setItem('quota_claude_weekly_pct', this.data.claude.weeklyPct);
    localStorage.setItem('quota_claude_weekly_time', this.data.claude.weeklyResetTime);

    localStorage.setItem('quota_gemini_5h_left', this.data.gemini.fiveHourLeftPct);
    localStorage.setItem('quota_gemini_5h_time', this.data.gemini.fiveHourResetTime);
    localStorage.setItem('quota_gemini_weekly_left', this.data.gemini.weeklyLeftPct);
    localStorage.setItem('quota_gemini_weekly_time', this.data.gemini.weeklyResetTime);

    localStorage.setItem('quota_claude_gpt_weekly_left', this.data.claudeGpt.weeklyLeftPct);
    localStorage.setItem('quota_claude_gpt_weekly_time', this.data.claudeGpt.weeklyResetTime);
    localStorage.setItem('quota_claude_gpt_5h_left', this.data.claudeGpt.fiveHourLeftPct);

    localStorage.setItem('quota_argon_weekly_left', this.data.argon.weeklyLeftPct);
    localStorage.setItem('quota_argon_weekly_time', this.data.argon.weeklyResetTime);
  }

  init() {
    this.updateSoundButtonUI();
    this.renderStaticUI();
    this.updateAllTimers();

    // Start live 1-second countdown loop
    this.timerInterval = setInterval(() => {
      this.updateAllTimers();
    }, 1000);

    // Start live sync polling with local server API (/api/quota)
    this.syncInterval = setInterval(() => {
      this.pollServerQuota();
    }, 2000);
  }

  // file:// 로 열었을 때도 로컬 서버를 바라보도록 절대 주소 사용
  get apiUrl() {
    return location.protocol === 'file:' ? 'http://localhost:8089/api/quota' : '/api/quota';
  }

  setSyncStatus(ok, lastUpdated, source) {
    const el = document.getElementById('claudeSyncStatus');
    if (!el) return;
    if (!ok) {
      el.textContent = '● 동기화 서버 꺼짐 (serve.ps1 실행 필요)';
      el.className = 'text-[10px] text-rose-400';
      return;
    }
    if (!lastUpdated) {
      el.textContent = '● 서버 연결됨 · 확장 프로그램 수신 대기 중';
      el.className = 'text-[10px] text-amber-400';
      return;
    }
    const ageSec = Math.max(0, Math.round((Date.now() - new Date(lastUpdated).getTime()) / 1000));
    const age = ageSec < 60 ? `${ageSec}초 전` : `${Math.round(ageSec / 60)}분 전`;
    const stale = ageSec > 180;
    el.textContent = `● 실시간 연결 · ${age} 갱신${source ? ` (${source})` : ''}`;
    el.className = `text-[10px] ${stale ? 'text-amber-400' : 'text-emerald-400'}`;
  }

  async pollServerQuota() {
    try {
      const res = await fetch(this.apiUrl, { cache: 'no-store' });
      if (!res.ok) { this.setSyncStatus(false); return; }
      const data = await res.json();
      if (!data) return;
      this.setSyncStatus(true, data.claude && data.claude.lastUpdated, data.claude && data.claude.source);

      let changed = false;

      if (data.claude) {
        const c = data.claude;
        const map = [
          ['fiveHourPct', 'fiveHourPct'], ['weeklyPct', 'weeklyPct'],
          ['fiveHourResetTime', 'fiveHourResetTime'], ['weeklyResetTime', 'weeklyResetTime']
        ];
        for (const [src, dst] of map) {
          const v = Math.round(Number(c[src]));
          if (c[src] != null && Number.isFinite(v) && v !== this.data.claude[dst]) {
            this.data.claude[dst] = v;
            changed = true;
          }
        }
      }

      if (data.gemini) {
        if (data.gemini.fiveHourLeft !== undefined && data.gemini.fiveHourLeft !== this.data.gemini.fiveHourLeftPct) {
          this.data.gemini.fiveHourLeftPct = data.gemini.fiveHourLeft;
          changed = true;
        }
        if (data.gemini.weeklyLeft !== undefined && data.gemini.weeklyLeft !== this.data.gemini.weeklyLeftPct) {
          this.data.gemini.weeklyLeftPct = data.gemini.weeklyLeft;
          changed = true;
        }
        if (data.gemini.claudeGptWeeklyLeft !== undefined && data.gemini.claudeGptWeeklyLeft !== this.data.claudeGpt.weeklyLeftPct) {
          this.data.claudeGpt.weeklyLeftPct = data.gemini.claudeGptWeeklyLeft;
          changed = true;
        }
        if (data.gemini.argonWeeklyLeft !== undefined && data.gemini.argonWeeklyLeft !== this.data.argon.weeklyLeftPct) {
          this.data.argon.weeklyLeftPct = data.gemini.argonWeeklyLeft;
          changed = true;
        }
      }

      if (changed) {
        this.saveState();
        this.renderStaticUI();
        this.showToast('⚡ 계정 사용량이 실시간으로 자동 갱신되었습니다!', 'success');
      }
    } catch (e) {
      this.setSyncStatus(false);
    }
  }

  renderStaticUI() {
    // 1. Claude 5h
    const c5hBar = document.getElementById('claude5hBar');
    if (c5hBar) c5hBar.style.width = `${this.data.claude.fiveHourPct}%`;
    const c5hPct = document.getElementById('claude5hPercentText');
    if (c5hPct) c5hPct.textContent = `${this.data.claude.fiveHourPct}%`;
    const c5hLeft = document.getElementById('claude5hLeftText');
    if (c5hLeft) c5hLeft.textContent = `${100 - this.data.claude.fiveHourPct}% 남음`;

    // 초기화 시각 라벨 (서버에서 받은 실제 시각 반영)
    const fmtReset = (ts, withDay) => {
      const d = new Date(ts);
      if (!Number.isFinite(d.getTime())) return '';
      const t = d.toLocaleTimeString('ko-KR', { hour: 'numeric', minute: '2-digit' });
      return withDay ? `(${'일월화수목금토'[d.getDay()]}) ${t}에 초기화` : `${t}에 초기화`;
    };
    const c5hLabel = document.getElementById('claude5hResetLabel');
    if (c5hLabel) c5hLabel.textContent = fmtReset(this.data.claude.fiveHourResetTime, false);
    const cWLabel = document.getElementById('claudeWeeklyResetLabel');
    if (cWLabel) cWLabel.textContent = fmtReset(this.data.claude.weeklyResetTime, true);

    // 2. Claude Weekly
    const cWBar = document.getElementById('claudeWeeklyBar');
    if (cWBar) cWBar.style.width = `${this.data.claude.weeklyPct}%`;
    const cWPct = document.getElementById('claudeWeeklyPercentText');
    if (cWPct) cWPct.textContent = `${this.data.claude.weeklyPct}%`;
    const cWLeft = document.getElementById('claudeWeeklyLeftText');
    if (cWLeft) cWLeft.textContent = `${100 - this.data.claude.weeklyPct}% 남음`;

    // 3. Gemini Models
    const g5hLeft = document.getElementById('gemini5hLeft');
    if (g5hLeft) g5hLeft.textContent = `${this.data.gemini.fiveHourLeftPct}% left`;
    this.updateCircleProgress('gemini5hCircle', this.data.gemini.fiveHourLeftPct);

    const gWLeft = document.getElementById('geminiWeeklyLeft');
    if (gWLeft) gWLeft.textContent = `${this.data.gemini.weeklyLeftPct}% left`;
    this.updateCircleProgress('geminiWeeklyCircle', this.data.gemini.weeklyLeftPct);

    // 4. Claude and GPT models
    const cgWLeft = document.getElementById('claudeGptWeeklyLeft');
    if (cgWLeft) cgWLeft.textContent = `${this.data.claudeGpt.weeklyLeftPct}% left`;
    this.updateCircleProgress('claudeGptWeeklyCircle', this.data.claudeGpt.weeklyLeftPct);

    const cg5hLeft = document.getElementById('claudeGpt5hLeft');
    if (cg5hLeft) cg5hLeft.textContent = `${this.data.claudeGpt.fiveHourLeftPct}% left`;

    // 5. Argon
    const aWLeft = document.getElementById('argonWeeklyLeft');
    if (aWLeft) aWLeft.textContent = `${this.data.argon.weeklyLeftPct}% left`;
    this.updateCircleProgress('argonWeeklyCircle', this.data.argon.weeklyLeftPct);

    // Table rows
    const tdC5h = document.getElementById('tdClaude5hPct');
    if (tdC5h) tdC5h.textContent = `${this.data.claude.fiveHourPct}% 사용 (${100 - this.data.claude.fiveHourPct}% 남음)`;
    const tdCW = document.getElementById('tdClaudeWeeklyPct');
    if (tdCW) tdCW.textContent = `${this.data.claude.weeklyPct}% 사용 (${100 - this.data.claude.weeklyPct}% 남음)`;
  }

  updateCircleProgress(elementId, percent) {
    const circle = document.getElementById(elementId);
    if (!circle) return;

    // Circumference = 2 * PI * r = 2 * 3.14159 * 6 = ~37.7
    const circumference = 37.7;
    const offset = circumference - (percent / 100) * circumference;
    circle.style.strokeDashoffset = offset;
  }

  updateAllTimers() {
    const now = Date.now();

    // 1. Claude 5h
    const diffC5h = Math.max(0, this.data.claude.fiveHourResetTime - now);
    const timerC5hText = this.formatDetailedDuration(diffC5h);
    const elC5h = document.getElementById('claude5hTimer');
    if (elC5h) elC5h.textContent = timerC5hText;
    const tableC5h = document.getElementById('tableTimerClaude5h');
    if (tableC5h) tableC5h.textContent = timerC5hText;

    // 2. Claude Weekly
    const diffCW = Math.max(0, this.data.claude.weeklyResetTime - now);
    const timerCWText = this.formatDaysDuration(diffCW);
    const elCW = document.getElementById('claudeWeeklyTimer');
    if (elCW) elCW.textContent = timerCWText;
    const tableCW = document.getElementById('tableTimerClaudeWeekly');
    if (tableCW) tableCW.textContent = timerCWText;

    // 3. Gemini 5h
    const diffG5h = Math.max(0, this.data.gemini.fiveHourResetTime - now);
    const timerG5hText = this.formatCompactDuration(diffG5h);
    const elG5h = document.getElementById('gemini5hTimer');
    if (elG5h) elG5h.textContent = `Resets in ${timerG5hText}`;
    const tableG5h = document.getElementById('tableTimerGemini5h');
    if (tableG5h) tableG5h.textContent = timerG5hText;

    // 4. Gemini Weekly
    const diffGW = Math.max(0, this.data.gemini.weeklyResetTime - now);
    const timerGWText = this.formatDaysDuration(diffGW);
    const elGW = document.getElementById('geminiWeeklyTimer');
    if (elGW) elGW.textContent = `Resets in ${timerGWText}`;
    const tableGW = document.getElementById('tableTimerGeminiWeekly');
    if (tableGW) tableGW.textContent = timerGWText;

    // 5. Claude & GPT Weekly
    const diffCGW = Math.max(0, this.data.claudeGpt.weeklyResetTime - now);
    const timerCGWText = this.formatDaysDuration(diffCGW);
    const elCGW = document.getElementById('claudeGptWeeklyTimer');
    if (elCGW) elCGW.textContent = `Resets in ${timerCGWText}`;
    const tableCGW = document.getElementById('tableTimerClaudeGptWeekly');
    if (tableCGW) tableCGW.textContent = timerCGWText;

    // 6. Argon Weekly
    const diffAW = Math.max(0, this.data.argon.weeklyResetTime - now);
    const timerAWText = this.formatDaysDuration(diffAW);
    const elAW = document.getElementById('argonWeeklyTimer');
    if (elAW) elAW.textContent = `Resets in ${timerAWText}`;
    const tableAW = document.getElementById('tableTimerArgonWeekly');
    if (tableAW) tableAW.textContent = timerAWText;

    // Find closest reset for top banner
    const resets = [
      { name: 'Gemini 5시간 제한', diff: diffG5h, text: timerG5hText },
      { name: 'Claude 5시간 제한', diff: diffC5h, text: timerC5hText },
      { name: 'Gemini 주간 한도', diff: diffGW, text: timerGWText },
      { name: 'Argon 주간 한도', diff: diffAW, text: timerAWText }
    ].sort((a, b) => a.diff - b.diff);

    const closest = resets[0];
    const bannerName = document.getElementById('closestResetName');
    const bannerCountdown = document.getElementById('closestResetCountdown');
    if (bannerName) bannerName.textContent = closest.name;
    if (bannerCountdown) bannerCountdown.textContent = closest.text;
  }

  formatDetailedDuration(ms) {
    if (ms <= 0) return '지금 초기화됨!';
    const totalSec = Math.floor(ms / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    const seconds = totalSec % 60;

    if (hours > 0) {
      return `${hours}시간 ${minutes}분 ${seconds}초`;
    }
    return `${minutes}분 ${seconds}초`;
  }

  formatCompactDuration(ms) {
    if (ms <= 0) return '0m';
    const totalSec = Math.floor(ms / 1000);
    const hours = Math.floor(totalSec / 3600);
    const minutes = Math.floor((totalSec % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }

  formatDaysDuration(ms) {
    if (ms <= 0) return '0d 0h';
    const totalSec = Math.floor(ms / 1000);
    const days = Math.floor(totalSec / 86400);
    const hours = Math.floor((totalSec % 86400) / 3600);
    if (days > 0) {
      return `${days}d ${hours}h`;
    }
    const minutes = Math.floor((totalSec % 3600) / 60);
    return `${hours}h ${minutes}m`;
  }

  addUsage(service, pct) {
    if (service === 'claude') {
      this.data.claude.fiveHourPct = Math.min(100, this.data.claude.fiveHourPct + pct);
      this.data.claude.weeklyPct = Math.min(100, this.data.claude.weeklyPct + Math.ceil(pct / 2));
      this.showToast(`[Claude] 사용량 +${pct}% 적용됨 (현재 ${this.data.claude.fiveHourPct}% 소진)`, 'info');
    } else {
      this.data.gemini.fiveHourLeftPct = Math.max(0, this.data.gemini.fiveHourLeftPct - pct);
      this.data.gemini.weeklyLeftPct = Math.max(0, this.data.gemini.weeklyLeftPct - Math.ceil(pct / 2));
      this.showToast(`[Gemini] 사용량 +${pct}% 적용됨 (잔여 ${this.data.gemini.fiveHourLeftPct}% 남음)`, 'info');
    }
    this.saveState();
    this.renderStaticUI();
  }

  resetLimit(service) {
    if (service === 'claude') {
      this.data.claude.fiveHourPct = 0;
      this.data.claude.fiveHourResetTime = Date.now() + 5 * 3600 * 1000;
      this.showToast('Claude 5시간 제한이 100% 충전(0% 소진)으로 초기화되었습니다.', 'success');
    } else {
      this.data.gemini.fiveHourLeftPct = 100;
      this.data.gemini.fiveHourResetTime = Date.now() + 5 * 3600 * 1000;
      this.showToast('Gemini 5시간 제한이 100% 충전으로 초기화되었습니다.', 'success');
    }
    this.saveState();
    this.renderStaticUI();
    this.updateAllTimers();
  }

  openEditModal(service) {
    const modal = document.getElementById('editLimitModal');
    if (!modal) return;

    document.getElementById('inputClaude5hPct').value = this.data.claude.fiveHourPct;
    document.getElementById('inputClaudeWeeklyPct').value = this.data.claude.weeklyPct;

    document.getElementById('inputGemini5hLeft').value = this.data.gemini.fiveHourLeftPct;
    document.getElementById('inputGeminiWeeklyLeft').value = this.data.gemini.weeklyLeftPct;
    document.getElementById('inputClaudeGptWeeklyLeft').value = this.data.claudeGpt.weeklyLeftPct;
    document.getElementById('inputArgonWeeklyLeft').value = this.data.argon.weeklyLeftPct;

    modal.classList.remove('hidden');
  }

  openSyncModal() {
    this.openEditModal('all');
  }

  saveModalSettings(e) {
    e.preventDefault();

    this.data.claude.fiveHourPct = parseInt(document.getElementById('inputClaude5hPct').value) || 0;
    this.data.claude.weeklyPct = parseInt(document.getElementById('inputClaudeWeeklyPct').value) || 0;

    this.data.gemini.fiveHourLeftPct = parseInt(document.getElementById('inputGemini5hLeft').value) || 0;
    this.data.gemini.weeklyLeftPct = parseInt(document.getElementById('inputGeminiWeeklyLeft').value) || 0;
    this.data.claudeGpt.weeklyLeftPct = parseInt(document.getElementById('inputClaudeGptWeeklyLeft').value) || 0;
    this.data.argon.weeklyLeftPct = parseInt(document.getElementById('inputArgonWeeklyLeft').value) || 0;

    this.saveState();
    this.renderStaticUI();
    this.updateAllTimers();

    document.getElementById('editLimitModal').classList.add('hidden');
    this.showToast('내 계정의 한도 및 잔여량 설정이 성공적으로 저장되었습니다!', 'success');
  }

  toggleSoundNotification() {
    this.soundAlertEnabled = !this.soundAlertEnabled;
    localStorage.setItem('quota_sound_alert', this.soundAlertEnabled);
    this.updateSoundButtonUI();
    this.showToast(this.soundAlertEnabled ? '🔔 한도 리셋 시 소리 알림이 켜졌습니다.' : '🔕 소리 알림이 꺼졌습니다.', 'info');
  }

  updateSoundButtonUI() {
    const icon = document.getElementById('soundAlertIcon');
    if (icon) {
      icon.className = this.soundAlertEnabled ? 'fa-solid fa-bell text-amber-400' : 'fa-solid fa-bell-slash text-slate-500';
    }
  }

  refreshAll() {
    this.renderStaticUI();
    this.updateAllTimers();
    this.showToast('실시간 카운트다운 새로고침 완료', 'info');
  }

  showToast(message, type = 'info') {
    const toast = document.getElementById('toastNotification');
    const toastText = document.getElementById('toastMessage');
    const toastIcon = document.getElementById('toastIcon');
    if (!toast || !toastText) return;

    toastText.textContent = message;

    if (type === 'success') {
      toastIcon.className = 'fa-solid fa-circle-check text-emerald-400 text-lg';
    } else if (type === 'error') {
      toastIcon.className = 'fa-solid fa-circle-xmark text-rose-400 text-lg';
    } else {
      toastIcon.className = 'fa-solid fa-circle-info text-blue-400 text-lg';
    }

    toast.classList.remove('translate-y-20', 'opacity-0');
    toast.classList.add('translate-y-0', 'opacity-100');

    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      toast.classList.remove('translate-y-0', 'opacity-100');
      toast.classList.add('translate-y-20', 'opacity-0');
    }, 2800);
  }
}

// Global bootstrap
document.addEventListener('DOMContentLoaded', () => {
  window.quotaApp = new QuotaManager();
});
