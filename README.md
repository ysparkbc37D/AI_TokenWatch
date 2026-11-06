# AI_TokenWatch · LLM Token Manager

Google Gemini · Anthropic Claude · OpenAI ChatGPT(Codex) 사용 한도와 토큰 사용량을 한눈에 모니터링하고, **모바일 스마트폰(PWA)** 및 PC 어디서든 실시간으로 확인할 수 있는 차세대 AI 관제 플랫폼입니다.

월간·년간 누적 비교를 위한 **SQLite 영구 DB**, 프롬프트 캐시 절약액을 계산하는 **알뜰 토큰 사용 지수(Token Frugality Hub)**, 그리고 무료 Gemini API 기반 AI 맞춤 조언까지 제공합니다.

---

## 📱 휴대폰 모바일 확인 & PWA 앱 설치

이 대시보드는 **PWA(Progressive Web App)**로 제작되어 스마트폰 홈 화면에 네이티브 앱처럼 설치하여 사용할 수 있습니다.

### 1. GitHub Pages 배포를 통한 어디서든 접속
* **GitHub Pages 주소**: `https://ysparkbc37D.github.io/AI_TokenWatch/`
* 저장소 설정(`Settings -> Pages`)에서 `Deploy from a branch` (Branch: `main`, Folder: `/ (root)`)를 선택하면 즉시 전 세계 어디서든 열립니다.
* **오프라인/스냅샷 자동 연동**: 외부 모바일 접속 시 PC가 꺼져 있더라도 저장소에 백업된 최신 스냅샷(`data/quota.json`, `data/vault_db.json`)을 자동으로 불러와 최신 현황을 보여줍니다.

### 2. 홈 화면에 앱으로 추가
* **Android (Chrome)**: 주소 접속 후 상단의 **[📲 앱 설치]** 버튼을 누르거나 브라우저 메뉴 `⋮` → `홈 화면에 추가` 또는 `앱 설치`.
* **iOS (Safari)**: 하단 공유 아이콘(네모+화살표) → **`홈 화면에 추가`** 선택 시 URL 바 없는 풀스크린 단독 앱으로 구동됩니다.

### 3. 모바일에서 내 PC 실시간 라이브 연동
* 상단 헤더의 **[🌐 원격 설정]** 버튼을 누른 뒤, 내 PC의 외부 접속 주소(Tailscale VPN IP, Cloudflare Tunnel, 집안 Wi-Fi IP `http://192.168.x.x:8089`)를 입력하면 휴대폰에서도 5초마다 실시간으로 쿼터가 라이브 업데이트됩니다.

---

## 💎 알뜰 토큰 사용 지수 (Token Frugality Hub)

대시보드 메인에서 내가 얼마나 토큰을 낭비 없이 알뜰하게 사용했는지를 0~100점 점수와 등급(S/A/B/C/D)으로 실시간 평가합니다:

1. **프롬프트 캐시 절약률 (35점)**: 프롬프트 캐싱 적중률 분석 및 무료로 아낀 토큰 수(+13억 등)와 환산 절약 비용(₩/$) 자동 계산.
2. **모델 적정 분배율 (30점)**: 무조건 비싼 Opus/Pro 모델에 편중되지 않고 Sonnet/Flash 모델을 작업에 맞게 알뜰하게 분배했는지 평가.
3. **컨텍스트 재독해 효율 (20점)**: 대화가 너무 길어져 매 답변마다 불필요하게 10만 토큰 이상 재독해되는 낭비 감지 및 `/compact` 권장.
4. **생산성 페이싱 (15점)**: 5시간 윈도우 한도를 골고루 분산 활용하여 대기 시간 낭비를 방지했는지 평가.

---

## 🗄️ 영구 SQLite Vault DB (월간 · 년간 비교)

* Windows 내장 고성능 SQLite 엔진(`tokens_vault.db`) 및 포터블 JSON DB(`vault_db.json`) 연동.
* PC 재부팅이나 시간이 흘러도 과거 데이터가 잘리지 않고 영구 보존됩니다.
* 월별(YYYY-MM) 토큰 사용량, 총 답변 수, 캐시 적중량, 모델별/제공자별 점유율을 과거 2년 치까지 자동으로 누적 집계하여 월간/년간 비교 테이블을 제공합니다.

---

## 🖥️ 화면 구성 (4대 전용 대시보드)

| 페이지 | 경로 | 주요 역할 |
| :--- | :--- | :--- |
| **통합 관제** | `index.html` | **5시간 세션 & 주간 사용량 종합 관제**: 3사 5h/주간 쿼터, 알뜰 토큰 사용 지수, 월간/년간 영구 DB 비교, 회사별 모듈 한도 |
| **Google Gemini** | `gemini.html` | **Gemini 심층 관제**: Gemini Models 5h/주간 쿼터, Gemini 4 Argon 전용 한도, 모델별(Flash 2.5/2.0, Pro) 점유율 |
| **Anthropic Claude** | `claude.html` | **Claude 심층 관제**: Claude 웹 5h 세션 윈도우, 주간 전체 한도, Antigravity Claude 모델, Opus 집중도 분석 |
| **OpenAI ChatGPT** | `chatgpt.html` | **ChatGPT/Codex 관제**: Codex 30일 한도, 5h 단기 세션, GPT 모델별 토큰 통계, 프로젝트별 랭킹 |

---

## 🚀 빠른 실행 (PC 로컬)

**`TokenDashboard.exe` 를 더블클릭**하거나 PowerShell에서:
```powershell
.\launch.ps1
```
* 포트: `http://localhost:8089`

### 1-클릭 / 5분 자동 GitHub 동기화 (PC -> 모바일 반영)
* **수동 1회 동기화**:
```powershell
.\sync-github.ps1
```
* **5분 주기 자동 동기화 (백그라운드)**:
```powershell
.\auto-sync-5min.ps1
```
최신 쿼터 상태와 SQLite DB 스냅샷을 깃허브에 자동 커밋 & 푸시하여 모바일 PWA에 즉시 반영합니다.

---

## 🔒 데이터 보안 및 프라이버시
* 모든 토큰 집계는 사용자의 로컬 환경(`~/.claude`, `~/.codex`, `~/.gemini`)에서 **숫자 통계만 집계**합니다.
* 사용자의 소스 코드나 대화 내용은 파일이나 서버에 저장되지 않으며 외부로 유출되지 않습니다.
