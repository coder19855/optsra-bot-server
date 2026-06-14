(function () {
  const tg = window.Telegram?.WebApp;
  if (tg) {
    tg.ready();
    tg.expand();
    if (tg.setHeaderColor) tg.setHeaderColor('#0d0f12');
    if (tg.setBackgroundColor) tg.setBackgroundColor('#0d0f12');
  }

  const params = new URLSearchParams(window.location.search);
  const symbol = params.get('symbol') || 'NSE:NIFTY50-INDEX';
  const style = params.get('style') || 'INTRADAY';
  const days = params.get('days') || '14';
  const aiMode = params.get('aiMode') || 'shadow';
  const maxTrades = params.get('maxTrades') || '';
  const initData = tg?.initData || '';

  const els = {
    app: document.getElementById('app'),
    overlay: document.getElementById('loading-overlay'),
    symbol: document.getElementById('symbol-label'),
    style: document.getElementById('style-label'),
    days: document.getElementById('days-label'),
    ai: document.getElementById('ai-label'),
    generated: document.getElementById('generated-label'),
    capitalStart: document.getElementById('capital-start'),
    capitalEnd: document.getElementById('capital-end'),
    capitalDelta: document.getElementById('capital-delta'),
    capitalRiskNote: document.getElementById('capital-risk-note'),
    capitalChart: document.getElementById('capital-chart'),
    capitalChartTotal: document.getElementById('capital-chart-total'),
    kpiGrid: document.getElementById('kpi-grid'),
    compareCards: document.getElementById('compare-cards'),
    aiInsights: document.getElementById('ai-insights'),
    equityChart: document.getElementById('equity-chart'),
    curveTotal: document.getElementById('curve-total'),
    exitBars: document.getElementById('exit-bars'),
    tradeCount: document.getElementById('trade-count'),
    tradeTbody: document.getElementById('trade-tbody'),
    notes: document.getElementById('notes'),
    error: document.getElementById('error-line'),
  };

  function shortSymbol(sym) {
    return (sym.split(':')[1] || sym).replace('-INDEX', '');
  }

  function fmtPrice(n) {
    return Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
  }

  function fmtInr(n) {
    const abs = Math.abs(Number(n));
    if (abs >= 100000) {
      return `₹${(n / 100000).toLocaleString('en-IN', { maximumFractionDigits: 2 })}L`;
    }
    return `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  }

  function fmtTime(iso) {
    try {
      return new Date(iso).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return iso;
    }
  }

  function aiModeLabel(mode) {
    if (mode === 'off') return 'AI off';
    if (mode === 'active') return 'AI active';
    return 'AI shadow';
  }

  function pnlClass(v) {
    if (v > 0.05) return 'positive';
    if (v < -0.05) return 'negative';
    return '';
  }

  function renderKpis(summary, capitalSummary) {
    const decided = summary.wins + summary.losses;
    els.kpiGrid.innerHTML = [
      kpiCard('Win rate', `${summary.winRate}%`, `${summary.wins}W / ${summary.losses}L`),
      kpiCard('Total R', `${summary.totalPnlR}R`, `avg ${summary.avgPnlR}R`, pnlClass(summary.totalPnlR)),
      kpiCard('Signals', String(summary.totalSignals), `${decided} decided`),
      kpiCard(
        'Max drawdown',
        capitalSummary ? `${capitalSummary.maxDrawdownPercent}%` : '—',
        capitalSummary
          ? `${fmtInr(-capitalSummary.maxDrawdownInr)} · ${capitalSummary.maxDrawdownR}R`
          : 'From equity peak',
        'negative',
      ),
      kpiCard(
        'TP / trail',
        `${summary.takeProfitCounts['1:1.5']}/${summary.takeProfitCounts['1:2.5']}/${summary.takeProfitCounts['1:4']}`,
        `Trail ${summary.trailFloorCount ?? 0} · Flip ${summary.signalFlipCount ?? 0} · SL ${summary.stopLossCount}`,
      ),
    ].join('');
  }

  function kpiCard(label, value, sub, valueClass) {
    return `<div class="kpi-card">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value ${valueClass || ''}">${value}</div>
      <div class="kpi-sub">${sub}</div>
    </div>`;
  }

  function renderCompare(comparison, aiModeParam) {
    const b = comparison.baseline;
    const ai = comparison.withAi;
    let html = `<div class="compare-card">
      <h3>${b.label}</h3>
      ${compareStat('Win rate', `${b.winRate}%`)}
      ${compareStat('Total R', `${b.totalPnlR}R`, pnlClass(b.totalPnlR))}
      ${compareStat('Signals', String(b.totalSignals))}
    </div>`;

    if (ai && aiModeParam === 'active') {
      html += `<div class="compare-card highlight">
        <h3>${ai.label}</h3>
        ${compareStat('Win rate', `${ai.winRate}%`)}
        ${compareStat('Total R', `${ai.totalPnlR}R`, pnlClass(ai.totalPnlR))}
        ${compareStat('Signals', String(ai.totalSignals))}
      </div>`;
    } else if (aiModeParam === 'shadow') {
      html += `<div class="compare-card highlight">
        <h3>AI shadow (same entries)</h3>
        ${compareStat('Agree on wins', String(comparison.aiAgreeOnWins))}
        ${compareStat('Disagree on wins', String(comparison.aiDisagreeOnWins))}
        ${compareStat('Agree on losses', String(comparison.aiAgreeOnLosses))}
      </div>`;
    } else {
      html += `<div class="compare-card">
        <h3>AI</h3>
        <p class="kpi-sub" style="margin:0">Run with <code>ai-shadow</code> or <code>ai-active</code> to compare.</p>
      </div>`;
    }

    els.compareCards.innerHTML = html;

    const insightParts = [];
    if (aiModeParam === 'shadow') {
      insightParts.push(
        `Shadow mode does not change entries — it records whether AI <span>agrees</span> with each signal.`,
      );
    }
    if (aiModeParam === 'active' && ai) {
      const delta = +(ai.totalPnlR - b.totalPnlR).toFixed(2);
      insightParts.push(
        `Active AI re-gated entries: <span>${delta >= 0 ? '+' : ''}${delta}R</span> vs engine baseline.`,
      );
    }
    insightParts.push(
      `AI agree on wins: <span>${comparison.aiAgreeOnWins}</span> · disagree on wins: <span>${comparison.aiDisagreeOnWins}</span>`,
    );
    els.aiInsights.innerHTML = insightParts.join('<br>');
  }

  function compareStat(label, value, valueClass) {
    return `<div class="compare-stat"><span>${label}</span><strong class="${valueClass || ''}">${value}</strong></div>`;
  }

  function renderExitBars(summary) {
    const total = Math.max(1, summary.totalSignals);
    const rows = [
      { key: 'sl', label: 'Stop loss', count: summary.stopLossCount, cls: 'sl' },
      { key: 'tp1', label: 'TP 1:1.5', count: summary.takeProfitCounts['1:1.5'], cls: 'tp1' },
      { key: 'tp2', label: 'TP 1:2.5', count: summary.takeProfitCounts['1:2.5'], cls: 'tp2' },
      { key: 'tp3', label: 'TP 1:4', count: summary.takeProfitCounts['1:4'], cls: 'tp3' },
      { key: 'trail', label: 'Trail ratchet', count: summary.trailFloorCount ?? 0, cls: 'tp3' },
      { key: 'flip', label: 'Signal flip', count: summary.signalFlipCount ?? 0, cls: 'tp1' },
      { key: 'session', label: 'Session end', count: summary.sessionEndCount, cls: 'session' },
    ];
    els.exitBars.innerHTML = rows
      .map(
        (r) => `<div class="exit-bar-row">
        <span class="exit-bar-label">${r.label}</span>
        <div class="exit-bar-track"><div class="exit-bar-fill ${r.cls}" style="width:${(r.count / total) * 100}%"></div></div>
        <span class="exit-bar-count">${r.count}</span>
      </div>`,
      )
      .join('');
  }

  function renderCapitalHero(summary) {
    if (!summary) return;
    const deltaCls = pnlClass(summary.netPnlInr);
    els.capitalStart.textContent = fmtInr(summary.startingCapitalInr);
    els.capitalEnd.textContent = fmtInr(summary.endingCapitalInr);
    els.capitalEnd.className = `capital-amount highlight ${deltaCls}`;
    els.capitalDelta.textContent = `${summary.netPnlInr >= 0 ? '+' : ''}${fmtInr(summary.netPnlInr)} (${summary.netPnlPercent >= 0 ? '+' : ''}${summary.netPnlPercent}%)`;
    els.capitalDelta.className = `capital-delta ${deltaCls}`;
    els.capitalRiskNote.textContent = `${summary.note} Max drawdown ${summary.maxDrawdownPercent}% (${fmtInr(-summary.maxDrawdownInr)} / ${summary.maxDrawdownR}R).`;
  }

  let capitalChartApi = null;
  let equityChartApi = null;

  function renderCapitalCurve(curve, summary) {
    if (!summary || !curve?.length) return;
    els.capitalChartTotal.textContent = fmtInr(summary.endingCapitalInr);
    els.capitalChartTotal.className = `curve-total ${pnlClass(summary.netPnlInr)}`;

    if (!window.LightweightCharts) return;
    if (capitalChartApi) {
      capitalChartApi.remove();
      capitalChartApi = null;
    }

    capitalChartApi = LightweightCharts.createChart(els.capitalChart, {
      layout: { background: { color: '#161a20' }, textColor: '#8b95a8' },
      grid: { vertLines: { color: '#252b36' }, horzLines: { color: '#252b36' } },
      rightPriceScale: { borderColor: '#252b36' },
      timeScale: { borderColor: '#252b36', timeVisible: true },
      height: 200,
    });

    const series = capitalChartApi.addAreaSeries({
      lineColor: '#fbbf24',
      topColor: 'rgba(251, 191, 36, 0.35)',
      bottomColor: 'rgba(251, 191, 36, 0.02)',
      lineWidth: 2,
    });

    const data = curve.map((p) => ({
      time: Math.floor(p.t / 1000),
      value: p.capitalInr,
    }));
    if (data.length) series.setData(data);
    capitalChartApi.timeScale().fitContent();
  }

  function renderEquityCurve(curve, totalR) {
    els.curveTotal.textContent = `${totalR >= 0 ? '+' : ''}${totalR}R`;
    els.curveTotal.className = `curve-total ${pnlClass(totalR)}`;

    if (!window.LightweightCharts) return;
    if (equityChartApi) {
      equityChartApi.remove();
      equityChartApi = null;
    }

    equityChartApi = LightweightCharts.createChart(els.equityChart, {
      layout: { background: { color: '#161a20' }, textColor: '#8b95a8' },
      grid: { vertLines: { color: '#252b36' }, horzLines: { color: '#252b36' } },
      rightPriceScale: { borderColor: '#252b36' },
      timeScale: { borderColor: '#252b36', timeVisible: true },
      height: 180,
    });

    const series = equityChartApi.addAreaSeries({
      lineColor: '#22d3ee',
      topColor: 'rgba(34, 211, 238, 0.35)',
      bottomColor: 'rgba(34, 211, 238, 0.02)',
      lineWidth: 2,
    });

    const data = curve.map((p) => ({
      time: Math.floor(p.t / 1000),
      value: p.cumulativeR,
    }));
    if (data.length) series.setData(data);
    equityChartApi.timeScale().fitContent();
  }

  function hitLabel(hitLevel, exitStatus) {
    if (hitLevel === 'STOP_LOSS' || exitStatus === 'STOP_LOSS') return 'Stop loss';
    if (hitLevel === '1:1.5') return 'TP 1:1.5';
    if (hitLevel === '1:2.5') return 'TP 1:2.5';
    if (hitLevel === '1:4') return 'TP 1:4';
    if (hitLevel === 'TRAIL_FLOOR') return 'Trail floor';
    if (hitLevel === 'SESSION_END') return 'Session end';
    if (hitLevel === 'SIGNAL_FLIP') return 'Signal flip';
    return hitLevel;
  }

  function renderTrades(trades) {
    els.tradeCount.textContent = `${trades.length} signal${trades.length === 1 ? '' : 's'}`;
    if (!trades.length) {
      els.tradeTbody.innerHTML =
        '<tr><td colspan="7" style="text-align:center;color:var(--muted)">No qualifying signals in this window.</td></tr>';
      return;
    }

    els.tradeTbody.innerHTML = trades
      .map((t) => {
        const sideCls = t.action === 'CE-BUY' ? 'side-ce' : 'side-pe';
        const side = t.action === 'CE-BUY' ? 'CE' : 'PE';
        const hit = hitLabel(t.hitLevel, t.exitStatus);
        const hitCls =
          t.hitLevel === 'STOP_LOSS' || t.exitStatus === 'STOP_LOSS'
            ? 'hit-sl'
            : t.hitLevel === 'SIGNAL_FLIP'
              ? 'hit-tp'
              : 'hit-tp';
        const rowCls = t.isWin ? 'win-row' : t.pnlR < -0.05 ? 'loss-row' : '';
        const aiLine = t.aiVerdictSummary
          ? `<div class="ai-line">${escapeHtml(t.aiVerdictSummary)}</div>`
          : t.aiAnalysis
            ? `<div class="ai-line">AI ${t.aiAnalysis.verdict}</div>`
            : '';

        return `<tr class="${rowCls}">
          <td>${escapeHtml(t.sessionDate)}<br><span class="muted">${fmtTime(t.signalAtISO)}</span></td>
          <td class="${sideCls}">${side}</td>
          <td>${fmtPrice(t.indexEntry)}</td>
          <td>
            <span class="hit-sl">SL ${fmtPrice(t.stopLoss)}</span><br>
            <span class="muted">${fmtPrice(t.takeProfit1)} / ${fmtPrice(t.takeProfit2)} / ${fmtPrice(t.takeProfit3)}</span>
          </td>
          <td class="${hitCls}">${hit}<br><span class="muted">@ ${fmtPrice(t.indexExit)}</span></td>
          <td class="${pnlClass(t.pnlR)}">
            ${t.pnlR >= 0 ? '+' : ''}${t.pnlR}R
            ${t.pnlInr != null ? `<br><span class="muted">${t.pnlInr >= 0 ? '+' : ''}${fmtInr(t.pnlInr)}</span>` : ''}
          </td>
          <td class="verdict-cell">${escapeHtml(t.engineVerdict)}${aiLine}</td>
        </tr>`;
      })
      .join('');
  }

  function escapeHtml(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function apiErrorMessage(body, status) {
    if (body == null) return `HTTP ${status}`;
    if (typeof body === 'string' && body.trim()) return body.trim();
    if (typeof body.error === 'string' && body.error.trim()) return body.error.trim();
    if (typeof body.message === 'string' && body.message.trim()) return body.message.trim();
    if (typeof body.reason === 'string' && body.reason.trim()) return body.reason.trim();
    if (body.error != null && typeof body.error === 'object') {
      return apiErrorMessage(body.error, status);
    }
    try {
      return JSON.stringify(body);
    } catch {
      return `HTTP ${status}`;
    }
  }

  function showError(msg) {
    els.error.textContent = msg;
    els.error.classList.remove('hidden');
    els.overlay.classList.add('hidden');
  }

  function hideLoading() {
    els.overlay.classList.add('hidden');
    els.app.classList.remove('hidden');
  }

  async function load() {
    els.symbol.textContent = shortSymbol(symbol);
    els.style.textContent = style;
    els.days.textContent = `${days}d`;
    els.ai.textContent = maxTrades
      ? `${aiModeLabel(aiMode)} · max ${maxTrades}/day`
      : `${aiModeLabel(aiMode)} · unlimited/day`;

    const qs = new URLSearchParams({ symbol, style, days, aiMode });
    if (maxTrades) qs.set('maxTrades', maxTrades);
    const headers = {};
    if (initData) headers['x-telegram-init-data'] = initData;

    try {
      const res = await fetch(`/api/benchmark?${qs.toString()}`, { headers });
      const body = await res.json();
      if (!res.ok) throw new Error(apiErrorMessage(body, res.status));

      const report = body;
      els.generated.textContent = new Date(report.generatedAt).toLocaleString('en-IN', {
        timeZone: 'Asia/Kolkata',
        dateStyle: 'short',
        timeStyle: 'short',
      });

      renderCapitalHero(report.capitalSummary);
      renderCapitalCurve(report.capitalCurve, report.capitalSummary);
      renderKpis(report.aiComparison.baseline, report.capitalSummary);
      renderCompare(report.aiComparison, report.params.aiMode);
      renderEquityCurve(report.equityCurve, report.aiComparison.baseline.totalPnlR);
      renderExitBars(report.aiComparison.baseline);
      renderTrades(report.trades);

      const noteLines = [
        report.stopLossNote,
        report.simulationNote,
        report.optionFlowNote,
        report.capitalSummary?.note,
        ...report.aiComparison.notes,
      ];
      els.notes.innerHTML = noteLines.map((n) => escapeHtml(n)).join('<br>');

      hideLoading();
    } catch (err) {
      showError(err.message || 'Benchmark failed');
    }
  }

  load();
})();