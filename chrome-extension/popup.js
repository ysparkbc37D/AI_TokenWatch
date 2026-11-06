const statusText = document.getElementById('statusText');

function show(st) {
  if (!st) { statusText.textContent = '아직 동기화 기록 없음'; return; }
  const t = new Date(st.at).toLocaleTimeString('ko-KR');
  if (st.ok) {
    statusText.innerHTML = `<span class="ok">● ${t} 전송 성공</span><br>5시간 ${st.five ?? '-'}% · 주간 ${st.week ?? '-'}%`;
  } else {
    statusText.innerHTML = `<span class="err">● ${t} 실패</span><br>`;
    statusText.append(st.error);
  }
}

chrome.storage.local.get('lastSync', (r) => show(r.lastSync));

document.getElementById('syncNowBtn').addEventListener('click', () => {
  statusText.textContent = '동기화 중...';
  chrome.runtime.sendMessage({ action: 'sync_now' }, show);
});
