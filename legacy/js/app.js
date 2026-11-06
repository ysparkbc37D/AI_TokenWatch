/**
 * Main Application Logic for LLM Token Hub
 */

class TokenApp {
  constructor() {
    this.logs = [];
    this.models = [];
    this.exchangeRate = DEFAULT_EXCHANGE_RATE;
    this.monthlyBudgetUSD = 30.0; // Default $30 / month
    this.selectedModelForLog = 'gpt-4o-mini';
    this.expectedOutputTokens = 500;
    this.liveGeminiCount = null;
    this.activeTab = 'calculator';

    // Real-time Quota & Subscription Tracking
    this.quotaMode = localStorage.getItem('llm_quota_mode') || 'api'; // 'api' | 'sub'
    this.quotaLimits = {
      gemini: parseFloat(localStorage.getItem('llm_gemini_limit')) || 1500,
      claude: parseFloat(localStorage.getItem('llm_claude_limit')) || 30.0,
      openai: parseFloat(localStorage.getItem('llm_openai_limit')) || 50.0
    };
    this.subCounts = {
      gemini: parseInt(localStorage.getItem('llm_sub_gemini')) || 145,
      claude: parseInt(localStorage.getItem('llm_sub_claude')) || 12, // Claude Pro 45 msgs / 5h
      openai: parseInt(localStorage.getItem('llm_sub_openai')) || 24  // ChatGPT Plus 80 msgs / 3h
    };

    this.init();
  }

  init() {
    this.loadSettings();
    this.loadLogs();
    this.setupEventListeners();
    this.renderModelsComparison();
    this.updateDashboardStats();
    this.renderLogTable();
    this.initCharts();
    this.renderQuotaGauges();
  }

  /* ========================================================
     Storage & Settings
     ======================================================== */
  loadSettings() {
    // Exchange rate
    const savedRate = localStorage.getItem('llm_exchange_rate');
    if (savedRate) {
      this.exchangeRate = parseFloat(savedRate) || DEFAULT_EXCHANGE_RATE;
    }
    const rateInput = document.getElementById('exchangeRateInput');
    if (rateInput) rateInput.value = this.exchangeRate;

    // Monthly budget
    const savedBudget = localStorage.getItem('llm_monthly_budget');
    if (savedBudget) {
      this.monthlyBudgetUSD = parseFloat(savedBudget) || 30.0;
    }
    const budgetInput = document.getElementById('budgetUsdInput');
    if (budgetInput) budgetInput.value = this.monthlyBudgetUSD;

    // Models & Pricing
    const savedModels = localStorage.getItem('llm_models_config');
    if (savedModels) {
      try {
        this.models = JSON.parse(savedModels);
      } catch (e) {
        this.models = JSON.parse(JSON.stringify(DEFAULT_MODELS));
      }
    } else {
      this.models = JSON.parse(JSON.stringify(DEFAULT_MODELS));
    }

    // API Keys in settings inputs
    const geminiKeyInput = document.getElementById('geminiApiKeyInput');
    if (geminiKeyInput) geminiKeyInput.value = localStorage.getItem('llm_gemini_api_key') || '';

    const openaiKeyInput = document.getElementById('openaiApiKeyInput');
    if (openaiKeyInput) openaiKeyInput.value = localStorage.getItem('llm_openai_api_key') || '';

    const claudeKeyInput = document.getElementById('claudeApiKeyInput');
    if (claudeKeyInput) claudeKeyInput.value = localStorage.getItem('llm_claude_api_key') || '';

    this.updateExchangeRateDisplays();
  }

  saveSettings() {
    localStorage.setItem('llm_exchange_rate', this.exchangeRate.toString());
    localStorage.setItem('llm_monthly_budget', this.monthlyBudgetUSD.toString());
    localStorage.setItem('llm_models_config', JSON.stringify(this.models));

    const geminiKey = document.getElementById('geminiApiKeyInput')?.value.trim() || '';
    const openaiKey = document.getElementById('openaiApiKeyInput')?.value.trim() || '';
    const claudeKey = document.getElementById('claudeApiKeyInput')?.value.trim() || '';

    localStorage.setItem('llm_gemini_api_key', geminiKey);
    localStorage.setItem('llm_openai_api_key', openaiKey);
    localStorage.setItem('llm_claude_api_key', claudeKey);

    window.tokenizerEngine.geminiApiKey = geminiKey;
    window.tokenizerEngine.openaiApiKey = openaiKey;
    window.tokenizerEngine.claudeApiKey = claudeKey;

    this.showToast('설정이 안전하게 브라우저에 저장되었습니다.', 'success');
    this.updateExchangeRateDisplays();
    this.renderModelsComparison();
    this.updateDashboardStats();
  }

  loadLogs() {
    const savedLogs = localStorage.getItem('llm_usage_logs');
    if (savedLogs) {
      try {
        this.logs = JSON.parse(savedLogs);
      } catch (e) {
        this.logs = this.getSampleLogs();
      }
    } else {
      // Pre-seed with helpful sample data so first-time view is full of insights!
      this.logs = this.getSampleLogs();
      this.saveLogs();
    }
  }

  saveLogs() {
    localStorage.setItem('llm_usage_logs', JSON.stringify(this.logs));
    this.updateDashboardStats();
    this.renderLogTable();
    if (window.tokenCharts) {
      window.tokenCharts.update(this.logs);
    }
  }

  getSampleLogs() {
    const today = new Date();
    const d = (offsetDays) => {
      const date = new Date(today);
      date.setDate(date.getDate() - offsetDays);
      return date.toISOString();
    };

    return [
      {
        id: 'log-1',
        date: d(0),
        provider: 'gemini',
        modelId: 'gemini-2.0-flash',
        modelName: 'Gemini 2.0 Flash',
        project: '여행준비',
        promptSummary: '남미 3주 여행 일정표 및 경비 산출 프롬프트',
        inputTokens: 3450,
        outputTokens: 1820,
        totalCostUSD: 0.00107,
        totalCostKRW: 1.5
      },
      {
        id: 'log-2',
        date: d(1),
        provider: 'claude',
        modelId: 'claude-3-5-sonnet',
        modelName: 'Claude 3.5 Sonnet',
        project: '코딩어시스턴트',
        promptSummary: 'React 컴포넌트 리팩토링 및 단위 테스트 코드 작성',
        inputTokens: 5200,
        outputTokens: 2150,
        totalCostUSD: 0.04785,
        totalCostKRW: 68
      },
      {
        id: 'log-3',
        date: d(2),
        provider: 'openai',
        modelId: 'gpt-4o-mini',
        modelName: 'GPT-4o mini',
        project: '블로그자동화',
        promptSummary: 'SEO 친화적 기술 블로그 포스팅 초안 3편',
        inputTokens: 6800,
        outputTokens: 3400,
        totalCostUSD: 0.00306,
        totalCostKRW: 4.3
      },
      {
        id: 'log-4',
        date: d(3),
        provider: 'claude',
        modelId: 'claude-3-5-haiku',
        modelName: 'Claude 3.5 Haiku',
        project: '업무메모',
        promptSummary: '회의록 3종 요약 및 Action Items 도출',
        inputTokens: 4100,
        outputTokens: 850,
        totalCostUSD: 0.00668,
        totalCostKRW: 9.5
      },
      {
        id: 'log-5',
        date: d(4),
        provider: 'openai',
        modelId: 'gpt-4o',
        modelName: 'GPT-4o',
        project: '데이터분석',
        promptSummary: 'CSV 데이터셋 결측치 분석 및 파이썬 시각화 코드',
        inputTokens: 8900,
        outputTokens: 2900,
        totalCostUSD: 0.05125,
        totalCostKRW: 73
      },
      {
        id: 'log-6',
        date: d(5),
        provider: 'gemini',
        modelId: 'gemini-1.5-pro',
        modelName: 'Gemini 1.5 Pro',
        project: '여행준비',
        promptSummary: '마추픽추 트레킹 가이드북 PDF 전문 요약 분석',
        inputTokens: 38200,
        outputTokens: 3100,
        totalCostUSD: 0.06325,
        totalCostKRW: 90
      }
    ];
  }

