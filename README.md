# LLM Token Manager · AI 토큰 관제

Claude · ChatGPT(Codex) · Gemini(Antigravity) 사용 한도와 토큰 사용량을 한 화면에서 보는 로컬 대시보드입니다.
주간 · 월간 토큰 분석, 사용 습관 가이드, 무료 Gemini API 를 이용한 AI 조언까지 제공합니다.
외부 라이브러리 없이 동작합니다 (Gemini AI 분석만 인터넷 필요).

> 2026-11-07 `00.Projects/여행준비/token-manager` 에서 이 폴더로 옮겼습니다.
> Chrome 확장 프로그램은 이 폴더의 `chrome-extension` 에서 다시 로드해야 합니다.

## 실행

**`TokenDashboard.exe` 를 더블클릭**하면 끝입니다.

1. 포트 8089 를 잡고 있는 이전 서버(어떤 프로그램이든)를 강제로 종료
2. 서버(`serve.ps1`)를 창 없이 새로 시작하고 응답할 때까지 대기
3. Chrome 앱 창으로 대시보드를 엶 (Chrome 이 없으면 Edge, 그것도 없으면 기본 브라우저)

여러 번 눌러도 항상 새 서버로 다시 열립니다. 작업 표시줄에 고정하거나 바로 가기를 바탕 화면에 두면 편합니다.
실패하면 원인(포트를 비우지 못함, 서버 응답 없음)을 알림 창으로 알려 줍니다.

## 처음 한 번: 확장 프로그램 설치

1. Chrome 주소창에 `chrome://extensions` → 오른쪽 위 **개발자 모드** 켜기
2. **압축해제된 확장 프로그램을 로드합니다** → 이 폴더의 `chrome-extension` 선택
3. 같은 Chrome 에서 claude.ai 에 로그인되어 있으면 1분 안에 대시보드가 채워집니다

확장 프로그램 아이콘의 팝업에서 마지막 전송 결과와 실패 이유를 볼 수 있습니다.

## 화면

| 영역 | 내용 |
| :--- | :--- |
| KPI 타일 | Claude 5시간 · ChatGPT(Codex) · Gemini(Antigravity) 가장 빠듯한 모델 · 이번 주 토큰 (각각 작은 추이 그래프) |
| 사용률 추이 | 세 서비스 한도 사용률을 한 그래프에 (6시간 · 24시간 · 7일, 범례를 눌러 선 켜고 끄기) |
| 한도 현황 | 모든 한도의 사용률 · 초기화 시각 · "이 속도면 언제 소진" 예상 (막대 위 흰 선 = 창의 시간 경과) |
| 토큰 비중 / 일별 토큰 | 주간 · 월간 모델별 비중 도넛, 일별 누적 막대, 모델 표 (입력 환산 = 입력 + 1.25×캐시쓰기 + 0.1×캐시읽기 + 5×출력) |
| 효율 | 캐시 재사용률, 출력 비중, 시간대별 사용, 프로젝트별 비중 |
| 현명하게 쓰는 가이드 | 내 기록과 현재 한도로 자동 생성되는 조언 |
| Gemini AI 분석 | 무료 Gemini API 키로 맞춤 조언 (숫자 요약만 전송, 보낼 내용 미리 보기 가능) |
| 상단 상태 | 초록 = 실시간 · 노랑 = 신호 지연 · 빨강 = 서버 꺼짐 |

### 데이터 출처

| 서비스 | 한도 | 토큰 수 |
| :--- | :--- | :--- |
| Claude | Chrome 확장 프로그램이 claude.ai 에서 1분마다 | 로컬 Claude Code 기록 (`~/.claude/projects`) |
| ChatGPT | Codex 기록 속 ChatGPT 요금제 한도 | 로컬 Codex 기록 (`~/.codex/sessions`) |
| Gemini | Antigravity 로컬 서버에서 1분마다 | 없음 (Antigravity 는 토큰 수를 남기지 않음) |

chatgpt.com · gemini.google.com 웹 채팅은 사용량을 알려 주는 창구가 없어 직접 읽을 수 없습니다.
로컬 기록에서는 숫자(토큰 수 · 모델 · 날짜 · 프로젝트 폴더 이름)만 읽고 대화 내용은 읽어 두지 않습니다.

### Gemini AI 분석

1. [Google AI Studio](https://aistudio.google.com/apikey) 에서 무료 API 키 발급
2. 대시보드의 Gemini AI 분석 칸에 붙여넣고 **저장** → 모델 선택 → **AI 분석 받기**

키는 이 브라우저에만 저장되고 서버 · 파일에는 남지 않습니다. 무료 등급 요청은 Google 이 서비스 개선에 쓸 수 있습니다.

## 파일

| 파일 | 역할 |
| :--- | :--- |
| `TokenDashboard.exe` | 실행 파일 (`launch.ps1` 을 창 없이 실행) |
| `launch.ps1` | 포트 정리 → 서버 시작 → 창 열기 |
| `serve.ps1` | 로컬 서버 + API (`/api/quota`, `/api/history*`, `/api/tokens`), Antigravity · Codex 1분 / 2분 주기 수집 |
| `tokens.ps1` | Claude Code · Codex 로컬 기록에서 토큰 집계 (파일별 캐시) |
| `index.html`, `dashboard.css`, `js/viz.js`, `js/analysis.js`, `js/dashboard.js` | 대시보드 화면 · 차트 · 분석 |
| `chrome-extension/` | claude.ai 값을 서버로 보내는 확장 프로그램 |
| `build-exe.ps1` | exe 와 아이콘을 다시 만들 때만 사용 |
| `quota_*.json`, `quota_*.jsonl` | 현재 값 · 기록 · 토큰 캐시 (자동 생성, 브라우저로는 열람 불가) |
| `legacy/` | 처음 버전의 화면과 쓰지 않는 스크립트 (보관용, 현재 앱과 무관) |

`TokenDashboard.exe`, `icon.ico`, `quota_*` 데이터 파일은 git 에 올리지 않습니다 (`.gitignore`).
exe 가 없으면 `build-exe.ps1` 을 실행해 다시 만드세요:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File build-exe.ps1
```

## 직접 실행 (문제 확인용)

서버 오류를 눈으로 보고 싶을 때만:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File serve.ps1
```

다른 포트로 띄우기: `TokenDashboard.exe -Port 8090` (단, 확장 프로그램은 8089 로만 보냅니다).

서버는 `localhost` 에서만 받고, 대시보드 · claude.ai · 확장 프로그램 외의 웹사이트 요청은 거절합니다.

### Antigravity 값을 읽는 방식

Antigravity 는 PC 안에서 `language_server.exe` 를 띄우고, 그 서버가 모델별 한도를 알고 있습니다.
`serve.ps1` 은 그 프로세스의 실행 정보에서 포트와 접속 토큰을 찾아 `GetUserStatus` 를 조회합니다.
토큰은 메모리에서만 쓰고 파일이나 로그에 남기지 않습니다. Google 이 공개한 방식이 아니므로
Antigravity 업데이트 후 값이 안 나오면 이 부분(`Update-Antigravity`)을 손봐야 합니다.
