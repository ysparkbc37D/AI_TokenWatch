/**
 * claude.ai 탭 안에서 동작하는 보조 동기화
 * 메시지를 보낸 직후 사용량을 다시 읽어 백그라운드로 넘긴다 (백그라운드 1분 주기보다 빠르게 반영).
 */
(function () {
  let timer = null;
  // 짧은 시간 안의 여러 이벤트는 한 번으로 묶는다
  function syncSoon(delay) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try { chrome.runtime.sendMessage({ action: 'sync_now' }, () => void chrome.runtime.lastError); } catch (e) { /* 확장 재로드 후 무시 */ }
    }, delay);
  }

  syncSoon(2000);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) syncSoon(4000);
  }, true);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncSoon(1000); });
})();