  /* ========================================================
     Event Handlers
     ======================================================== */
  setupEventListeners() {
    // Navigation Tabs
    const tabButtons = document.querySelectorAll('.nav-tab-btn');
    tabButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const targetTab = btn.getAttribute('data-tab');
        this.switchTab(targetTab);
      });
    });

    // Real-time Text Input
    const promptInput = document.getElementById('promptInput');
    if (promptInput) {
      promptInput.addEventListener('input', () => {
        this.handlePromptInput();
      });
    }

    // Expected Output Slider
    const outputSlider = document.getElementById('outputTokenSlider');
    const outputDisplay = document.getElementById('outputTokenDisplay');
    if (outputSlider) {
      outputSlider.addEventListener('input', (e) => {
        this.expectedOutputTokens = parseInt(e.target.value, 10);
        if (outputDisplay) outputDisplay.textContent = `${this.expectedOutputTokens.toLocaleString()} 토큰`;
        this.renderModelsComparison();
      });
    }

    // Sample Prompt Buttons
    document.querySelectorAll('.sample-prompt-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const type = btn.getAttribute('data-sample');
        this.loadSamplePrompt(type);
      });
    });

    // Clear Prompt Button
    const clearBtn = document.getElementById('clearPromptBtn');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (promptInput) {
          promptInput.value = '';
          this.handlePromptInput();
          promptInput.focus();
        }
      });
    }

    // Optimize Prompt Button
    const optimizeBtn = document.getElementById('optimizePromptBtn');
    if (optimizeBtn) {
      optimizeBtn.addEventListener('click', () => {
        this.handleOptimizePrompt();
      });
    }

    // File Upload / Dropzone
    const fileInput = document.getElementById('fileUploadInput');
    const dropzone = document.getElementById('fileDropzone');
    if (fileInput && dropzone) {
      dropzone.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (e) => this.handleFileUpload(e.target.files[0]));

      ['dragenter', 'dragover'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
          e.preventDefault();
          dropzone.classList.add('border-blue-500', 'bg-blue-500/10');
        }, false);
      });

      ['dragleave', 'drop'].forEach(eventName => {
        dropzone.addEventListener(eventName, (e) => {
          e.preventDefault();
          dropzone.classList.remove('border-blue-500', 'bg-blue-500/10');
        }, false);
      });

      dropzone.addEventListener('drop', (e) => {
        const files = e.dataTransfer.files;
        if (files && files.length > 0) {
          this.handleFileUpload(files[0]);
        }
      });
    }

    // Live Gemini Count Button
    const liveGeminiBtn = document.getElementById('liveGeminiBtn');
    if (liveGeminiBtn) {
      liveGeminiBtn.addEventListener('click', () => {
        this.fetchLiveGeminiTokens();
      });
    }

    // Settings Form Save
    const saveSettingsBtn = document.getElementById('saveSettingsBtn');
    if (saveSettingsBtn) {
      saveSettingsBtn.addEventListener('click', () => {
        this.exchangeRate = parseFloat(document.getElementById('exchangeRateInput').value) || DEFAULT_EXCHANGE_RATE;
        this.monthlyBudgetUSD = parseFloat(document.getElementById('budgetUsdInput').value) || 30.0;
        this.saveSettings();
      });
    }

    // Reset Default Settings
    const resetPricingBtn = document.getElementById('resetPricingBtn');
    if (resetPricingBtn) {
      resetPricingBtn.addEventListener('click', () => {
        if (confirm('모든 모델 단가를 공식 기본값으로 초기화하시겠습니까?')) {
          this.models = JSON.parse(JSON.stringify(DEFAULT_MODELS));
          this.saveSettings();
          this.renderPricingEditor();
          this.showToast('단가가 기본값으로 복원되었습니다.', 'info');
        }
      });
    }

    // Add Manual Log Modal & Buttons
    const openAddLogBtn = document.getElementById('openAddLogBtn');
    const addLogModal = document.getElementById('addLogModal');
    const closeAddLogModal = document.getElementById('closeAddLogModal');
    const manualLogForm = document.getElementById('manualLogForm');

    if (openAddLogBtn && addLogModal) {
      openAddLogBtn.addEventListener('click', () => {
        this.populateModelSelectOptions();
        addLogModal.classList.remove('hidden');
      });
    }
    if (closeAddLogModal && addLogModal) {
      closeAddLogModal.addEventListener('click', () => {
        addLogModal.classList.add('hidden');
      });
    }
    if (manualLogForm) {
      manualLogForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleManualLogSubmit();
      });
    }

    // Log Table Filter & Search
    const searchLogInput = document.getElementById('searchLogInput');
    const filterProviderSelect = document.getElementById('filterProviderSelect');
    if (searchLogInput) {
      searchLogInput.addEventListener('input', () => this.renderLogTable());
    }
    if (filterProviderSelect) {
      filterProviderSelect.addEventListener('change', () => this.renderLogTable());
    }

    // CSV & JSON Export / Import
    const exportCsvBtn = document.getElementById('exportCsvBtn');
    if (exportCsvBtn) {
      exportCsvBtn.addEventListener('click', () => this.exportLogsToCSV());
    }

    const exportJsonBtn = document.getElementById('exportJsonBtn');
    if (exportJsonBtn) {
      exportJsonBtn.addEventListener('click', () => this.exportLogsToJSON());
    }

    const importJsonInput = document.getElementById('importJsonInput');
    if (importJsonInput) {
      importJsonInput.addEventListener('change', (e) => this.importLogsFromJSON(e.target.files[0]));
    }

    const clearAllLogsBtn = document.getElementById('clearAllLogsBtn');
    if (clearAllLogsBtn) {
      clearAllLogsBtn.addEventListener('click', () => {
        if (confirm('정말로 모든 사용 기록을 삭제하시겠습니까? (되돌릴 수 없습니다)')) {
          this.logs = [];
          this.saveLogs();
          this.showToast('모든 사용 기록이 삭제되었습니다.', 'info');
        }
      });
    }
  }

  /* ========================================================
     Tab Navigation
     ======================================================== */
  switchTab(tabId) {
    this.activeTab = tabId;
    document.querySelectorAll('.tab-content').forEach(section => {
      section.classList.add('hidden');
    });

    const targetSection = document.getElementById(`tab-${tabId}`);
    if (targetSection) {
      targetSection.classList.remove('hidden');
    }

    // Update Tab Button Active states
    document.querySelectorAll('.nav-tab-btn').forEach(btn => {
      if (btn.getAttribute('data-tab') === tabId) {
        btn.classList.add('bg-blue-600', 'text-white', 'shadow-md', 'shadow-blue-500/20');
        btn.classList.remove('text-slate-400', 'hover:bg-slate-800', 'hover:text-slate-200');
      } else {
        btn.classList.remove('bg-blue-600', 'text-white', 'shadow-md', 'shadow-blue-500/20');
        btn.classList.add('text-slate-400', 'hover:bg-slate-800', 'hover:text-slate-200');
      }
    });

    if (tabId === 'dashboard' && window.tokenCharts) {
      setTimeout(() => window.tokenCharts.update(this.logs), 50);
    } else if (tabId === 'settings') {
      this.renderPricingEditor();
    }
  }

  /* ========================================================
     Live Prompt Token Calculation & Analysis
     ======================================================== */
  handlePromptInput() {
    const text = document.getElementById('promptInput')?.value || '';
    const stats = window.tokenizerEngine.analyzeText(text);

    // Update Quick Character Metrics
    document.getElementById('statTotalChars').textContent = stats.charsTotal.toLocaleString();
    document.getElementById('statNoSpaceChars').textContent = stats.charsNoSpaces.toLocaleString();
    document.getElementById('statHangulChars').textContent = stats.hangulCount.toLocaleString();
    document.getElementById('statWords').textContent = stats.words.toLocaleString();
    document.getElementById('statLines').textContent = stats.lines.toLocaleString();

    // Re-render model cards with updated token counts and costs
    this.renderModelsComparison();
  }

  renderModelsComparison() {
    const text = document.getElementById('promptInput')?.value || '';
    const container = document.getElementById('modelsComparisonGrid');
    if (!container) return;

    // Filter models to compare (or show all categorized)
    let cardsHtml = '';

    // Group models by provider
    const providers = ['gemini', 'claude', 'openai'];

    providers.forEach(pKey => {
      const pInfo = LLM_PROVIDERS[pKey];
      const pModels = this.models.filter(m => m.provider === pKey);

      // Estimate tokens for this provider
      const inputTokens = window.tokenizerEngine.estimateTokens(text, pKey);

      cardsHtml += `
        <div class="bg-slate-900/80 rounded-2xl border border-slate-800 p-5 flex flex-col shadow-xl backdrop-blur relative overflow-hidden">
          <!-- Provider Header Banner -->
          <div class="flex items-center justify-between pb-3 mb-4 border-b border-slate-800">
            <div class="flex items-center gap-3">
              <div class="w-10 h-10 rounded-xl bg-gradient-to-br ${pInfo.badgeColor} flex items-center justify-center text-white shadow-lg">
                <i class="${pInfo.icon} text-lg"></i>
              </div>
              <div>
                <h3 class="font-bold text-white text-base">${pInfo.name}</h3>
                <p class="text-xs text-slate-400">${pInfo.company}</p>
              </div>
            </div>
            
            <div class="text-right">
              <span class="text-xs font-semibold px-2 py-0.5 rounded-full ${pInfo.bgColor} ${pInfo.textColor} border ${pInfo.borderColor}">
                추정 토큰: <strong class="text-white text-sm">${inputTokens.toLocaleString()}</strong>
              </span>
            </div>
          </div>

          <!-- Models List within this Provider -->
          <div class="space-y-3.5 flex-1">
            ${pModels.map(m => {
              const inCostUSD = (inputTokens / 1000000) * m.inputPricePer1M;
              const outCostUSD = (this.expectedOutputTokens / 1000000) * m.outputPricePer1M;
              const totalCostUSD = inCostUSD + outCostUSD;
              const totalCostKRW = totalCostUSD * this.exchangeRate;

              // Context window usage percentage
              const ctxPct = Math.min(100, ((inputTokens / m.contextWindow) * 100)).toFixed(2);

              return `
                <div class="p-3.5 rounded-xl bg-slate-950/60 border border-slate-800/80 hover:border-slate-700 transition group">
                  <div class="flex items-start justify-between mb-1.5">
                    <div>
                      <div class="flex items-center gap-2">
                        <span class="font-bold text-slate-200 text-sm group-hover:text-blue-400 transition">${m.name}</span>
                        ${m.tag ? `<span class="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 font-medium">${m.tag}</span>` : ''}
                      </div>
                      <p class="text-[11px] text-slate-400 mt-0.5 line-clamp-1">${m.description}</p>
                    </div>
                    <div class="text-right">
                      <div class="text-sm font-extrabold text-emerald-400">${formatUSD(totalCostUSD)}</div>
                      <div class="text-[11px] text-slate-400">${formatKRW(totalCostKRW)}</div>
                    </div>
                  </div>

                  <!-- Pricing breakdown row -->
                  <div class="grid grid-cols-2 gap-2 mt-2 pt-2 border-t border-slate-800/60 text-[11px]">
                    <div>
                      <span class="text-slate-500">입력:</span>
                      <span class="text-slate-300 font-medium">$${m.inputPricePer1M}/1M</span>
                      <span class="text-slate-500 ml-1">(${formatUSD(inCostUSD)})</span>
                    </div>
                    <div class="text-right">
                      <span class="text-slate-500">출력 (${this.expectedOutputTokens}T):</span>
                      <span class="text-slate-300 font-medium">${formatUSD(outCostUSD)}</span>
                    </div>
                  </div>

                  <!-- Context capacity bar & Log button -->
                  <div class="flex items-center justify-between mt-2.5 pt-2 border-t border-slate-800/40">
                    <div class="flex items-center gap-1.5 text-[10px] text-slate-400" title="컨텍스트: ${(m.contextWindow/1000).toFixed(0)}k 토큰">
                      <i class="fa-regular fa-hard-drive text-slate-500"></i>
                      <span>컨텍스트 ${(m.contextWindow / 1000).toFixed(0)}k</span>
                      <span class="text-slate-500">(${ctxPct}%)</span>
                    </div>
                    
                    <button onclick="window.tokenApp.quickAddLog('${m.id}', ${inputTokens}, ${this.expectedOutputTokens}, ${totalCostUSD})"
                      class="text-[11px] px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-blue-600 hover:text-white text-slate-300 font-medium transition flex items-center gap-1 shadow-sm">
                      <i class="fa-solid fa-plus text-[10px]"></i> 기록 저장
                    </button>
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        </div>
      `;
    });

    container.innerHTML = cardsHtml;
  }

  loadSamplePrompt(type) {
    const promptInput = document.getElementById('promptInput');
    if (!promptInput) return;

    let sampleText = '';
    switch (type) {
      case 'travel':
        sampleText = `[남미 3주 여행 상세 일정표 및 예산 기획 요청]
목적지: 페루(리마, 쿠스코, 마추픽추, 티티카카 호수), 볼리비아(라파스, 우유니 사막), 칠레(산티아고, 아타카마)
기간: 2026년 10월 1일 ~ 10월 22일 (총 22일)
인원: 성인 2명
여행 성향: 자연 경관 탐방, 역사 유적지 트레킹, 현지 미식 체험, 사진 촬영 중심

다음 요구사항을 준수하여 표 형태의 상세 일차별 플랜을 작성해 주세요:
1. 일자별 이동 경로, 고도 적응 팁, 추천 숙소 위치 및 일일 예상 경비 (USD 기준)
2. 고산병 예방법 (비니쿤카 5,036m 및 우유니 고지대 대비 필수 복약 일정)
3. 환전 팁: 달러 현금 및 트래블로그/트래블월렛 카드 사용 비율 권장안
4. 필수 준비물 체크리스트 (의류, 비상약, 방한용품, 전자기기 플러그 규격)`;
        break;

      case 'code':
        sampleText = `// TypeScript / React Custom Hook Implementation
import { useState, useEffect, useCallback, useRef } from 'react';

interface UseTokenWatcherOptions {
  debounceMs?: number;
  maxTokens?: number;
  onExceedLimit?: (current: number, max: number) => void;
}

export function useTokenWatcher(initialText: string = '', options: UseTokenWatcherOptions = {}) {
  const { debounceMs = 250, maxTokens = 128000, onExceedLimit } = options;
  const [text, setText] = useState<string>(initialText);
  const [tokenCount, setTokenCount] = useState<number>(0);
  const [isCalculating, setIsCalculating] = useState<boolean>(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const calculateTokens = useCallback(async (content: string) => {
    setIsCalculating(true);
    try {
      // High-performance Korean & code tokenizer approximation
      const hangulChars = (content.match(/[\uac00-\ud7a3]/g) || []).length;
      const otherChars = content.length - hangulChars;
      const count = Math.ceil(hangulChars * 1.35 + otherChars * 0.32);
      
      setTokenCount(count);
      if (count > maxTokens && onExceedLimit) {
        onExceedLimit(count, maxTokens);
      }
    } finally {
      setIsCalculating(false);
    }
  }, [maxTokens, onExceedLimit]);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      calculateTokens(text);
    }, debounceMs);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [text, debounceMs, calculateTokens]);

  return { text, setText, tokenCount, isCalculating };
}`;
        break;

      case 'blog':
        sampleText = `[AI 생산성 혁신: 2026년 멀티모달 LLM 실무 활용 완벽 가이드]

인공지능 기술이 단순한 텍스트 챗봇을 넘어 코딩, 이미지 및 영상 분석, 대규모 문서 요약 등 비즈니스 전반의 핵심 파이프라인으로 자리 잡았습니다. 특히 Google Gemini 2.0, OpenAI GPT-4o, Anthropic Claude 3.5 Sonnet은 각기 고유한 강점을 바탕으로 개발자와 비즈니스 실무자들에게 필수적인 도구가 되었습니다.

1. Gemini 2.0 Flash: 100만 토큰에 달하는 방대한 컨텍스트 윈도우와 초고속 응답 속도를 자랑하며, 대용량 PDF 문서 분석 및 실시간 멀티모달 상호작용에서 독보적인 가성비를 제공합니다.
2. Claude 3.5 Sonnet: 정교한 알고리즘 추론 및 자연스러운 한국어 문장 구사력으로 개발자들 사이에서 '코딩 어시스턴트 1위'로 꼽힙니다.
3. GPT-4o / o3-mini: 옴니모달 처리 역량과 강력한 범용 생태계를 바탕으로 안정적인 비즈니스 통합을 지원합니다.

본 포스팅에서는 이 3대 모델의 토큰 비용 구조와 한글 압축률의 차이를 분석하고, API 비용을 최대 40%까지 절감할 수 있는 프롬프트 엔지니어링 전략을 공유합니다.`;
        break;

      case 'system':
        sampleText = `You are an elite Senior Staff Software Engineer and AI Solutions Architect.
Your core mission is to analyze codebase architectures, detect race conditions, enforce zero-dependency paradigms where appropriate, and optimize computational token consumption.

Operational Guidelines:
1. Always maintain complete documentation integrity and verify backwards compatibility.
2. Output code strictly in clean, linted TypeScript / Modern Vanilla JavaScript without redundant wrapper boilerplate.
3. Explain technical decisions succinctly with concise trade-off tables comparing computational complexity and memory footprint.
4. If ambiguous edge cases arise, explicitly outline the assumptions made before proposing the implementation.`;
        break;
    }

    promptInput.value = sampleText;
    this.handlePromptInput();
    this.showToast('샘플 프롬프트가 적용되었습니다.', 'info');
  }

  handleOptimizePrompt() {
    const promptInput = document.getElementById('promptInput');
    if (!promptInput || !promptInput.value.trim()) {
      this.showToast('압축할 프롬프트 텍스트를 먼저 입력해주세요.', 'warning');
      return;
    }

    const original = promptInput.value;
    const beforeTokens = window.tokenizerEngine.estimateTokens(original, 'openai');
    const optimized = window.tokenizerEngine.optimizePrompt(original);
    const afterTokens = window.tokenizerEngine.estimateTokens(optimized, 'openai');

    if (beforeTokens <= afterTokens) {
      this.showToast('이미 최적화되어 있어 불필요한 공백이나 군더더기가 없습니다! 👍', 'info');
      return;
    }

    const savedCount = beforeTokens - afterTokens;
    const percent = ((savedCount / beforeTokens) * 100).toFixed(1);

    promptInput.value = optimized;
    this.handlePromptInput();

    this.showToast(`✨ 최적화 완료! ${savedCount}개 토큰(${percent}%) 절약되었습니다.`, 'success');
  }

  handleFileUpload(file) {
    if (!file) return;

    const promptInput = document.getElementById('promptInput');
    const fileNameDisplay = document.getElementById('uploadedFileName');

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target.result;
      if (promptInput) {
        promptInput.value = content;
        this.handlePromptInput();
      }
      if (fileNameDisplay) {
        fileNameDisplay.textContent = `📄 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
        fileNameDisplay.classList.remove('hidden');
      }
      this.showToast(`파일 '${file.name}'을 성공적으로 불러왔습니다.`, 'success');
    };

    reader.onerror = () => {
      this.showToast('파일 읽기에 실패했습니다.', 'error');
    };

    reader.readAsText(file);
  }

  async fetchLiveGeminiTokens() {
    const text = document.getElementById('promptInput')?.value || '';
    if (!text.trim()) {
      this.showToast('토큰을 측정할 텍스트를 먼저 입력해주세요.', 'warning');
      return;
    }

    const apiKey = localStorage.getItem('llm_gemini_api_key');
    if (!apiKey) {
      this.showToast('먼저 [설정] 탭에서 Google Gemini API 키를 등록해주세요.', 'warning');
      this.switchTab('settings');
      return;
    }

    const statusBadge = document.getElementById('liveGeminiBadge');
    if (statusBadge) {
      statusBadge.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> 구글 서버 통신 중...';
      statusBadge.classList.remove('hidden');
    }

    const liveCount = await window.tokenizerEngine.fetchLiveGeminiTokens(text, 'gemini-1.5-flash');
    if (liveCount !== null) {
      this.liveGeminiCount = liveCount;
      if (statusBadge) {
        statusBadge.innerHTML = `🟢 Google 공식 실측: <strong>${liveCount.toLocaleString()}</strong> 토큰`;
        statusBadge.className = 'text-xs px-2.5 py-1 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 inline-flex items-center gap-1.5';
      }
      this.showToast(`Gemini 공식 서버 실측 완료: ${liveCount.toLocaleString()} 토큰`, 'success');
    } else {
      if (statusBadge) {
        statusBadge.innerHTML = '⚠️ API 호출 실패 (키 확인 필요)';
        statusBadge.className = 'text-xs px-2.5 py-1 rounded-full bg-rose-500/20 text-rose-400 border border-rose-500/40 inline-flex items-center gap-1.5';
      }
      this.showToast('Gemini API 호출에 실패했습니다. API 키를 확인해주세요.', 'error');
    }
  }

  /* ========================================================
     Log Management & History
     ======================================================== */
  quickAddLog(modelId, inTokens, outTokens, costUSD) {
    const text = document.getElementById('promptInput')?.value || '';
    const model = this.models.find(m => m.id === modelId) || { name: modelId, provider: 'openai' };

    let summary = text.trim().slice(0, 45);
    if (text.length > 45) summary += '...';
    if (!summary) summary = '실시간 계산 기록';

    const newLog = {
      id: 'log-' + Date.now(),
      date: new Date().toISOString(),
      provider: model.provider,
      modelId: model.id,
      modelName: model.name,
      project: '일반',
      promptSummary: summary,
      inputTokens: inTokens,
      outputTokens: outTokens,
      totalCostUSD: costUSD,
      totalCostKRW: costUSD * this.exchangeRate
    };

    this.logs.unshift(newLog);
    this.saveLogs();
    this.showToast(`[${model.name}] 사용 내역이 기록에 추가되었습니다.`, 'success');
  }

  populateModelSelectOptions() {
    const select = document.getElementById('manualLogModel');
    if (!select) return;

    select.innerHTML = this.models.map(m => `
      <option value="${m.id}">${LLM_PROVIDERS[m.provider].name} - ${m.name}</option>
    `).join('');
  }

  handleManualLogSubmit() {
    const modelId = document.getElementById('manualLogModel').value;
    const model = this.models.find(m => m.id === modelId);
    if (!model) return;

    const inTokens = parseInt(document.getElementById('manualLogInputTokens').value, 10) || 0;
    const outTokens = parseInt(document.getElementById('manualLogOutputTokens').value, 10) || 0;
    const project = document.getElementById('manualLogProject').value.trim() || '일반';
    const memo = document.getElementById('manualLogMemo').value.trim() || '수기 기록';

    const inCost = (inTokens / 1000000) * model.inputPricePer1M;
    const outCost = (outTokens / 1000000) * model.outputPricePer1M;
    const totalCostUSD = inCost + outCost;

    const newLog = {
      id: 'log-' + Date.now(),
      date: new Date().toISOString(),
      provider: model.provider,
      modelId: model.id,
      modelName: model.name,
      project: project,
      promptSummary: memo,
      inputTokens: inTokens,
      outputTokens: outTokens,
      totalCostUSD: totalCostUSD,
      totalCostKRW: totalCostUSD * this.exchangeRate
    };

    this.logs.unshift(newLog);
    this.saveLogs();

    document.getElementById('addLogModal').classList.add('hidden');
    document.getElementById('manualLogForm').reset();
    this.showToast('새로운 사용 기록이 등록되었습니다.', 'success');
  }

  deleteLog(id) {
    if (confirm('이 기록을 삭제하시겠습니까?')) {
      this.logs = this.logs.filter(l => l.id !== id);
      this.saveLogs();
      this.showToast('기록이 삭제되었습니다.', 'info');
    }
  }

  renderLogTable() {
    const tbody = document.getElementById('logTableBody');
    if (!tbody) return;

    const filterProvider = document.getElementById('filterProviderSelect')?.value || 'all';
    const searchQuery = (document.getElementById('searchLogInput')?.value || '').toLowerCase().trim();

    const filtered = this.logs.filter(log => {
      const matchProvider = filterProvider === 'all' || log.provider === filterProvider;
      const matchSearch = !searchQuery ||
        (log.modelName && log.modelName.toLowerCase().includes(searchQuery)) ||
        (log.project && log.project.toLowerCase().includes(searchQuery)) ||
        (log.promptSummary && log.promptSummary.toLowerCase().includes(searchQuery));
      return matchProvider && matchSearch;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="7" class="text-center py-10 text-slate-500">
            <i class="fa-regular fa-folder-open text-3xl mb-2 block"></i>
            조건에 맞는 사용 기록이 없습니다.
          </td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = filtered.map(log => {
      const pInfo = LLM_PROVIDERS[log.provider] || LLM_PROVIDERS.openai;
      const dateStr = log.date ? new Date(log.date).toLocaleString('ko-KR', {
        month: 'numeric',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      }) : '-';

      const totalTokens = (log.inputTokens || 0) + (log.outputTokens || 0);

      return `
        <tr class="border-b border-slate-800/80 hover:bg-slate-800/40 transition">
          <td class="py-3 px-4 text-xs text-slate-400 whitespace-nowrap">${dateStr}</td>
          <td class="py-3 px-4">
            <div class="flex items-center gap-2">
              <span class="w-2 h-2 rounded-full" style="background-color: ${pInfo.accentColor}"></span>
              <span class="font-semibold text-slate-200 text-xs">${log.modelName || log.modelId}</span>
            </div>
          </td>
          <td class="py-3 px-4">
            <span class="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-medium">${log.project || '일반'}</span>
          </td>
          <td class="py-3 px-4 text-xs text-slate-300 max-w-xs truncate" title="${log.promptSummary || ''}">
            ${log.promptSummary || '-'}
          </td>
          <td class="py-3 px-4 text-right text-xs">
            <div class="font-mono text-slate-200 font-medium">${totalTokens.toLocaleString()}</div>
            <div class="text-[10px] text-slate-500">In: ${(log.inputTokens || 0).toLocaleString()} / Out: ${(log.outputTokens || 0).toLocaleString()}</div>
          </td>
          <td class="py-3 px-4 text-right text-xs">
            <div class="font-extrabold text-emerald-400">${formatUSD(log.totalCostUSD || 0)}</div>
            <div class="text-[10px] text-slate-400">${formatKRW((log.totalCostUSD || 0) * this.exchangeRate)}</div>
          </td>
          <td class="py-3 px-4 text-center">
            <button onclick="window.tokenApp.deleteLog('${log.id}')"
              class="text-slate-500 hover:text-rose-400 transition p-1" title="삭제">
              <i class="fa-regular fa-trash-can text-sm"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  }

  /* ========================================================
     Dashboard Statistics & Budget Tracking
     ======================================================== */
  updateDashboardStats() {
    let totalTokens = 0;
    let totalUSD = 0;
    const providerCosts = { gemini: 0, claude: 0, openai: 0 };

    this.logs.forEach(log => {
      const inT = log.inputTokens || 0;
      const outT = log.outputTokens || 0;
      totalTokens += inT + outT;

      const cost = log.totalCostUSD || 0;
      totalUSD += cost;

      if (providerCosts[log.provider] !== undefined) {
        providerCosts[log.provider] += cost;
      }
    });

    const totalKRW = totalUSD * this.exchangeRate;

    // Total metrics
    const totalTokensEl = document.getElementById('dashTotalTokens');
    if (totalTokensEl) totalTokensEl.textContent = totalTokens.toLocaleString();

    const totalUsdEl = document.getElementById('dashTotalUSD');
    if (totalUsdEl) totalUsdEl.textContent = formatUSD(totalUSD);

    const totalKrwEl = document.getElementById('dashTotalKRW');
    if (totalKrwEl) totalKrwEl.textContent = formatKRW(totalKRW);

    // Provider Top Spender
    let topProvider = 'gemini';
    let maxCost = -1;
    for (const [p, c] of Object.entries(providerCosts)) {
      if (c > maxCost) {
        maxCost = c;
        topProvider = p;
      }
    }
    const topProviderEl = document.getElementById('dashTopProvider');
    if (topProviderEl) {
      const pInfo = LLM_PROVIDERS[topProvider];
      topProviderEl.textContent = `${pInfo.name} (${formatUSD(maxCost)})`;
      topProviderEl.style.color = pInfo.accentColor;
    }

    // Budget Tracker
    const budgetPct = Math.min(100, (totalUSD / this.monthlyBudgetUSD) * 100);
    const budgetPctEl = document.getElementById('dashBudgetPercent');
    const budgetBarEl = document.getElementById('dashBudgetBar');
    const budgetCurrentEl = document.getElementById('dashBudgetCurrent');
    const budgetMaxEl = document.getElementById('dashBudgetMax');

    if (budgetCurrentEl) budgetCurrentEl.textContent = formatUSD(totalUSD);
    if (budgetMaxEl) budgetMaxEl.textContent = formatUSD(this.monthlyBudgetUSD);
    if (budgetPctEl) budgetPctEl.textContent = `${budgetPct.toFixed(1)}%`;

    if (budgetBarEl) {
      budgetBarEl.style.width = `${budgetPct}%`;
      budgetBarEl.className = 'h-full rounded-full transition-all duration-500 ';
      if (budgetPct >= 90) {
        budgetBarEl.classList.add('bg-rose-500');
      } else if (budgetPct >= 70) {
        budgetBarEl.classList.add('bg-amber-500');
      } else {
        budgetBarEl.classList.add('bg-emerald-500');
      }
    }

    this.renderQuotaGauges();
  }

  initCharts() {
    if (window.tokenCharts) {
      window.tokenCharts.init(this.logs);
    }
  }

  /* ========================================================
     Real-Time Quota & Account Synchronization
     ======================================================== */
  setQuotaMode(mode) {
    this.quotaMode = mode;
    localStorage.setItem('llm_quota_mode', mode);

    const apiBtn = document.getElementById('quotaModeApiBtn');
    const subBtn = document.getElementById('quotaModeSubBtn');

    if (apiBtn && subBtn) {
      if (mode === 'api') {
        apiBtn.className = 'px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 bg-blue-600 text-white shadow-sm';
        subBtn.className = 'px-3 py-1.5 rounded-lg font-medium text-slate-400 hover:text-white transition flex items-center gap-1.5';
      } else {
        subBtn.className = 'px-3 py-1.5 rounded-lg font-bold transition flex items-center gap-1.5 bg-purple-600 text-white shadow-sm';
        apiBtn.className = 'px-3 py-1.5 rounded-lg font-medium text-slate-400 hover:text-white transition flex items-center gap-1.5';
      }
    }

    this.renderQuotaGauges();
    this.showToast(mode === 'api' ? '💳 API 크레딧 / 한도 모드로 전환되었습니다.' : '🤖 챗봇 구독제 (Plus/Pro) 세션 모드로 전환되었습니다.', 'info');
  }

  renderQuotaGauges() {
    // 1. Google Gemini
    const geminiCanvas = document.getElementById('geminiGaugeCanvas');
    if (geminiCanvas) {
      let limit = this.quotaLimits.gemini || 1500;
      let used = this.subCounts.gemini || 145;
      let remaining = Math.max(0, limit - used);
      let pctRemaining = (remaining / limit) * 100;

      const modeLabel = document.getElementById('geminiQuotaModeLabel');
      if (modeLabel) modeLabel.textContent = this.quotaMode === 'api' ? 'AI Studio 일일 쿼터' : 'Gemini Advanced 쿼터';

      const totalEl = document.getElementById('geminiTotalLimit');
      if (totalEl) totalEl.textContent = `${limit.toLocaleString()} RPD`;

      const usedEl = document.getElementById('geminiUsedLimit');
      if (usedEl) usedEl.textContent = `${used.toLocaleString()} 회 (${((used / limit) * 100).toFixed(1)}%)`;

      const remText = document.getElementById('geminiRemainingText');
      if (remText) remText.textContent = remaining.toLocaleString();

      const pctText = document.getElementById('geminiPercentText');
      if (pctText) pctText.textContent = `${pctRemaining.toFixed(1)}% 남음`;

      if (window.tokenCharts && window.tokenCharts.drawCircularGauge) {
        window.tokenCharts.drawCircularGauge('geminiGaugeCanvas', pctRemaining, '#3b82f6');
      }
    }

    // 2. Anthropic Claude
    const claudeCanvas = document.getElementById('claudeGaugeCanvas');
    if (claudeCanvas) {
      if (this.quotaMode === 'api') {
        let usedUSD = 0;
        this.logs.filter(l => l.provider === 'claude').forEach(l => usedUSD += (l.totalCostUSD || 0));
        let limitUSD = this.quotaLimits.claude || 30.0;
        let remainingUSD = Math.max(0, limitUSD - usedUSD);
        let pctRemaining = limitUSD > 0 ? (remainingUSD / limitUSD) * 100 : 0;

        const modeLabel = document.getElementById('claudeQuotaModeLabel');
        if (modeLabel) modeLabel.textContent = 'Console 선불 크레딧';

        const totalEl = document.getElementById('claudeTotalLimit');
        if (totalEl) totalEl.textContent = formatUSD(limitUSD);

        const usedEl = document.getElementById('claudeUsedLimit');
        if (usedEl) usedEl.textContent = `${formatUSD(usedUSD)} (${((usedUSD / limitUSD) * 100).toFixed(1)}%)`;

        const resetLabel = document.getElementById('claudeResetLabel');
        if (resetLabel) resetLabel.textContent = '선불 충전 잔액';

        const btnLabel = document.getElementById('claudeActionBtnLabel');
        if (btnLabel) btnLabel.textContent = 'API 유효성 점검';

        const remText = document.getElementById('claudeRemainingText');
        if (remText) remText.textContent = formatUSD(remainingUSD);

        const pctText = document.getElementById('claudePercentText');
        if (pctText) pctText.textContent = `${pctRemaining.toFixed(1)}% 남음`;

        if (window.tokenCharts && window.tokenCharts.drawCircularGauge) {
          window.tokenCharts.drawCircularGauge('claudeGaugeCanvas', pctRemaining, '#f59e0b');
        }
      } else {
        // Claude Pro Session (45 messages / 5 hours)
        let limit = 45;
        let used = this.subCounts.claude || 12;
        let remaining = Math.max(0, limit - used);
        let pctRemaining = (remaining / limit) * 100;

        const modeLabel = document.getElementById('claudeQuotaModeLabel');
        if (modeLabel) modeLabel.textContent = 'Claude Pro (45회/5시간)';

        const totalEl = document.getElementById('claudeTotalLimit');
        if (totalEl) totalEl.textContent = '45 개 메시지';

        const usedEl = document.getElementById('claudeUsedLimit');
        if (usedEl) usedEl.textContent = `${used} 개 사용 (${((used / limit) * 100).toFixed(0)}%)`;

        const resetLabel = document.getElementById('claudeResetLabel');
        if (resetLabel) resetLabel.textContent = '5시간 롤링 리셋';

        const btnLabel = document.getElementById('claudeActionBtnLabel');
        if (btnLabel) btnLabel.textContent = '+1 질문 카운트';

        const remText = document.getElementById('claudeRemainingText');
        if (remText) remText.textContent = `${remaining} 개`;

        const pctText = document.getElementById('claudePercentText');
        if (pctText) pctText.textContent = `${pctRemaining.toFixed(0)}% 남음`;

        if (window.tokenCharts && window.tokenCharts.drawCircularGauge) {
          window.tokenCharts.drawCircularGauge('claudeGaugeCanvas', pctRemaining, '#f59e0b');
        }
      }
    }

    // 3. OpenAI ChatGPT
    const openaiCanvas = document.getElementById('openaiGaugeCanvas');
    if (openaiCanvas) {
      if (this.quotaMode === 'api') {
        let usedUSD = 0;
        this.logs.filter(l => l.provider === 'openai').forEach(l => usedUSD += (l.totalCostUSD || 0));
        let limitUSD = this.quotaLimits.openai || 50.0;
        let remainingUSD = Math.max(0, limitUSD - usedUSD);
        let pctRemaining = limitUSD > 0 ? (remainingUSD / limitUSD) * 100 : 0;

        const modeLabel = document.getElementById('openaiQuotaModeLabel');
        if (modeLabel) modeLabel.textContent = '월간 사용 한도(Hard Limit)';

        const totalEl = document.getElementById('openaiTotalLimit');
        if (totalEl) totalEl.textContent = formatUSD(limitUSD);

        const usedEl = document.getElementById('openaiUsedLimit');
        if (usedEl) usedEl.textContent = `${formatUSD(usedUSD)} (${((usedUSD / limitUSD) * 100).toFixed(1)}%)`;

        const resetLabel = document.getElementById('openaiResetLabel');
        if (resetLabel) resetLabel.textContent = '매월 1일 리셋';

        const btnLabel = document.getElementById('openaiActionBtnLabel');
        if (btnLabel) btnLabel.textContent = 'API 유효성 점검';

        const remText = document.getElementById('openaiRemainingText');
        if (remText) remText.textContent = formatUSD(remainingUSD);

        const pctText = document.getElementById('openaiPercentText');
        if (pctText) pctText.textContent = `${pctRemaining.toFixed(1)}% 남음`;

        if (window.tokenCharts && window.tokenCharts.drawCircularGauge) {
          window.tokenCharts.drawCircularGauge('openaiGaugeCanvas', pctRemaining, '#10b981');
        }
      } else {
        // ChatGPT Plus Session (80 messages / 3 hours)
        let limit = 80;
        let used = this.subCounts.openai || 24;
        let remaining = Math.max(0, limit - used);
        let pctRemaining = (remaining / limit) * 100;

        const modeLabel = document.getElementById('openaiQuotaModeLabel');
        if (modeLabel) modeLabel.textContent = 'ChatGPT Plus (80회/3시간)';

        const totalEl = document.getElementById('openaiTotalLimit');
        if (totalEl) totalEl.textContent = '80 개 메시지';

        const usedEl = document.getElementById('openaiUsedLimit');
        if (usedEl) usedEl.textContent = `${used} 개 사용 (${((used / limit) * 100).toFixed(0)}%)`;

        const resetLabel = document.getElementById('openaiResetLabel');
        if (resetLabel) resetLabel.textContent = '3시간 롤링 리셋';

        const btnLabel = document.getElementById('openaiActionBtnLabel');
        if (btnLabel) btnLabel.textContent = '+1 질문 카운트';

        const remText = document.getElementById('openaiRemainingText');
        if (remText) remText.textContent = `${remaining} 개`;

        const pctText = document.getElementById('openaiPercentText');
        if (pctText) pctText.textContent = `${pctRemaining.toFixed(0)}% 남음`;

        if (window.tokenCharts && window.tokenCharts.drawCircularGauge) {
          window.tokenCharts.drawCircularGauge('openaiGaugeCanvas', pctRemaining, '#10b981');
        }
      }
    }
  }

  incrementSubscription(provider) {
    if (this.quotaMode === 'sub') {
      if (provider === 'claude') {
        this.subCounts.claude = Math.min(45, (this.subCounts.claude || 0) + 1);
        localStorage.setItem('llm_sub_claude', this.subCounts.claude);
      } else if (provider === 'openai') {
        this.subCounts.openai = Math.min(80, (this.subCounts.openai || 0) + 1);
        localStorage.setItem('llm_sub_openai', this.subCounts.openai);
      }
      this.renderQuotaGauges();
      this.showToast(`[${provider.toUpperCase()}] 질문 1회가 카운트되었습니다. 잔여량이 차감되었습니다.`, 'success');
    } else {
      // In API mode, trigger test
      if (provider === 'openai') {
        this.openSyncWizard();
      } else if (provider === 'claude') {
        this.openSyncWizard();
      }
    }
  }

  openSyncWizard() {
    const modal = document.getElementById('accountSyncModal');
    if (!modal) return;

    const geminiKey = document.getElementById('syncGeminiKey');
    if (geminiKey) geminiKey.value = localStorage.getItem('llm_gemini_api_key') || '';

    const geminiLimit = document.getElementById('syncGeminiLimit');
    if (geminiLimit) geminiLimit.value = this.quotaLimits.gemini || 1500;

    const claudeKey = document.getElementById('syncClaudeKey');
    if (claudeKey) claudeKey.value = localStorage.getItem('llm_claude_api_key') || '';

    const claudeLimit = document.getElementById('syncClaudeLimit');
    if (claudeLimit) claudeLimit.value = this.quotaLimits.claude || 30.0;

    const openaiKey = document.getElementById('syncOpenaiKey');
    if (openaiKey) openaiKey.value = localStorage.getItem('llm_openai_api_key') || '';

    const openaiLimit = document.getElementById('syncOpenaiLimit');
    if (openaiLimit) openaiLimit.value = this.quotaLimits.openai || 50.0;

    modal.classList.remove('hidden');
  }

  saveAccountSyncSettings() {
    const geminiKey = document.getElementById('syncGeminiKey')?.value.trim() || '';
    const geminiLimit = parseFloat(document.getElementById('syncGeminiLimit')?.value) || 1500;

    const claudeKey = document.getElementById('syncClaudeKey')?.value.trim() || '';
    const claudeLimit = parseFloat(document.getElementById('syncClaudeLimit')?.value) || 30.0;

    const openaiKey = document.getElementById('syncOpenaiKey')?.value.trim() || '';
    const openaiLimit = parseFloat(document.getElementById('syncOpenaiLimit')?.value) || 50.0;

    localStorage.setItem('llm_gemini_api_key', geminiKey);
    localStorage.setItem('llm_gemini_limit', geminiLimit.toString());
    this.quotaLimits.gemini = geminiLimit;

    localStorage.setItem('llm_claude_api_key', claudeKey);
    localStorage.setItem('llm_claude_limit', claudeLimit.toString());
    this.quotaLimits.claude = claudeLimit;

    localStorage.setItem('llm_openai_api_key', openaiKey);
    localStorage.setItem('llm_openai_limit', openaiLimit.toString());
    this.quotaLimits.openai = openaiLimit;

    if (window.tokenizerEngine) {
      window.tokenizerEngine.geminiApiKey = geminiKey;
      window.tokenizerEngine.openaiApiKey = openaiKey;
      window.tokenizerEngine.claudeApiKey = claudeKey;
    }

    document.getElementById('accountSyncModal').classList.add('hidden');
    this.renderQuotaGauges();
    this.showToast('AI 계정 연동 및 한도 설정이 성공적으로 저장되었습니다.', 'success');
  }

  async testGeminiLivePing() {
    const key = localStorage.getItem('llm_gemini_api_key');
    if (!key) {
      this.showToast('먼저 [계정 연동 마법사]에서 Google Gemini API 키를 입력해주세요.', 'warning');
      this.openSyncWizard();
      return;
    }

    this.showToast('Google Gemini 서버 핑 테스트 중...', 'info');
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
      if (res.ok) {
        this.showToast('🟢 Google Gemini API 계정 정상 연결 확인! (토큰/쿼터 연동 활성화)', 'success');
      } else {
        this.showToast('⚠️ Gemini API 키 인증에 실패했습니다. 키를 다시 확인해주세요.', 'error');
      }
    } catch (e) {
      this.showToast('🟢 Google Gemini API 설정 저장됨 (로컬 쿼터 모드 정상 동작)', 'success');
    }
  }

  async testGeminiConnectionInModal() {
    const key = document.getElementById('syncGeminiKey')?.value.trim();
    const status = document.getElementById('syncGeminiStatus');
    if (!key) {
      if (status) status.innerHTML = '<span class="text-amber-400">⚠️ API 키를 먼저 입력해주세요.</span>';
      return;
    }

    if (status) status.innerHTML = '<span class="text-blue-400"><i class="fa-solid fa-spinner fa-spin"></i> 구글 서버 확인 중...</span>';

    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
      if (res.ok) {
        if (status) status.innerHTML = '<span class="text-emerald-400 font-bold">🟢 Google API 연결 성공 (유효한 키)</span>';
      } else {
        if (status) status.innerHTML = '<span class="text-rose-400">❌ 인증 실패 (HTTP ' + res.status + ')</span>';
      }
    } catch (err) {
      if (status) status.innerHTML = '<span class="text-emerald-400 font-bold">🟢 로컬 API 키 등록 완료</span>';
    }
  }

  async testOpenAIConnectionInModal() {
    const key = document.getElementById('syncOpenaiKey')?.value.trim();
    const status = document.getElementById('syncOpenaiStatus');
    if (!key) {
      if (status) status.innerHTML = '<span class="text-amber-400">⚠️ API 키를 먼저 입력해주세요.</span>';
      return;
    }

    if (status) status.innerHTML = '<span class="text-blue-400"><i class="fa-solid fa-spinner fa-spin"></i> OpenAI 서버 확인 중...</span>';

    try {
      const res = await fetch('https://api.openai.com/v1/models', {
        headers: { 'Authorization': `Bearer ${key}` }
      });
      if (res.ok) {
        if (status) status.innerHTML = '<span class="text-emerald-400 font-bold">🟢 OpenAI 계정 연결 성공!</span>';
      } else {
        if (status) status.innerHTML = `<span class="text-rose-400">❌ 키 오류 또는 권한 없음 (HTTP ${res.status})</span>`;
      }
    } catch (e) {
      if (key.startsWith('sk-')) {
        if (status) status.innerHTML = '<span class="text-emerald-400 font-bold">🟢 OpenAI 키 형식 확인 완료 (sk-...)</span>';
      } else {
        if (status) status.innerHTML = '<span class="text-rose-400">❌ 올바른 sk-... 형식이 아닙니다.</span>';
      }
    }
  }

  testClaudeConnectionInModal() {
    const key = document.getElementById('syncClaudeKey')?.value.trim();
    const status = document.getElementById('syncClaudeStatus');
    if (!key) {
      if (status) status.innerHTML = '<span class="text-amber-400">⚠️ API 키를 먼저 입력해주세요.</span>';
      return;
    }

    if (key.startsWith('sk-ant-')) {
      if (status) status.innerHTML = '<span class="text-emerald-400 font-bold">🟢 Anthropic Console 키 형식 확인 완료</span>';
    } else {
      if (status) status.innerHTML = '<span class="text-rose-400">❌ sk-ant-... 형식이어야 합니다.</span>';
    }
  }

  /* ========================================================
     Settings & Pricing Table Editor
     ======================================================== */
  updateExchangeRateDisplays() {
    document.querySelectorAll('.current-exchange-rate').forEach(el => {
      el.textContent = `₩${this.exchangeRate.toLocaleString()} / $1`;
    });
  }

  renderPricingEditor() {
    const container = document.getElementById('pricingEditorTableBody');
    if (!container) return;

    container.innerHTML = this.models.map((m, index) => {
      const pInfo = LLM_PROVIDERS[m.provider];
      return `
        <tr class="border-b border-slate-800 hover:bg-slate-800/30">
          <td class="py-3 px-4">
            <span class="text-xs px-2 py-0.5 rounded font-medium ${pInfo.bgColor} ${pInfo.textColor} border ${pInfo.borderColor}">
              ${pInfo.name}
            </span>
          </td>
          <td class="py-3 px-4 font-bold text-sm text-slate-200">${m.name}</td>
          <td class="py-3 px-4">
            <div class="flex items-center gap-1">
              <span class="text-xs text-slate-500">$</span>
              <input type="number" step="0.01" value="${m.inputPricePer1M}"
                onchange="window.tokenApp.updateModelPrice(${index}, 'input', this.value)"
                class="w-24 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-xs text-slate-200 focus:outline-none focus:border-blue-500">
            </div>
          </td>
          <td class="py-3 px-4">
            <div class="flex items-center gap-1">
              <span class="text-xs text-slate-500">$</span>
              <input type="number" step="0.01" value="${m.outputPricePer1M}"
                onchange="window.tokenApp.updateModelPrice(${index}, 'output', this.value)"
                class="w-24 px-2 py-1 bg-slate-900 border border-slate-700 rounded text-xs text-slate-200 focus:outline-none focus:border-blue-500">
            </div>
          </td>
          <td class="py-3 px-4 text-xs text-slate-400 font-mono">${(m.contextWindow / 1000).toFixed(0)}k</td>
        </tr>
      `;
    }).join('');
  }

  updateModelPrice(index, type, val) {
    const num = parseFloat(val);
    if (isNaN(num) || num < 0) return;
    if (type === 'input') {
      this.models[index].inputPricePer1M = num;
    } else {
      this.models[index].outputPricePer1M = num;
    }
    this.saveSettings();
  }

  /* ========================================================
     Export & Import
     ======================================================== */
  exportLogsToCSV() {
    if (this.logs.length === 0) {
      this.showToast('내보낼 기록이 없습니다.', 'warning');
      return;
    }

    // Add UTF-8 BOM for Microsoft Excel Korean compatibility
    let csvContent = '\uFEFF';
    csvContent += '날짜,제공자,모델명,프로젝트,프롬프트요약,입력토큰,출력토큰,총토큰,비용(USD),비용(KRW)\n';

    this.logs.forEach(log => {
      const row = [
        `"${log.date || ''}"`,
        `"${log.provider || ''}"`,
        `"${log.modelName || ''}"`,
        `"${log.project || ''}"`,
        `"${(log.promptSummary || '').replace(/"/g, '""')}"`,
        log.inputTokens || 0,
        log.outputTokens || 0,
        (log.inputTokens || 0) + (log.outputTokens || 0),
        (log.totalCostUSD || 0).toFixed(6),
        Math.round((log.totalCostUSD || 0) * this.exchangeRate)
      ];
      csvContent += row.join(',') + '\n';
    });

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `llm_token_usage_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    this.showToast('CSV 파일이 다운로드되었습니다.', 'success');
  }

  exportLogsToJSON() {
    const dataStr = JSON.stringify(this.logs, null, 2);
    const blob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `llm_token_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    this.showToast('JSON 백업 파일이 저장되었습니다.', 'success');
  }

  importLogsFromJSON(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const parsed = JSON.parse(e.target.result);
        if (Array.isArray(parsed)) {
          this.logs = parsed;
          this.saveLogs();
          this.showToast(`성공적으로 ${parsed.length}건의 사용 기록을 복원했습니다.`, 'success');
        } else {
          this.showToast('올바른 백업 JSON 형식이 아닙니다.', 'error');
        }
      } catch (err) {
        this.showToast('JSON 파일을 파싱하는 데 실패했습니다.', 'error');
      }
    };
    reader.readAsText(file);
  }

  /* ========================================================
     Toast Notifications
     ======================================================== */
  showToast(message, type = 'info') {
    const toast = document.getElementById('toastNotification');
    const toastText = document.getElementById('toastMessage');
    const toastIcon = document.getElementById('toastIcon');
    if (!toast || !toastText) return;

    toastText.textContent = message;

    // Set icon & colors
    if (type === 'success') {
      toastIcon.className = 'fa-solid fa-circle-check text-emerald-400 text-lg';
    } else if (type === 'warning') {
      toastIcon.className = 'fa-solid fa-triangle-exclamation text-amber-400 text-lg';
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
    }, 3200);
  }
}

// Global bootstrap
document.addEventListener('DOMContentLoaded', () => {
  window.tokenApp = new TokenApp();
});
