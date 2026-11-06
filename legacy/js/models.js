/**
 * LLM Models & Pricing Configuration
 * Google Gemini, Anthropic Claude, OpenAI ChatGPT
 * Prices per 1 Million Tokens (USD)
 */

const DEFAULT_EXCHANGE_RATE = 1420; // 1 USD = 1,420 KRW

const LLM_PROVIDERS = {
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    company: 'Google',
    badgeColor: 'from-blue-500 to-indigo-600',
    textColor: 'text-blue-400',
    bgColor: 'bg-blue-500/10',
    borderColor: 'border-blue-500/30',
    icon: 'fa-brands fa-google',
    accentColor: '#3b82f6'
  },
  claude: {
    id: 'claude',
    name: 'Anthropic Claude',
    company: 'Anthropic',
    badgeColor: 'from-amber-600 to-orange-600',
    textColor: 'text-amber-400',
    bgColor: 'bg-amber-500/10',
    borderColor: 'border-amber-500/30',
    icon: 'fa-solid fa-brain',
    accentColor: '#d97706'
  },
  openai: {
    id: 'openai',
    name: 'OpenAI ChatGPT',
    company: 'OpenAI',
    badgeColor: 'from-emerald-500 to-teal-600',
    textColor: 'text-emerald-400',
    bgColor: 'bg-emerald-500/10',
    borderColor: 'border-emerald-500/30',
    icon: 'fa-solid fa-bolt',
    accentColor: '#10b981'
  }
};

const DEFAULT_MODELS = [
  // Google Gemini
  {
    id: 'gemini-2.0-flash',
    provider: 'gemini',
    name: 'Gemini 2.0 Flash',
    description: '최신 차세대 고속 플래그십 모델, 초고속 응답 & 1M 컨텍스트',
    contextWindow: 1048576, // 1M tokens
    maxOutputTokens: 8192,
    inputPricePer1M: 0.10, // $0.10 / 1M
    outputPricePer1M: 0.40, // $0.40 / 1M
    cacheReadPricePer1M: 0.025,
    isPopular: true,
    tag: '초가성비 & 초고속'
  },
  {
    id: 'gemini-1.5-flash',
    provider: 'gemini',
    name: 'Gemini 1.5 Flash',
    description: '가장 경제적인 멀티모달 경량 모델',
    contextWindow: 1048576,
    maxOutputTokens: 8192,
    inputPricePer1M: 0.075,
    outputPricePer1M: 0.30,
    cacheReadPricePer1M: 0.01875,
    isPopular: false,
    tag: '최저가 모델'
  },
  {
    id: 'gemini-1.5-pro',
    provider: 'gemini',
    name: 'Gemini 1.5 Pro',
    description: '최대 200만 토큰 처리, 심층 분석 & 복잡한 코딩',
    contextWindow: 2097152, // 2M tokens
    maxOutputTokens: 8192,
    inputPricePer1M: 1.25, // ≤ 128k
    outputPricePer1M: 5.00,
    cacheReadPricePer1M: 0.3125,
    isPopular: true,
    tag: '최대 2M 컨텍스트'
  },

  // Anthropic Claude
  {
    id: 'claude-3-5-sonnet',
    provider: 'claude',
    name: 'Claude 3.5 Sonnet',
    description: '코딩, 복잡한 추론, 자연스러운 문장력 최강 모델',
    contextWindow: 200000, // 200k tokens
    maxOutputTokens: 8192,
    inputPricePer1M: 3.00,
    outputPricePer1M: 15.00,
    cacheWritePricePer1M: 3.75,
    cacheReadPricePer1M: 0.30,
    isPopular: true,
    tag: '코딩 & 추론 1위'
  },
  {
    id: 'claude-3-5-haiku',
    provider: 'claude',
    name: 'Claude 3.5 Haiku',
    description: '초고속 경량 클로드 모델, 빠른 자동화 및 일상 업무',
    contextWindow: 200000,
    maxOutputTokens: 8192,
    inputPricePer1M: 0.80,
    outputPricePer1M: 4.00,
    cacheWritePricePer1M: 1.00,
    cacheReadPricePer1M: 0.08,
    isPopular: true,
    tag: '고속 & 스마트'
  },
  {
    id: 'claude-3-opus',
    provider: 'claude',
    name: 'Claude 3 Opus',
    description: '방대한 철학/심층 분석용 플래그십 레거시 모델',
    contextWindow: 200000,
    maxOutputTokens: 4096,
    inputPricePer1M: 15.00,
    outputPricePer1M: 75.00,
    cacheWritePricePer1M: 18.75,
    cacheReadPricePer1M: 1.50,
    isPopular: false,
    tag: '심층 학술/문예'
  },

  // OpenAI ChatGPT
  {
    id: 'gpt-4o-mini',
    provider: 'openai',
    name: 'GPT-4o mini',
    description: '매우 저렴하면서도 똑똑한 기본 다목적 소형 모델',
    contextWindow: 128000, // 128k tokens
    maxOutputTokens: 16384,
    inputPricePer1M: 0.15,
    outputPricePer1M: 0.60,
    cacheReadPricePer1M: 0.075,
    isPopular: true,
    tag: '인기 가성비'
  },
  {
    id: 'gpt-4o',
    provider: 'openai',
    name: 'GPT-4o',
    description: 'OpenAI의 대표 옴니 모델, 빠른 속도와 고성능 멀티모달',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    inputPricePer1M: 2.50,
    outputPricePer1M: 10.00,
    cacheReadPricePer1M: 1.25,
    isPopular: true,
    tag: '대표 플래그십'
  },
  {
    id: 'o3-mini',
    provider: 'openai',
    name: 'o3-mini',
    description: '수학, 코딩 및 과학 심층 추론 특화 초경량 모델',
    contextWindow: 200000,
    maxOutputTokens: 100000,
    inputPricePer1M: 1.10,
    outputPricePer1M: 4.40,
    cacheReadPricePer1M: 0.55,
    isPopular: true,
    tag: '최신 고속 추론'
  },
  {
    id: 'o1',
    provider: 'openai',
    name: 'o1',
    description: '복잡한 문제 해결을 위한 최상위 심층 추론 모델',
    contextWindow: 200000,
    maxOutputTokens: 100000,
    inputPricePer1M: 15.00,
    outputPricePer1M: 60.00,
    cacheReadPricePer1M: 7.50,
    isPopular: false,
    tag: '최고난도 추론'
  }
];

// Helper to format currency
function formatUSD(val) {
  if (val === 0) return '$0.00';
  if (val < 0.0001) return `< $0.0001`;
  if (val < 0.01) return `$${val.toFixed(4)}`;
  return `$${val.toFixed(2)}`;
}

function formatKRW(val) {
  if (val === 0) return '₩0';
  if (val < 1) return '< ₩1';
  return `₩${Math.round(val).toLocaleString()}`;
}

function formatTokens(count) {
  if (!count && count !== 0) return '0';
  return count.toLocaleString();
}
