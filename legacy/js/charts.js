/**
 * Chart Management for LLM Token Hub
 * Uses Chart.js (CDN)
 */

class TokenCharts {
  constructor() {
    this.providerChart = null;
    this.timelineChart = null;
    this.projectChart = null;
  }

  init(logs) {
    this.renderProviderChart(logs);
    this.renderTimelineChart(logs);
    this.renderProjectChart(logs);
  }

  update(logs) {
    this.renderProviderChart(logs);
    this.renderTimelineChart(logs);
    this.renderProjectChart(logs);
  }

  /**
   * 1. Provider Distribution Donut Chart
   */
  renderProviderChart(logs) {
    const ctx = document.getElementById('providerDonutChart');
    if (!ctx) return;

    // Aggregate tokens and cost by provider
    const counts = { gemini: 0, claude: 0, openai: 0 };
    const costs = { gemini: 0, claude: 0, openai: 0 };

    logs.forEach(log => {
      const p = log.provider || 'openai';
      if (counts[p] !== undefined) {
        counts[p] += (log.inputTokens || 0) + (log.outputTokens || 0);
        costs[p] += (log.totalCostUSD || 0);
      }
    });

    const totalTokens = counts.gemini + counts.claude + counts.openai;

    if (this.providerChart) {
      this.providerChart.destroy();
    }

    const dataValues = totalTokens === 0 ? [1, 1, 1] : [counts.gemini, counts.claude, counts.openai];
    const bgColors = totalTokens === 0
      ? ['rgba(59, 130, 246, 0.2)', 'rgba(217, 119, 6, 0.2)', 'rgba(16, 185, 129, 0.2)']
      : ['#3b82f6', '#f59e0b', '#10b981'];

    this.providerChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: ['Google Gemini', 'Anthropic Claude', 'OpenAI ChatGPT'],
        datasets: [{
          data: dataValues,
          backgroundColor: bgColors,
          borderColor: '#1e293b',
          borderWidth: 2,
          hoverOffset: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              color: '#94a3b8',
              font: { size: 12, family: 'Pretendard, Inter, sans-serif' },
              padding: 14
            }
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                if (totalTokens === 0) return '기록 없음';
                const label = context.label || '';
                const val = context.raw || 0;
                const pct = ((val / totalTokens) * 100).toFixed(1);
                return ` ${label}: ${val.toLocaleString()} 토큰 (${pct}%)`;
              }
            }
          }
        },
        cutout: '72%'
      }
    });
  }

  /**
   * 2. Timeline Bar / Line Chart (Last 7 Days)
   */
  renderTimelineChart(logs) {
    const ctx = document.getElementById('timelineChart');
    if (!ctx) return;

    // Generate last 7 days keys (YYYY-MM-DD)
    const days = [];
    const dayLabels = [];
    const now = new Date();

    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(now.getDate() - i);
      const key = d.toISOString().split('T')[0];
      days.push(key);
      dayLabels.push(`${d.getMonth() + 1}/${d.getDate()}`);
    }

    const dayCosts = {
      gemini: new Array(7).fill(0),
      claude: new Array(7).fill(0),
      openai: new Array(7).fill(0)
    };

    logs.forEach(log => {
      const logDate = (log.date || '').split('T')[0];
      const idx = days.indexOf(logDate);
      if (idx !== -1) {
        const p = log.provider || 'openai';
        if (dayCosts[p]) {
          dayCosts[p][idx] += (log.totalCostUSD || 0);
        }
      }
    });

    if (this.timelineChart) {
      this.timelineChart.destroy();
    }

    this.timelineChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: dayLabels,
        datasets: [
          {
            label: 'Gemini ($)',
            data: dayCosts.gemini,
            backgroundColor: 'rgba(59, 130, 246, 0.8)',
            borderRadius: 4
          },
          {
            label: 'Claude ($)',
            data: dayCosts.claude,
            backgroundColor: 'rgba(245, 158, 11, 0.8)',
            borderRadius: 4
          },
          {
            label: 'OpenAI ($)',
            data: dayCosts.openai,
            backgroundColor: 'rgba(16, 185, 129, 0.8)',
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            stacked: true,
            grid: { display: false },
            ticks: { color: '#94a3b8' }
          },
          y: {
            stacked: true,
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: {
              color: '#94a3b8',
              callback: (val) => `$${val}`
            }
          }
        },
        plugins: {
          legend: {
            position: 'top',
            labels: {
              color: '#94a3b8',
              font: { size: 11 }
            }
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                return ` ${context.dataset.label}: $${context.raw.toFixed(4)}`;
              }
            }
          }
        }
      }
    });
  }

  /**
   * 3. Project Distribution Horizontal Bar Chart
   */
  renderProjectChart(logs) {
    const ctx = document.getElementById('projectBarChart');
    if (!ctx) return;

    const projectTokens = {};

    logs.forEach(log => {
      const tag = log.project || '일반 (미분류)';
      const tokens = (log.inputTokens || 0) + (log.outputTokens || 0);
      projectTokens[tag] = (projectTokens[tag] || 0) + tokens;
    });

    const labels = Object.keys(projectTokens);
    const data = labels.map(k => projectTokens[k]);

    if (this.projectChart) {
      this.projectChart.destroy();
    }

    if (labels.length === 0) {
      labels.push('데이터 없음');
      data.push(0);
    }

    this.projectChart = new Chart(ctx, {
      type: 'bar',
      indexAxis: 'y',
      data: {
        labels: labels,
        datasets: [{
          label: '소비 토큰',
          data: data,
          backgroundColor: '#8b5cf6',
          borderRadius: 4
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: {
              color: '#94a3b8',
              callback: (val) => val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val
            }
          },
          y: {
            grid: { display: false },
            ticks: { color: '#94a3b8' }
          }
        },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.raw.toLocaleString()} 토큰`
            }
          }
        }
      }
    });
  }

  /**
   * 4. Draw a modern circular progress gauge on canvas
   */
  drawCircularGauge(canvasId, percentRemaining, mainColor = '#10b981', trackColor = 'rgba(255, 255, 255, 0.08)') {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = width / 2 - 14;
    const lineWidth = 10;

    ctx.clearRect(0, 0, width, height);

    // Background circle track
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
    ctx.strokeStyle = trackColor;
    ctx.lineWidth = lineWidth;
    ctx.stroke();

    // Remaining percentage arc
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + (Math.PI * 2 * (Math.max(0, Math.min(100, percentRemaining)) / 100));

    if (percentRemaining > 0) {
      ctx.beginPath();
      ctx.arc(centerX, centerY, radius, startAngle, endAngle);
      ctx.strokeStyle = mainColor;
      ctx.lineWidth = lineWidth;
      ctx.lineCap = 'round';
      ctx.stroke();
    }
  }
}

window.tokenCharts = new TokenCharts();
