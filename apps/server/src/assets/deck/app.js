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
  const mode = params.get('mode') || 'live';
  const sessionDate = params.get('date') || '';
  const initData = tg?.initData || '';

  function shortSymbolLabel(sym) {
    const part = sym.split(':')[1] || sym;
    return part.replace('-INDEX', '');
  }

  const els = {
    symbol: document.getElementById('symbol-label'),
    style: document.getElementById('style-label'),
    clock: document.getElementById('clock-label'),
    live: document.getElementById('live-badge'),
    actionCard: document.getElementById('action-card'),
    action: document.getElementById('action-label'),
    conviction: document.getElementById('conviction-label'),
    convictionThreshold: document.getElementById('conviction-threshold'),
    status: document.getElementById('status-line'),
    optionValue: document.getElementById('option-value'),
    paValue: document.getElementById('pa-value'),
    needleOption: document.getElementById('needle-option'),
    needlePa: document.getElementById('needle-pa'),
    ghostPa: document.getElementById('ghost-pa'),
    laneOption: document.getElementById('lane-option'),
    lanePa: document.getElementById('lane-pa'),
    laneCombined: document.getElementById('lane-combined'),
    laneOptionPct: document.getElementById('lane-option-pct'),
    lanePaPct: document.getElementById('lane-pa-pct'),
    laneCombinedPct: document.getElementById('lane-combined-pct'),
    spotChart5m: document.getElementById('spot-chart-5m'),
    spotChart15m: document.getElementById('spot-chart-15m'),
    spotChart1h: document.getElementById('spot-chart-1h'),
    patternInsights: document.getElementById('pattern-insights'),
    pnlChart: document.getElementById('pnl-chart'),
    pnlSection: document.getElementById('pnl-section'),
    replayDock: document.getElementById('replay-dock'),
    replaySlider: document.getElementById('replay-slider'),
    replayMeta: document.getElementById('replay-meta'),
    tabBar: document.getElementById('tab-bar'),
    eventsList: document.getElementById('events-list'),
    eventsCount: document.getElementById('events-count'),
    error: document.getElementById('error-line'),
    optionComponents: document.getElementById('option-components'),
    paComponents: document.getElementById('pa-components'),
    paDrilldown: document.getElementById('pa-drilldown'),
    paDrilldownToggle: document.getElementById('pa-drilldown-toggle'),
    optionComponentsNote: document.getElementById('option-components-note'),
    vetoBreakup: document.getElementById('veto-breakup'),
    vetoBreakupTab: document.getElementById('veto-breakup-tab'),
    vetoBreakupNote: document.getElementById('veto-breakup-note'),
    vetoDock: document.getElementById('veto-dock'),
    vetoDockToggle: document.getElementById('veto-dock-toggle'),
    vetoDockSummary: document.getElementById('veto-dock-summary'),
    vetoTabBadge: document.getElementById('veto-tab-badge'),
    signalVetoNotice: document.getElementById('signal-veto-notice'),
    signalFlowNote: document.getElementById('signal-flow-note'),
    laneCombinedLabel: document.getElementById('lane-combined-label'),
    convictionBonuses: document.getElementById('conviction-bonuses'),
    componentsVetoNotice: document.getElementById('components-veto-notice'),
    strategyContent: document.getElementById('strategy-content'),
    strategyReplayNote: document.getElementById('strategy-replay-note'),
    positionsList: document.getElementById('positions-list'),
    positionsCount: document.getElementById('positions-count'),
    positionsNote: document.getElementById('positions-note'),
    positionsTabBadge: document.getElementById('positions-tab-badge'),
    adjustmentsPanel: document.getElementById('tab-adjustments'),
    adjustmentsList: document.getElementById('adjustments-list'),
    marketRegime: document.getElementById('market-regime'),
    marketRegimeArrow: document.getElementById('market-regime-arrow'),
    marketRegimeLabel: document.getElementById('market-regime-label'),
    marketRegimeConfirm: document.getElementById('market-regime-confirm'),
    marketRegimeHint: document.getElementById('market-regime-hint'),
    vetoSection: document.getElementById('veto-section'),
    vetoStrip: document.getElementById('veto-strip'),
    vetoModeOptions: document.getElementById('veto-mode-options'),
    vetoModeNote: document.getElementById('veto-mode-note'),
    spotScrubLabel: document.getElementById('spot-scrub-label'),
    spotSessionLabel: document.getElementById('spot-session-label'),
    patternContext: document.getElementById('pattern-context'),
    spotChartEmpty: document.getElementById('spot-chart-empty'),
    spotChartError: document.getElementById('spot-chart-error'),
    pnlNote: document.getElementById('pnl-note'),
    loadingOverlay: document.getElementById('loading-overlay'),
    chartToggle: document.getElementById('chart-toggle'),
    chartCollapsible: document.getElementById('chart-collapsible'),
  };

  let charts = {
    '5m': { api: null, series: null, scrubLine: null, container: 'spotChart5m' },
    '15m': { api: null, series: null, scrubLine: null, container: 'spotChart15m' },
    '1h': { api: null, series: null, scrubLine: null, container: 'spotChart1h' }
  };
  let pnlChartApi = null;
  let pnlSeries = null;
  let replayPoints = [];
  let replayOptionComponents = [];
  let replayGauges = null;
  let replayEntryThreshold = 60;
  let vetoTimeline = [];
  let deckEvents = [];
  let activeTab = 'signal';
  let activeEventTime = null;
  let pollTimer = null;
  let deckEventSource = null;
  const FALLBACK_POLL_MS = 45_000;
  let vetoMode = 'strict';
  let serverVetoMode = 'strict';
  let serverFlowMode = 'blend';
  let currentMode = mode;
  let spotCandlesPayload = { '5m': [], '15m': [], '1h': [] };
  let pendingSpotScrubPoint = null;
  let pendingSpotScrubAction = null;
  let hasDisplayedDeck = false;
  let patternMarkers = [];
  let chartOverlays = [];
  let chartSession = null;
  let spotOverlayLines = { '5m': [], '15m': [], '1h': [] };
  const SPOT_CHART_HEIGHT = 200;
  let chartsVisible = true;
  els.symbol.textContent = shortSymbolLabel(symbol);
  els.style.textContent = style;

  function setChartsVisible(visible) {
    chartsVisible = visible;
    if (els.chartCollapsible) {
      els.chartCollapsible.classList.toggle('collapsed', !visible);
    }
    if (els.chartToggle) {
      els.chartToggle.setAttribute('aria-expanded', visible ? 'true' : 'false');
      els.chartToggle.textContent = visible ? 'Hide' : 'Show';
    }
    if (visible) {
      requestAnimationFrame(() => {
        mountSpotChart(true);
        flushSpotChart();
      });
    }
  }

  if (els.chartToggle) {
    els.chartToggle.addEventListener('click', () => {
      setChartsVisible(!chartsVisible);
    });
  }

  function deckHasRenderableContent(data) {
    if (!data) return false;
    if (data.mode === 'replay') {
      return (data.replayPoints?.length ?? 0) > 0;
    }
    return (
      (data.optionComponents?.length ?? 0) > 0 ||
      (data.priceActionComponents?.length ?? 0) > 0
    );
  }

  function shouldShowLoadingOverlay() {
    return !hasDisplayedDeck;
  }

  function needleLeft(value) {
    const clamped = Math.max(-1, Math.min(1, Number(value) || 0));
    return `${((clamped + 1) / 2) * 100}%`;
  }

  function formatNeedle(value, label) {
    const v = Number(value) || 0;
    const sign = v >= 0 ? '+' : '';
    return `${sign}${v.toFixed(2)} ${label || ''}`.trim();
  }

  function formatClock(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  }

  function formatIstTime(ms) {
    return new Date(ms).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  function buildIstSessionBounds(anchorMs = Date.now()) {
    const sessionDate = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date(anchorMs));
    const fromMs = new Date(`${sessionDate}T09:15:00+05:30`).getTime();
    const closeMs = new Date(`${sessionDate}T15:30:00+05:30`).getTime();
    const toMs = Math.min(Math.max(anchorMs, fromMs), closeMs);
    return { fromMs, toMs, closeMs, label: '09:15–15:30 IST' };
  }

  function resolveChartSession(ctx, candles) {
    if (ctx?.session) return ctx.session;
    const anchorMs = candles?.at(-1)?.t ?? Date.now();
    return buildIstSessionBounds(anchorMs);
  }

  function filterCandlesToSession(candles, session) {
    if (!session || !candles?.length) return candles || [];
    const filtered = candles.filter(
      (c) => c.t >= session.fromMs && c.t <= session.closeMs + 5 * 60 * 1000,
    );
    return filtered.length ? filtered : candles;
  }

  function formatChartAxisTime(sec) {
    return new Date(sec * 1000).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  function eventTypeLabel(type) {
    if (type === 'flip') return 'Flip';
    if (type === 'veto') return 'Veto';
    if (type === 'veto_clear') return 'Clear';
    if (type === 'trade') return 'Trade';
    return 'Signal';
  }

  function buildEventsFromPayload(data) {
    if (data.events?.length) return data.events;

    const events = [];
    for (const marker of data.markers || []) {
      events.push({
        t: marker.t,
        type: marker.type === 'flip' ? 'flip' : 'signal',
        label: marker.label,
        action: marker.action,
      });
    }

    let prevVetoed = false;
    for (const point of data.vetoTimeline || []) {
      if (point.vetoed && !prevVetoed) {
        events.push({
          t: point.t,
          type: 'veto',
          label: 'Chart veto',
          detail: point.vetoReason,
          action: point.structuralAction || point.action,
        });
      } else if (!point.vetoed && prevVetoed) {
        events.push({
          t: point.t,
          type: 'veto_clear',
          label: 'Veto cleared',
          action: point.action,
        });
      }
      prevVetoed = point.vetoed;
    }

    for (const trade of data.trades || []) {
      const sign = trade.pnlInr >= 0 ? '+' : '';
      events.push({
        t: trade.t,
        type: 'trade',
        label: trade.label,
        detail: `${sign}₹${Math.round(trade.pnlInr)} · ${trade.verdict}`,
        action: trade.verdict,
      });
    }

    return events.sort((a, b) => a.t - b.t);
  }

  function replayIndexForTime(ms) {
    if (!replayPoints.length) return -1;
    let best = 0;
    let bestDiff = Infinity;
    for (let i = 0; i < replayPoints.length; i += 1) {
      const diff = Math.abs(replayPoints[i].t - ms);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    }
    return best;
  }

  function jumpToEvent(event) {
    activeEventTime = event.t;
    renderEvents(deckEvents);

    if (currentMode === 'replay' && replayPoints.length) {
      const idx = replayIndexForTime(event.t);
      switchTab('charts');
      if (idx >= 0) {
        els.replaySlider.value = String(idx);
        applyReplayIndex(idx);
      }
      return;
    }

    switchTab('charts');
    const replayPoint = replayPoints.find((p) => p.t === event.t);
    pendingSpotScrubPoint =
      replayPoint || { t: event.t, spot: null };
    pendingSpotScrubAction =
      replayPoint?.action || event.action || 'NO-TRADE';
    requestAnimationFrame(() => flushSpotChart());
  }

  function renderEvents(events) {
    if (!els.eventsList) return;
    deckEvents = events || [];
    els.eventsList.innerHTML = '';

    if (els.eventsCount) {
      els.eventsCount.textContent =
        deckEvents.length > 0 ? `${deckEvents.length} today` : 'No events';
    }

    if (!deckEvents.length) {
      els.eventsList.innerHTML =
        '<div class="muted" style="font-size:0.72rem">No flips or vetoes in this window yet.</div>';
      return;
    }

    for (const event of deckEvents) {
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'event-row';
      if (activeEventTime === event.t) row.classList.add('active');

      const time = document.createElement('div');
      time.className = 'event-time';
      time.textContent = formatIstTime(event.t);

      const body = document.createElement('div');
      body.className = 'event-body';

      const top = document.createElement('div');
      top.className = 'event-top';

      const badge = document.createElement('span');
      badge.className = `event-badge ${event.type}`;
      badge.textContent = eventTypeLabel(event.type);

      const label = document.createElement('span');
      label.className = 'event-label';
      label.textContent = event.label;

      top.append(badge, label);
      body.append(top);

      if (event.detail) {
        const detail = document.createElement('div');
        detail.className = 'event-detail';
        detail.textContent = event.detail;
        body.append(detail);
      }

      row.append(time, body);
      row.addEventListener('click', () => jumpToEvent(event));
      els.eventsList.appendChild(row);
    }
  }

  function switchTab(tabId) {
    activeTab = tabId;
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.tab === tabId);
    });
    document.querySelectorAll('.tab-panel').forEach((panel) => {
      panel.classList.toggle('active', panel.id === `tab-${tabId}`);
    });
    if (els.vetoDock) {
      els.vetoDock.classList.toggle('hidden', tabId === 'veto' || tabId === 'strategy');
    }
    if (tabId === 'charts') {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          mountSpotChart(true);
          flushSpotChart();
        });
      });
    }
  }

  function isSoftDecayVetoReason(reason) {
    if (!reason) return false;
    return (
      /decay/i.test(reason) ||
      /confidence after decay/i.test(reason) ||
      /opposing 15m structure/i.test(reason)
    );
  }

  function vetoModeStatusText(mode) {
    if (mode === 'off') return 'Veto-off what-if mode';
    if (mode === 'relaxed') return 'Relaxed veto — hard decay only';
    return 'Chart veto active';
  }

  function setFlowModeUi(mode) {
    serverFlowMode = mode || 'blend';
    document.body.classList.toggle('flow-pa-only', serverFlowMode === 'pa-only');
    document.body.classList.toggle('flow-option-only', serverFlowMode === 'option-only');

    if (els.laneCombinedLabel) {
      els.laneCombinedLabel.textContent =
        serverFlowMode === 'pa-only'
          ? 'PA entry'
          : serverFlowMode === 'option-only'
            ? 'Option entry'
            : 'Weighted';
    }

    const signalNote =
      serverFlowMode === 'pa-only'
        ? 'PA-only (/flow pa) — entry score uses price action only; option shown for reference'
        : serverFlowMode === 'option-only'
          ? 'Option-only (/flow option) — entry score uses option flow only; PA shown for reference'
          : '';
    if (els.signalFlowNote) {
      if (signalNote) {
        els.signalFlowNote.textContent = signalNote;
        els.signalFlowNote.classList.remove('hidden');
      } else {
        els.signalFlowNote.textContent = '';
        els.signalFlowNote.classList.add('hidden');
      }
    }
  }

  function setVetoModeUi(mode, { replayOverride = false } = {}) {
    vetoMode = mode;
    document.querySelectorAll('.veto-mode-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.vetoMode === mode);
    });
    if (els.vetoModeNote) {
      if (replayOverride && mode !== serverVetoMode) {
        els.vetoModeNote.textContent = `Previewing ${mode.toUpperCase()} (saved: ${serverVetoMode.toUpperCase()} · use /veto to change live)`;
        els.vetoModeNote.classList.remove('hidden');
      } else if (currentMode === 'live') {
        els.vetoModeNote.textContent = 'Set via /veto strict · relaxed · off in Telegram';
        els.vetoModeNote.classList.remove('hidden');
      } else {
        els.vetoModeNote.classList.add('hidden');
        els.vetoModeNote.textContent = '';
      }
    }
  }

  function setLoading(on, message) {
    if (!els.loadingOverlay) return;
    els.loadingOverlay.classList.toggle('hidden', !on);
    els.loadingOverlay.setAttribute('aria-busy', on ? 'true' : 'false');
    const textEl = els.loadingOverlay.querySelector('.loading-text');
    if (textEl && message) {
      textEl.textContent = message;
    } else if (textEl && !on) {
      textEl.textContent = 'Fetching data…';
    }
  }

  function chartHeight(el, fallback) {
    const measured = el?.clientHeight ?? 0;
    return measured > 0 ? measured : fallback;
  }

  function resizeCharts(fitSpot) {
    Object.keys(charts).forEach(tf => {
      const chart = charts[tf];
      if (chart.api && els[chart.container]) {
        chart.api.applyOptions({
          height: chartHeight(els[chart.container], SPOT_CHART_HEIGHT),
        });
        if (fitSpot && currentMode !== 'live') {
          try {
            chart.api.timeScale().fitContent();
          } catch {
            // Chart may not have data yet.
          }
        } else if (fitSpot && chartSession && spotDataCache[tf]?.length) {
          focusIntradaySession(chartSession, spotDataCache[tf], chart.api);
        }
      }
    });

    if (pnlChartApi && els.pnlChart) {
      pnlChartApi.applyOptions({ height: chartHeight(els.pnlChart, 120) });
    }
  }

  function setSpotChartMessage({ empty, error }) {
    if (els.spotChartEmpty) {
      els.spotChartEmpty.classList.toggle('hidden', !empty);
    }
    if (els.spotChartError) {
      if (error) {
        els.spotChartError.textContent = error;
        els.spotChartError.classList.remove('hidden');
      } else {
        els.spotChartError.textContent = '';
        els.spotChartError.classList.add('hidden');
      }
    }
  }

  function spotChartCanvasWidth() {
    const firstChart = Object.values(charts)[0];
    const canvas = els[firstChart.container]?.querySelector('canvas');
    return canvas?.clientWidth ?? 0;
  }

  function destroySpotChart() {
    clearSpotOverlays();
    Object.keys(charts).forEach(tf => {
      const chart = charts[tf];
      if (chart.api) {
        chart.api.remove();
        chart.api = null;
        chart.series = null;
        chart.scrubLine = null;
      }
    });
  }

  function clearSpotOverlays() {
    Object.keys(charts).forEach(tf => {
      const chart = charts[tf];
      if (!chart.series) {
        spotOverlayLines[tf] = [];
        return;
      }
      for (const line of spotOverlayLines[tf]) {
        try {
          chart.series.removePriceLine(line);
        } catch {
          // Line may already be removed.
        }
      }
      spotOverlayLines[tf] = [];
    });
  }

  function overlayLineColor(tone) {
    if (tone === 'bull') return '#22c55e';
    if (tone === 'bear') return '#ef4444';
    return '#60a5fa';
  }

  function applyChartOverlays(overlays) {
    clearSpotOverlays();
    chartOverlays = overlays || [];
    Object.keys(charts).forEach(tf => {
      const chart = charts[tf];
      if (!chart.series || !chartOverlays.length) return;
      for (const overlay of chartOverlays) {
        const line = chart.series.createPriceLine({
          price: overlay.price,
          color: overlayLineColor(overlay.tone),
          lineWidth: overlay.kind === 'neckline' ? 2 : 1,
          lineStyle: overlay.dashed
            ? LightweightCharts.LineStyle.Dashed
            : LightweightCharts.LineStyle.Solid,
          axisLabelVisible: true,
          title: overlay.label,
        });
        spotOverlayLines[tf].push(line);
      }
    });
  }

  function focusIntradaySession(session, data, api) {
    if (!api || !session) return;
    const lastSec = data?.length ? data[data.length - 1].time : Math.floor(session.toMs / 1000);
    const fromSec = Math.floor(session.fromMs / 1000);
    const toSec = Math.max(
      lastSec + 300,
      Math.floor(session.closeMs / 1000),
    );
    try {
      api.timeScale().setVisibleRange({ from: fromSec, to: toSec });
    } catch {
      try {
        api.timeScale().fitContent();
      } catch {
        // Chart may not be ready yet.
      }
    }
  }

  function mountSpotChart(forceRemount = false) {
    if (typeof LightweightCharts === 'undefined') {
      setSpotChartMessage({
        empty: false,
        error: 'Chart library failed to load. Check network and reload.',
      });
      return false;
    }

    if (forceRemount || (charts['5m'].api && spotChartCanvasWidth() < 10)) {
      destroySpotChart();
    }

    let allMounted = true;
    Object.keys(charts).forEach(tf => {
      const chart = charts[tf];
      const container = els[chart.container];
      if (!container) {
        allMounted = false;
        return;
      }

      if (chart.api) return;

      const width = container.clientWidth;
      if (width <= 0) {
        allMounted = false;
        return;
      }

      try {
        chart.api = LightweightCharts.createChart(container, {
          autoSize: true,
          layout: { background: { color: '#161a20' }, textColor: '#8b95a8' },
          grid: { vertLines: { color: '#252b36' }, horzLines: { color: '#252b36' } },
          rightPriceScale: { borderColor: '#252b36' },
          localization: {
            timeFormatter: (time) => formatChartAxisTime(time),
          },
          timeScale: {
            borderColor: '#252b36',
            timeVisible: true,
            secondsVisible: false,
            fixLeftEdge: true,
            fixRightEdge: false,
            barSpacing: 7,
            minBarSpacing: 4,
          },
          crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
          height: chartHeight(container, SPOT_CHART_HEIGHT),
        });
        chart.series = chart.api.addCandlestickSeries({
          upColor: '#22c55e',
          downColor: '#ef4444',
          borderVisible: false,
          wickUpColor: '#22c55e',
          wickDownColor: '#ef4444',
          priceLineVisible: false,
          lastValueVisible: true,
        });
      } catch (err) {
        console.error(`Failed to mount ${tf} chart:`, err);
        allMounted = false;
      }
    });

    if (allMounted) {
      setSpotChartMessage({ empty: false, error: null });
    }
    return allMounted;
  }

  function flushSpotChart() {
    const hasData = Object.values(spotCandlesPayload).some(c => c.length > 0);
    if (!hasData) {
      setSpotChartMessage({ empty: true, error: null });
      return;
    }
    if (!mountSpotChart(false)) return;
    applySpotChartData(
      spotCandlesPayload,
      pendingSpotScrubPoint,
      pendingSpotScrubAction,
    );
    resizeCharts(false);
  }

  function renderPatternInsights(insights) {
    if (!els.patternInsights) return;
    els.patternInsights.innerHTML = '';

    if (!insights || !insights.length) {
      els.patternInsights.innerHTML = '<div class="muted" style="font-size:0.72rem">No active patterns detected.</div>';
      return;
    }

    for (const insight of insights) {
      const card = document.createElement('div');
      card.className = 'pattern-insight-card';

      const left = document.createElement('div');
      left.className = 'pattern-insight-left';

      const tf = document.createElement('span');
      tf.className = 'pattern-insight-tf';
      tf.textContent = insight.timeframe;

      const name = document.createElement('span');
      name.className = 'pattern-insight-name';
      name.textContent = insight.pattern;

      const type = document.createElement('span');
      type.className = 'pattern-insight-type';
      type.textContent = insight.label;

      left.append(tf, name, type);

      const right = document.createElement('div');
      right.className = 'pattern-insight-right';

      const status = document.createElement('span');
      status.className = `pattern-insight-status ${insight.status}`;
      status.textContent = insight.status;

      const tone = document.createElement('div');
      tone.className = `pattern-insight-tone ${insight.tone}`;

      right.append(status, tone);

      card.append(left, right);
      els.patternInsights.appendChild(card);
    }
  }

  function setError(message) {
    if (!message) {
      els.error.classList.add('hidden');
      els.error.textContent = '';
      return;
    }
    els.error.textContent = message;
    els.error.classList.remove('hidden');
  }

  function formatComponentValue(value) {
    const v = Number(value) || 0;
    const sign = v >= 0 ? '+' : '';
    return `${sign}${v.toFixed(2)}`;
  }

  function vetoBadgeLabel(state) {
    if (state === 'block') return 'BLOCK';
    if (state === 'warn') return 'WARN';
    if (state === 'skipped') return 'EASED';
    return 'OK';
  }

  const VETO_STATE_ORDER = { block: 0, warn: 1, skipped: 2, ok: 3 };

  function sortVetoBreakupItems(items) {
    return [...(items || [])].sort((a, b) => {
      const left = VETO_STATE_ORDER[a.state] ?? 9;
      const right = VETO_STATE_ORDER[b.state] ?? 9;
      if (left !== right) return left - right;
      return 0;
    });
  }

  function summarizeVetoBreakup(items) {
    const counts = { block: 0, warn: 0, skipped: 0, ok: 0 };
    for (const item of items || []) {
      const key = item.state === 'skipped' ? 'skipped' : item.state || 'ok';
      if (counts[key] != null) counts[key] += 1;
    }
    return counts;
  }

  function formatVetoDockSummary(items) {
    const counts = summarizeVetoBreakup(items);
    const parts = [];
    if (counts.block) parts.push(`<span class="count-block">${counts.block} BLOCK</span>`);
    if (counts.warn) parts.push(`<span class="count-warn">${counts.warn} WARN</span>`);
    if (counts.skipped) parts.push(`<span class="count-eased">${counts.skipped} EASED</span>`);
    if (counts.ok) parts.push(`<span class="count-ok">${counts.ok} OK</span>`);
    if (!parts.length) return 'Veto breakup';
    return parts.join(' · ');
  }

  let vetoDockOpen = false;
  let vetoDockTouched = false;

  function setVetoDockOpen(open) {
    vetoDockOpen = open;
    if (els.vetoDock) {
      els.vetoDock.classList.toggle('collapsed', !open);
    }
    if (els.vetoDockToggle) {
      els.vetoDockToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
  }

  function updateVetoChrome(items) {
    const sorted = sortVetoBreakupItems(items);
    const counts = summarizeVetoBreakup(sorted);

    if (els.vetoDockSummary) {
      els.vetoDockSummary.innerHTML = formatVetoDockSummary(sorted);
    }
    if (els.vetoDock) {
      els.vetoDock.classList.toggle('has-block', counts.block > 0);
    }
    if (els.vetoTabBadge) {
      if (counts.block > 0) {
        els.vetoTabBadge.textContent = String(counts.block);
        els.vetoTabBadge.classList.remove('hidden', 'warn-only');
      } else if (counts.warn > 0) {
        els.vetoTabBadge.textContent = String(counts.warn);
        els.vetoTabBadge.classList.remove('hidden');
        els.vetoTabBadge.classList.add('warn-only');
      } else {
        els.vetoTabBadge.textContent = '';
        els.vetoTabBadge.classList.add('hidden');
        els.vetoTabBadge.classList.remove('warn-only');
      }
    }
    return sorted;
  }

  if (els.vetoDockToggle) {
    els.vetoDockToggle.addEventListener('click', () => {
      vetoDockTouched = true;
      setVetoDockOpen(!vetoDockOpen);
    });
  }

  function analyzeVetoScoreImpact(items) {
    const impact = {
      pa: false,
      combined: false,
      option: false,
      notes: [],
    };

    for (const item of items || []) {
      const id = item.id || '';
      const state = item.state || 'ok';
      const detail = item.detail || '';

      if (id === 'decay') {
        const decayMatch = detail.match(/after (\d+)% decay/i);
        if (decayMatch && Number(decayMatch[1]) > 0) {
          impact.pa = true;
          impact.notes.push(`PA −${decayMatch[1]}% decay`);
        } else if (state === 'block' || state === 'warn') {
          impact.pa = true;
          impact.notes.push('PA momentum decay');
        }
      }

      if (id.startsWith('decay-reason') && detail.trim()) {
        impact.pa = true;
      }

      if (id === 'chart' && state !== 'ok') {
        impact.pa = true;
        impact.combined = true;
        impact.option = true;
        impact.notes.push('Chart gate');
      }

      if (id === 'structural' && state !== 'ok') {
        impact.pa = true;
        impact.combined = true;
      }

      if (id === 'min-confidence' && state !== 'ok' && state !== 'skipped') {
        impact.pa = true;
        impact.combined = true;
        impact.notes.push('PA confidence floor');
      }

      if (id === 'enter-threshold' && state !== 'ok') {
        impact.combined = true;
        impact.option = true;
        impact.pa = true;
        impact.notes.push('Below enter bar');
      }

      if (id === 'conflict' && state !== 'ok') {
        impact.option = true;
        impact.combined = true;
        impact.notes.push('Option vs PA conflict');
      }

      if (id === 'outcome' && state !== 'ok') {
        impact.combined = true;
        impact.option = true;
        impact.pa = true;
      }
    }

    impact.notes = [...new Set(impact.notes)];
    return impact;
  }

  function parseVetoedSideFromText(text) {
    const sides = { ce: false, pe: false };
    const t = (text || '').toLowerCase();
    if (
      /ce blocked|ce-buy|bullish chart|bullish structure|momentum decay vetoed bullish|allows ce|suggests ce|structural direction.*ce/i.test(
        t,
      )
    ) {
      sides.ce = true;
    }
    if (
      /pe blocked|pe-buy|bearish chart|bearish structure|momentum decay vetoed bearish|allows pe|suggests pe|structural direction.*pe/i.test(
        t,
      )
    ) {
      sides.pe = true;
    }
    return sides;
  }

  function mergeVetoedSides(target, source) {
    target.ce = target.ce || source.ce;
    target.pe = target.pe || source.pe;
  }

  function inferVetoedSideFromSign(sign, structuralAction) {
    const sides = { ce: false, pe: false };
    if (structuralAction === 'CE-BUY') sides.ce = true;
    else if (structuralAction === 'PE-BUY') sides.pe = true;
    else if (sign > 0.05) sides.ce = true;
    else if (sign < -0.05) sides.pe = true;
    return sides;
  }

  function analyzeVetoedFlowSides(items, context = {}) {
    const pa = { ce: false, pe: false };
    const option = { ce: false, pe: false };
    const optionSign = context.gauges?.option?.value ?? 0;
    const paSign = context.gauges?.priceAction?.value ?? 0;
    const structuralAction = context.structuralAction;

    for (const item of items || []) {
      const state = item.state || 'ok';
      if (state === 'ok' || state === 'skipped') continue;
      const id = item.id || '';
      const detail = item.detail || '';
      const parsed = parseVetoedSideFromText(detail);

      if (
        id === 'chart' ||
        id === 'structural' ||
        id === 'decay' ||
        id.startsWith('decay-reason') ||
        id === 'min-confidence'
      ) {
        mergeVetoedSides(pa, parsed);
        if (!parsed.ce && !parsed.pe) {
          mergeVetoedSides(
            pa,
            inferVetoedSideFromSign(paSign, structuralAction),
          );
        }
      }

      if (id === 'chart' || id === 'enter-threshold' || id === 'outcome') {
        mergeVetoedSides(option, parsed);
        if (!parsed.ce && !parsed.pe) {
          mergeVetoedSides(
            option,
            inferVetoedSideFromSign(optionSign, structuralAction),
          );
        }
      }

      if (id === 'conflict') {
        if (optionSign > 0.05 && paSign < -0.05) option.ce = true;
        else if (optionSign < -0.05 && paSign > 0.05) option.pe = true;
        else mergeVetoedSides(option, parsed);
      }
    }

    if (context.vetoReason) {
      const fromReason = parseVetoedSideFromText(context.vetoReason);
      mergeVetoedSides(pa, fromReason);
      if (context.chartVetoed) mergeVetoedSides(option, fromReason);
    }

    if (context.chartVetoed && structuralAction) {
      if (structuralAction === 'CE-BUY') pa.ce = true;
      if (structuralAction === 'PE-BUY') pa.pe = true;
    }

    if (context.gauges?.priceAction?.ghost != null) {
      mergeVetoedSides(
        pa,
        inferVetoedSideFromSign(
          context.gauges.priceAction.ghost ?? paSign,
          structuralAction,
        ),
      );
    }

    for (const item of items || []) {
      if (item.id !== 'decay') continue;
      const decayMatch = (item.detail || '').match(/after (\d+)% decay/i);
      if (!decayMatch || Number(decayMatch[1]) <= 0) continue;
      mergeVetoedSides(pa, parseVetoedSideFromText(item.detail));
      if (!pa.ce && !pa.pe) {
        mergeVetoedSides(
          pa,
          inferVetoedSideFromSign(paSign, structuralAction),
        );
      }
    }

    const impact = analyzeVetoScoreImpact(items);
    if (impact.pa && !pa.ce && !pa.pe) {
      mergeVetoedSides(pa, inferVetoedSideFromSign(paSign, structuralAction));
    }
    if (impact.option && !option.ce && !option.pe) {
      mergeVetoedSides(
        option,
        inferVetoedSideFromSign(optionSign, structuralAction),
      );
    }

    return { pa, option };
  }

  function applyFlowSideVetoFilter(items, context = {}) {
    const sides = analyzeVetoedFlowSides(items, context);
    const tracks = [
      { el: document.getElementById('gauge-option'), sides: sides.option },
      { el: document.getElementById('gauge-pa'), sides: sides.pa },
    ];

    for (const { el, sides: flowSides } of tracks) {
      if (!el) continue;
      const peZone = el.querySelector('.gauge-zone.pe');
      const ceZone = el.querySelector('.gauge-zone.ce');
      if (peZone) peZone.classList.toggle('flow-side-vetoed', Boolean(flowSides.pe));
      if (ceZone) ceZone.classList.toggle('flow-side-vetoed', Boolean(flowSides.ce));
    }
  }

  function buildFlowVetoContext(source = {}) {
    return {
      gauges: source.gauges,
      structuralAction: source.structuralAction,
      vetoReason: source.vetoReason,
      chartVetoed: Boolean(source.chartVetoed ?? source.vetoed),
    };
  }

  function applyVetoScoreNotice(items, vetoContext = {}) {
    const impact = analyzeVetoScoreImpact(items);
    const anyImpact = impact.pa || impact.combined || impact.option;
    const noticeText = impact.notes.length
      ? `<strong>Veto eating score</strong> — ${impact.notes.join(' · ')}`
      : '';

    if (els.signalVetoNotice) {
      if (anyImpact && noticeText) {
        els.signalVetoNotice.innerHTML = noticeText;
        els.signalVetoNotice.classList.remove('hidden');
      } else {
        els.signalVetoNotice.textContent = '';
        els.signalVetoNotice.classList.add('hidden');
      }
    }
    if (els.componentsVetoNotice) {
      if (anyImpact && noticeText) {
        els.componentsVetoNotice.innerHTML = noticeText;
        els.componentsVetoNotice.classList.remove('hidden');
      } else {
        els.componentsVetoNotice.textContent = '';
        els.componentsVetoNotice.classList.add('hidden');
      }
    }

    applyFlowSideVetoFilter(items, vetoContext);
  }

  function renderVetoBreakup(containers, items, noteText, vetoContext = {}) {
    const sorted = updateVetoChrome(items);
    const targets = (Array.isArray(containers) ? containers : [containers]).filter(
      Boolean,
    );
    for (const container of targets) {
      container.innerHTML = '';
      if (!sorted.length) {
        container.innerHTML =
          '<div class="muted" style="font-size:0.72rem">No veto data</div>';
        continue;
      }

      for (const item of sorted) {
        const row = document.createElement('div');
        row.className = `veto-row ${item.state || 'ok'}`;

        const head = document.createElement('div');
        head.className = 'veto-row-head';

        const label = document.createElement('span');
        label.textContent = item.label;

        const badge = document.createElement('span');
        badge.className = `veto-badge ${item.state || 'ok'}`;
        badge.textContent = vetoBadgeLabel(item.state);

        head.append(label, badge);

        const detail = document.createElement('div');
        detail.className = 'veto-row-detail';
        detail.textContent = item.detail || '';

        row.append(head, detail);

        if (item.meter != null && Number.isFinite(item.meter) && item.meter > 0) {
          const meter = document.createElement('div');
          meter.className = 'veto-meter';
          const fill = document.createElement('div');
          fill.style.width = `${Math.max(0, Math.min(100, item.meter))}%`;
          meter.appendChild(fill);
          row.appendChild(meter);
        }

        container.appendChild(row);
      }
    }

    if (els.vetoBreakupNote) {
      if (noteText) {
        els.vetoBreakupNote.textContent = noteText;
        els.vetoBreakupNote.classList.remove('hidden');
      } else {
        els.vetoBreakupNote.textContent = '';
        els.vetoBreakupNote.classList.add('hidden');
      }
    }

    applyVetoScoreNotice(sorted, vetoContext);
  }

  function appendStrategyDetail(parent, label, value) {
    if (value == null || value === '') return;
    const row = document.createElement('div');
    row.className = 'strategy-detail-row';
    const lbl = document.createElement('span');
    lbl.className = 'strategy-detail-label';
    lbl.textContent = label;
    const val = document.createElement('span');
    val.className = 'strategy-detail-value';
    val.textContent = String(value);
    row.append(lbl, val);
    parent.appendChild(row);
  }

  function createStrategyCard(title, highlight) {
    const card = document.createElement('section');
    card.className = `strategy-card${highlight ? ' highlight' : ''}`;
    const head = document.createElement('div');
    head.className = 'strategy-card-head';
    const titleEl = document.createElement('div');
    titleEl.className = 'strategy-card-title';
    titleEl.textContent = title;
    head.appendChild(titleEl);
    card.appendChild(head);
    const body = document.createElement('div');
    body.className = 'strategy-detail-grid';
    card.appendChild(body);
    return { card, body };
  }

  function strategyActionPillClass(action) {
    if (action === 'CE-BUY') return 'action-ce';
    if (action === 'PE-BUY') return 'action-pe';
    return '';
  }

  function riskClass(risk) {
    return String(risk || '').toLowerCase() === 'low' ? 'low' : '';
  }

  function marketRegimeClass(regime) {
    if (!regime) return '';
    if (regime.kind === 'sideways') return 'sideways';
    if (regime.kind === 'transitional') return 'transitional';
    if (regime.direction === 'down') return 'trending-down';
    return 'trending-up';
  }

  function renderMarketRegime(regime) {
    if (!els.marketRegime) return;

    if (!regime?.kind) {
      els.marketRegime.classList.add('hidden');
      return;
    }

    els.marketRegime.classList.remove(
      'hidden',
      'sideways',
      'transitional',
      'trending-up',
      'trending-down',
      'confirming',
    );
    const regimeClass = marketRegimeClass(regime);
    if (regimeClass) els.marketRegime.classList.add(regimeClass);
    if (regime.confirming) els.marketRegime.classList.add('confirming');

    if (els.marketRegimeArrow) {
      els.marketRegimeArrow.textContent = regime.arrow || '↔';
    }
    if (els.marketRegimeLabel) {
      els.marketRegimeLabel.textContent = regime.label || '—';
    }
    if (els.marketRegimeConfirm) {
      if (regime.confirming && regime.rawKind && regime.rawKind !== regime.kind) {
        const next =
          regime.rawKind === 'sideways'
            ? 'sideways'
            : regime.rawKind === 'trending'
              ? 'trending'
              : 'transitional';
        els.marketRegimeConfirm.textContent = `confirming ${next}…`;
        els.marketRegimeConfirm.classList.remove('hidden');
      } else {
        els.marketRegimeConfirm.textContent = '';
        els.marketRegimeConfirm.classList.add('hidden');
      }
    }
    if (els.marketRegimeHint) {
      els.marketRegimeHint.textContent = regime.hint || '';
    }
  }

  function formatPositionPnl(value) {
    const rounded = Math.round(value);
    const sign = rounded >= 0 ? '+' : '';
    return `${sign}₹${rounded}`;
  }

  function positionPnlClass(value) {
    if (value > 0) return 'up';
    if (value < 0) return 'down';
    return '';
  }

  function renderOpenPositions(payload) {
    if (!els.positionsList) return;

    const entries = payload?.entries || [];
    els.positionsList.innerHTML = '';

    if (els.positionsCount) {
      els.positionsCount.textContent = entries.length
        ? `${entries.length} leg${entries.length === 1 ? '' : 's'}`
        : '—';
    }

    if (els.positionsTabBadge) {
      if (entries.length > 0) {
        els.positionsTabBadge.textContent = String(entries.length);
        els.positionsTabBadge.classList.remove('hidden');
        els.positionsTabBadge.classList.remove('warn-only');
      } else {
        els.positionsTabBadge.textContent = '';
        els.positionsTabBadge.classList.add('hidden');
      }
    }

    if (els.positionsNote) {
      if (payload?.note) {
        els.positionsNote.textContent = payload.note;
        els.positionsNote.classList.remove('hidden');
      } else {
        els.positionsNote.textContent = '';
        els.positionsNote.classList.add('hidden');
      }
    }

    if (!entries.length) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.style.fontSize = '0.72rem';
      empty.textContent =
        payload?.note || 'No open index option legs in your Fyers account.';
      els.positionsList.appendChild(empty);
      return;
    }

    for (const entry of entries) {
      const card = document.createElement('article');
      card.className = `position-card${entry.isWatchedIndex ? ' watched' : ''}`;

      const head = document.createElement('div');
      head.className = 'position-card-head';

      const titleWrap = document.createElement('div');
      const symbol = document.createElement('div');
      symbol.className = 'position-symbol';
      symbol.textContent = entry.optionLabel;
      const index = document.createElement('div');
      index.className = 'position-index';
      index.textContent = entry.indexLabel;
      titleWrap.append(symbol, index);

      const pnl = document.createElement('div');
      pnl.className = `position-pnl ${positionPnlClass(entry.unrealizedPnl)}`;
      pnl.textContent = formatPositionPnl(entry.unrealizedPnl);
      head.append(titleWrap, pnl);
      card.appendChild(head);

      const pills = document.createElement('div');
      pills.className = 'position-meta-row';
      const dirPill = document.createElement('span');
      dirPill.className = `position-pill ${entry.direction === 'CE-BUY' ? 'ce' : 'pe'}`;
      dirPill.textContent = entry.direction;
      pills.appendChild(dirPill);
      if (entry.moneyness) {
        const moneyPill = document.createElement('span');
        moneyPill.className = 'position-pill';
        moneyPill.textContent = entry.moneyness;
        pills.appendChild(moneyPill);
      }
      if (entry.gammaLevel) {
        const gammaPill = document.createElement('span');
        gammaPill.className = `position-pill ${entry.gammaLevel === 'high' ? 'warn' : ''}`;
        gammaPill.textContent = `${entry.gammaLevel} γ`;
        pills.appendChild(gammaPill);
      }
      if (entry.isWatchedIndex) {
        const watchPill = document.createElement('span');
        watchPill.className = 'position-pill good';
        watchPill.textContent = 'Watched';
        pills.appendChild(watchPill);
      }
      card.appendChild(pills);

      const stats = document.createElement('div');
      stats.className = 'position-stats';
      const statDefs = [
        ['Qty', `${entry.netQty} (${entry.lots.toFixed(1)} lots)`],
        ['Strike', entry.strike != null ? String(entry.strike) : '—'],
        ['Avg', entry.buyAvg > 0 ? `₹${entry.buyAvg.toFixed(2)}` : '—'],
        ['LTP', entry.ltp != null ? `₹${entry.ltp.toFixed(2)}` : '—'],
        ['Delta', entry.delta != null ? entry.delta.toFixed(2) : '—'],
        ['Spot', entry.spot != null ? entry.spot.toFixed(2) : '—'],
      ];
      for (const [label, value] of statDefs) {
        const stat = document.createElement('div');
        stat.className = 'position-stat';
        stat.innerHTML = `${label}<strong>${value}</strong>`;
        stats.appendChild(stat);
      }
      card.appendChild(stats);

      const impact = entry.greeksImpact || {};
      const impactLines = [
        impact.summary,
        impact.move50PtsNote,
        impact.deltaNote,
        impact.gammaNote,
        impact.thetaNote,
      ].filter(Boolean);

      if (impactLines.length) {
        const greeks = document.createElement('div');
        greeks.className = 'position-greeks';
        const title = document.createElement('div');
        title.className = 'position-greeks-title';
        title.textContent = 'Greeks impact';
        greeks.appendChild(title);
        for (const line of impactLines) {
          const row = document.createElement('div');
          row.className = 'position-greek-row';
          row.textContent = line;
          greeks.appendChild(row);
        }
        card.appendChild(greeks);
      }

      els.positionsList.appendChild(card);
    }
  }

  function formatInr(value) {
    if (value == null || !Number.isFinite(value)) return '—';
    const rounded = Math.round(value);
    return `₹${rounded.toLocaleString('en-IN')}`;
  }

  function renderTradePlanner(planner) {
    if (!planner) return null;

    const card = document.createElement('section');
    card.className = `strategy-card trade-planner-card${
      planner.favorable ? ' highlight' : ''
    }`;

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'trade-planner-toggle';
    toggle.setAttribute('aria-expanded', planner.favorable ? 'true' : 'false');

    const head = document.createElement('div');
    head.className = 'trade-planner-head';
    const title = document.createElement('div');
    title.className = 'strategy-card-title';
    title.textContent = 'Trade planner';
    const sub = document.createElement('div');
    sub.className = 'trade-planner-sub';
    sub.textContent = planner.headline;
    head.append(title, sub);

    const chevron = document.createElement('span');
    chevron.className = 'trade-planner-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    chevron.textContent = '›';
    toggle.append(head, chevron);

    const body = document.createElement('div');
    body.className = `trade-planner-body${
      planner.favorable ? '' : ' collapsed'
    }`;

    toggle.addEventListener('click', () => {
      const open = body.classList.toggle('collapsed');
      toggle.setAttribute('aria-expanded', open ? 'false' : 'true');
    });

    if (planner.detail) {
      const detail = document.createElement('p');
      detail.className = 'trade-planner-detail';
      detail.textContent = planner.detail;
      body.appendChild(detail);
    }
    if (planner.unavailableReason) {
      const note = document.createElement('p');
      note.className = 'trade-planner-detail';
      note.textContent = planner.unavailableReason;
      body.appendChild(note);
    }
    if (planner.replayNote) {
      const note = document.createElement('p');
      note.className = 'trade-planner-detail';
      note.textContent = planner.replayNote;
      body.appendChild(note);
    }

    if (planner.setup) {
      const setupGrid = document.createElement('div');
      setupGrid.className = 'trade-planner-setup';
      const setupRows = [
        ['Side', planner.suggestion ?? '—'],
        ['Action', planner.suggestionAction ?? '—'],
        [
          'Entry / SL',
          `${planner.setup.entry} · SL ${planner.setup.stopLoss} (${planner.setup.riskPoints.toFixed(1)} pts)`,
        ],
        [
          'Conviction',
          `${planner.conviction}% (enter ${planner.enterThreshold}%)`,
        ],
      ];
      for (const [label, value] of setupRows) {
        const row = document.createElement('div');
        row.className = 'trade-planner-setup-row';
        row.innerHTML = `<span>${label}</span><strong>${value}</strong>`;
        setupGrid.appendChild(row);
      }
      body.appendChild(setupGrid);

      if (planner.setup.targets?.length) {
        const targetWrap = document.createElement('div');
        targetWrap.className = 'trade-planner-targets';
        for (const target of planner.setup.targets) {
          const chip = document.createElement('span');
          chip.className = 'trade-planner-target-chip';
          chip.textContent = `${target.rr} @ ${target.indexPrice} · ${formatInr(target.rewardPerLotInr)}/lot`;
          targetWrap.appendChild(chip);
        }
        body.appendChild(targetWrap);
      }
    }

    if (planner.strike) {
      const strike = document.createElement('p');
      strike.className = 'trade-planner-strike';
      const delta =
        planner.strike.delta != null
          ? ` · Δ ${planner.strike.delta.toFixed(2)}`
          : '';
      strike.textContent = `${planner.strike.strike} @ ${formatInr(planner.strike.premium)}${delta} · lot ${planner.strike.lotSize}`;
      body.appendChild(strike);
    }

    if (planner.account.availableBalance != null) {
      const acct = document.createElement('p');
      acct.className = 'trade-planner-strike';
      acct.textContent = `Funds ${formatInr(planner.account.availableBalance)} · risk budget ${formatInr(planner.account.riskBudgetInr)} · ~${formatInr(planner.account.riskPerLotInr)}/lot`;
      body.appendChild(acct);
    }

    if (planner.scenarios?.length) {
      const tableWrap = document.createElement('div');
      tableWrap.className = 'trade-planner-table-wrap';
      const table = document.createElement('table');
      table.className = 'trade-planner-table';
      table.innerHTML = `
        <thead>
          <tr>
            <th>Lots</th>
            <th>Risk</th>
            <th>Margin</th>
            <th>1:1</th>
            <th>1:2</th>
            <th>1:3</th>
          </tr>
        </thead>
      `;
      const tbody = document.createElement('tbody');
      for (const row of planner.scenarios) {
        const tr = document.createElement('tr');
        if (row.recommended) tr.classList.add('recommended');
        if (!row.fitsRiskBudget || !row.fitsMarginCap) {
          tr.classList.add('over-budget');
        }
        tr.innerHTML = `
          <td>${row.lots}${row.recommended ? ' ★' : ''}</td>
          <td>${formatInr(row.capitalAtRiskInr)}</td>
          <td>${formatInr(row.marginInr)}</td>
          <td>${formatInr(row.reward1RInr)}</td>
          <td>${formatInr(row.reward2RInr)}</td>
          <td>${formatInr(row.reward3RInr)}</td>
        `;
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      tableWrap.appendChild(table);
      body.appendChild(tableWrap);
    }

    card.append(toggle, body);
    return card;
  }

  function renderStrategyRecommendation(payload) {
    if (!els.strategyContent) return;
    els.strategyContent.innerHTML = '';

    if (els.strategyReplayNote) {
      if (payload?.replayNote) {
        els.strategyReplayNote.textContent = payload.replayNote;
        els.strategyReplayNote.classList.remove('hidden');
      } else {
        els.strategyReplayNote.textContent = '';
        els.strategyReplayNote.classList.add('hidden');
      }
    }

    if (!payload) {
      els.strategyContent.innerHTML =
        '<div class="muted" style="font-size:0.72rem">No strategy data</div>';
      return;
    }

    const plannerCard = renderTradePlanner(payload.tradePlanner);
    if (plannerCard) els.strategyContent.appendChild(plannerCard);

    const summary = createStrategyCard('Decision summary', true);
    const pillRow = document.createElement('div');
    pillRow.className = 'strategy-pill-row';
    const actionPill = document.createElement('span');
    actionPill.className = `strategy-pill ${strategyActionPillClass(payload.action)}`;
    actionPill.textContent = payload.action;
    pillRow.appendChild(actionPill);
    const biasPill = document.createElement('span');
    biasPill.className = 'strategy-pill';
    biasPill.textContent = payload.bias;
    pillRow.appendChild(biasPill);
    const convPill = document.createElement('span');
    convPill.className = `strategy-pill ${payload.conviction >= 60 ? 'good' : 'warn'}`;
    convPill.textContent = `${payload.conviction}% conviction`;
    pillRow.appendChild(convPill);
    if (payload.ivRegime) {
      const ivPill = document.createElement('span');
      ivPill.className = 'strategy-pill';
      ivPill.textContent = payload.ivRegime;
      pillRow.appendChild(ivPill);
    }
    summary.card.insertBefore(pillRow, summary.card.querySelector('.strategy-detail-grid'));
    appendStrategyDetail(summary.body, 'Recommendation', payload.recommendation);
    appendStrategyDetail(summary.body, 'Summary', payload.humanSummary);
    if (payload.optionBias) {
      appendStrategyDetail(summary.body, 'Option bias', payload.optionBias);
    }
    els.strategyContent.appendChild(summary.card);

    const guidance = createStrategyCard('Trade guidance', false);
    const consider = payload.tradeGuidance?.shouldConsiderTrade ? 'Yes' : 'No';
    appendStrategyDetail(guidance.body, 'Consider trade', consider);
    appendStrategyDetail(
      guidance.body,
      'Size',
      payload.tradeGuidance?.sizeRecommendation,
    );
    appendStrategyDetail(guidance.body, 'Notes', payload.tradeGuidance?.notes);
    if (payload.tradeGuidance?.thresholds) {
      const t = payload.tradeGuidance.thresholds;
      appendStrategyDetail(
        guidance.body,
        'Thresholds',
        `enter ${t.enter}% · strong ${t.strong}% · caution <${t.cautionBelow}%`,
      );
    }
    if (payload.tradeGuidance?.scoringWeights) {
      const w = payload.tradeGuidance.scoringWeights;
      appendStrategyDetail(
        guidance.body,
        'Weights',
        `PA ${Math.round(w.priceAction * 100)}% · option ${Math.round(w.optionFlow * 100)}%`,
      );
    }
    if (payload.suggestedRiskPercent != null) {
      appendStrategyDetail(
        guidance.body,
        'Risk %',
        `${payload.suggestedRiskPercent}% of capital`,
      );
    }
    for (const note of payload.riskNotes || []) {
      appendStrategyDetail(guidance.body, 'Risk note', note);
    }
    els.strategyContent.appendChild(guidance.card);

    if (payload.exactStrike) {
      const strike = createStrategyCard('Exact strike', true);
      const s = payload.exactStrike;
      appendStrategyDetail(strike.body, 'Symbol', s.fyersSymbol);
      appendStrategyDetail(strike.body, 'Strike', `${s.strike} (${s.moneyness})`);
      appendStrategyDetail(strike.body, 'Premium', `₹${s.premium}`);
      if (s.delta != null) appendStrategyDetail(strike.body, 'Delta', s.delta.toFixed(3));
      appendStrategyDetail(strike.body, 'Lot size', String(s.lotSize));
      if (s.expectedPremiumMove50Pts != null) {
        appendStrategyDetail(
          strike.body,
          'Δ50 pts',
          `≈ ₹${s.expectedPremiumMove50Pts.toFixed(2)} / unit`,
        );
      }
      appendStrategyDetail(strike.body, 'Rationale', s.rationale);
      els.strategyContent.appendChild(strike.card);
    }

    if (payload.greeksStrikeInsight) {
      const greeks = createStrategyCard('Greeks & strike fit', false);
      const insight = payload.greeksStrikeInsight;
      appendStrategyDetail(greeks.body, 'Side', insight.optionSide);
      appendStrategyDetail(greeks.body, 'Best fit', insight.bestFit);
      if (insight.ivNote) appendStrategyDetail(greeks.body, 'IV note', insight.ivNote);
      if (insight.profiles?.length) {
        const label = document.createElement('div');
        label.className = 'strategy-section-label';
        label.textContent = 'Strike profiles';
        greeks.body.appendChild(label);
        for (const profile of insight.profiles) {
          const row = document.createElement('div');
          row.className = 'greeks-profile-row';
          const bits = [
            profile.moneyness,
            profile.strike,
            profile.premium != null ? `₹${profile.premium}` : null,
            profile.gammaLevel ? `${profile.gammaLevel} gamma` : null,
          ].filter(Boolean);
          row.textContent = `${bits.join(' · ')} — ${profile.consequence}`;
          greeks.body.appendChild(row);
        }
      }
      els.strategyContent.appendChild(greeks.card);
    }

    const listCard = createStrategyCard(
      `Recommended strategies (${payload.strategies?.length || 0})`,
      false,
    );
    if (!payload.strategies?.length) {
      appendStrategyDetail(
        listCard.body,
        'Status',
        'No strategies ranked for the current regime.',
      );
    } else {
      for (const [index, strat] of payload.strategies.entries()) {
        const item = document.createElement('div');
        item.className = 'strategy-item';
        const head = document.createElement('div');
        head.className = 'strategy-item-head';
        const name = document.createElement('span');
        name.className = 'strategy-item-name';
        name.textContent = `${index + 1}. ${strat.strategy}`;
        const score = document.createElement('span');
        score.className = 'strategy-score';
        score.textContent = `${strat.confidenceScore}%`;
        head.append(name, score);
        item.appendChild(head);
        if (strat.risk) {
          const risk = document.createElement('div');
          risk.className = `strategy-risk ${riskClass(strat.risk)}`;
          risk.textContent = `${strat.risk} risk`;
          item.appendChild(risk);
        }
        const reason = document.createElement('div');
        reason.className = 'strategy-body';
        reason.textContent = strat.reason;
        item.appendChild(reason);
        if (strat.executionHint) {
          const hint = document.createElement('div');
          hint.className = 'strategy-body';
          hint.textContent = `Execution: ${strat.executionHint}`;
          item.appendChild(hint);
        }
        if (strat.riskManagement) {
          const rm = strat.riskManagement;
          const rmLabel = document.createElement('div');
          rmLabel.className = 'strategy-section-label';
          rmLabel.textContent = 'Risk management';
          item.appendChild(rmLabel);
          const rmGrid = document.createElement('div');
          rmGrid.className = 'strategy-detail-grid';
          appendStrategyDetail(rmGrid, 'Size', rm.positionSizing);
          appendStrategyDetail(rmGrid, 'Stop', rm.stopLoss);
          appendStrategyDetail(rmGrid, 'Target', rm.takeProfit);
          appendStrategyDetail(rmGrid, 'Exit', rm.exitStrategy);
          item.appendChild(rmGrid);
        }
        listCard.body.appendChild(item);
      }
    }
    els.strategyContent.appendChild(listCard.card);
  }

  let paDrilldownOpen = true;
  const paDrilldownSectionState = new Map();

  function setPaDrilldownVisible(open) {
    paDrilldownOpen = open;
    if (els.paDrilldown) {
      els.paDrilldown.classList.toggle('hidden', !open);
    }
    if (els.paDrilldownToggle) {
      els.paDrilldownToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
  }

  function renderPaDrilldown(drilldown) {
    if (!els.paDrilldown) return;
    els.paDrilldown.innerHTML = '';
    if (!drilldown?.sections?.length) {
      els.paDrilldown.innerHTML =
        '<div class="muted" style="font-size:0.68rem">No breakdown available</div>';
      return;
    }

    for (const section of drilldown.sections) {
      const wrap = document.createElement('div');
      wrap.className = 'drilldown-section';
      const defaultOpen =
        paDrilldownSectionState.get(section.id) ??
        (section.id.startsWith('tf-') && section.title.includes('primary'));
      if (defaultOpen) wrap.classList.add('open');

      const head = document.createElement('button');
      head.type = 'button';
      head.className = 'drilldown-section-head';
      head.innerHTML = `<span>${section.title}</span><span class="chevron">›</span>`;
      head.addEventListener('click', () => {
        wrap.classList.toggle('open');
        paDrilldownSectionState.set(section.id, wrap.classList.contains('open'));
      });

      const body = document.createElement('div');
      body.className = 'drilldown-section-body';
      for (const row of section.rows) {
        const rowEl = document.createElement('div');
        rowEl.className = 'drilldown-row';
        const label = document.createElement('span');
        label.className = 'drilldown-label';
        label.textContent = row.label;
        const value = document.createElement('span');
        value.className = 'drilldown-value';
        if (row.tone) value.classList.add(`tone-${row.tone}`);
        value.textContent = row.value;
        rowEl.append(label, value);
        body.appendChild(rowEl);
      }

      wrap.append(head, body);
      els.paDrilldown.appendChild(wrap);
    }
    setPaDrilldownVisible(paDrilldownOpen);
  }

  if (els.paDrilldownToggle) {
    els.paDrilldownToggle.addEventListener('click', () => {
      setPaDrilldownVisible(!paDrilldownOpen);
    });
  }

  function renderComponentList(container, components, variant) {
    if (!container) return;
    container.innerHTML = '';
    if (!components?.length) {
      container.innerHTML = '<div class="muted" style="font-size:0.72rem">No data</div>';
      return;
    }

    for (const comp of components) {
      const row = document.createElement('div');
      row.className = 'bipolar-row';

      const label = document.createElement('span');
      label.className = 'bipolar-label';
      label.textContent = comp.label;
      label.title = comp.interpretation || comp.label;

      const track = document.createElement('div');
      track.className = 'bipolar-track';
      const mid = document.createElement('div');
      mid.className = 'bipolar-mid';
      const fill = document.createElement('div');
      fill.className = 'bipolar-fill';
      const value = Math.max(-1, Math.min(1, Number(comp.value) || 0));
      const width = `${Math.abs(value) * 50}%`;
      fill.style.width = width;
      if (value >= 0) {
        fill.classList.add(variant === 'option' ? 'option-positive' : 'positive');
      } else {
        fill.classList.add(variant === 'option' ? 'option-negative' : 'negative');
      }
      track.append(mid, fill);

      const readout = document.createElement('span');
      readout.className = 'bipolar-value';
      readout.textContent = comp.readout || formatComponentValue(value);

      row.append(label, track, readout);
      container.appendChild(row);
    }
  }

  function applyPercentLane(fillEl, percent) {
    const pct = Math.min(100, Math.max(0, Number(percent) || 0));
    fillEl.style.left = '0';
    fillEl.style.right = 'auto';
    fillEl.style.width = `${pct}%`;
  }

  function computeWhatIfFromGauges(data) {
    const paValue = data.gauges?.priceAction?.value ?? 0;
    let action = data.structuralAction || data.action;
    if (action === 'NO-TRADE' && Math.abs(paValue) >= 0.1) {
      action = paValue > 0 ? 'CE-BUY' : 'PE-BUY';
    }
    if (action === 'NO-TRADE') {
      return { action: 'NO-TRADE', conviction: 0 };
    }
    const conviction = Math.round(
      Math.min(90, Math.max(20, Math.abs(paValue) * 100)),
    );
    return { action, conviction };
  }

  function resolveLiveDisplay(data) {
    const vetoed = Boolean(
      data.chartVetoed ||
        data.vetoReason ||
        (data.action === 'NO-TRADE' &&
          data.structuralAction &&
          data.structuralAction !== 'NO-TRADE'),
    );

    if (!vetoed || serverVetoMode === 'strict') {
      return {
        action: data.action,
        conviction: data.conviction,
        whatIf: false,
      };
    }

    const useWhatIf =
      serverVetoMode === 'off' ||
      (serverVetoMode === 'relaxed' && isSoftDecayVetoReason(data.vetoReason));

    if (!useWhatIf) {
      return {
        action: data.action,
        conviction: data.conviction,
        whatIf: false,
      };
    }

    const whatIf = computeWhatIfFromGauges(data);
    return {
      action: whatIf.action,
      conviction: whatIf.conviction,
      whatIf: true,
    };
  }

  function updateEntryConviction(conviction, threshold, action) {
    const pct = Number(conviction) || 0;
    const need = Number(threshold) || 60;
    els.conviction.textContent = `${pct}%`;
    if (els.convictionThreshold) {
      els.convictionThreshold.textContent = ` / ${need}%`;
    }
    els.conviction.classList.remove('at-threshold', 'below-threshold');
    const tradeable = action === 'CE-BUY' || action === 'PE-BUY';
    if (tradeable && pct >= need) {
      els.conviction.classList.add('at-threshold');
    } else {
      els.conviction.classList.add('below-threshold');
    }
  }

  function spotColorForAction(action) {
    if (action === 'CE-BUY') return '#22c55e';
    if (action === 'PE-BUY') return '#ef4444';
    return '#8b95a8';
  }

  function combinedLanePercent(data, gauges) {
    if (data?.lanes?.combinedPercent != null) {
      return Number(data.lanes.combinedPercent) || 0;
    }
    if (data?.weightedBaseConviction != null) {
      return Number(data.weightedBaseConviction) || 0;
    }
    return Number(gauges?.priceAction?.percent) || 0;
  }

  function renderConvictionBonuses(bonuses, entryConviction, weightedBase) {
    if (!els.convictionBonuses) return;
    const list = Array.isArray(bonuses) ? bonuses : [];
    if (!list.length || serverFlowMode !== 'blend') {
      els.convictionBonuses.classList.add('hidden');
      els.convictionBonuses.innerHTML = '';
      return;
    }
    const entry = Number(entryConviction) || 0;
    const base = Number(weightedBase) || 0;
    const chips = list
      .map((bonus) => {
        const points = Number(bonus.points) || 0;
        const sign = points > 0 ? '+' : '';
        const tone = points > 0 ? 'positive' : points < 0 ? 'negative' : '';
        const label = bonus.label || 'Bonus';
        return `<span class="bonus-chip ${tone}">${label} ${sign}${points}</span>`;
      })
      .join('');
    els.convictionBonuses.innerHTML = `
      <div class="bonus-head">
        <span>Entry bonuses</span>
        <span>${base}% base → ${entry}% entry</span>
      </div>
      <div class="bonus-list">${chips}</div>
    `;
    els.convictionBonuses.classList.remove('hidden');
  }

  function applyGauges(gauges, combinedPercent, action = 'NO-TRADE') {
    const option = gauges.option;
    const pa = gauges.priceAction;
    els.needleOption.style.left = needleLeft(option.value);
    els.needlePa.style.left = needleLeft(pa.value);
    els.optionValue.textContent = formatNeedle(option.value, option.label);
    els.paValue.textContent = formatNeedle(pa.value, pa.label);

    if (pa.ghost != null) {
      els.ghostPa.style.left = needleLeft(pa.ghost);
      els.ghostPa.classList.remove('hidden');
    } else {
      els.ghostPa.classList.add('hidden');
    }

    const combined = Number(combinedPercent) || 0;
    applyPercentLane(els.laneOption, option.percent);
    applyPercentLane(els.lanePa, pa.percent);
    applyPercentLane(els.laneCombined, combined);
    els.laneOptionPct.textContent = `${option.percent}%`;
    els.lanePaPct.textContent = `${pa.percent}%`;
    els.laneCombinedPct.textContent = `${combined}%`;

    els.actionCard.classList.remove('bullish', 'bearish', 'conflict');
    if (serverFlowMode !== 'pa-only' && serverFlowMode !== 'option-only' && gauges.conflict) {
      els.actionCard.classList.add('conflict');
    } else if (option.value > 0.2 && pa.value > 0.2) {
      els.actionCard.classList.add('bullish');
    } else if (option.value < -0.2 && pa.value < -0.2) {
      els.actionCard.classList.add('bearish');
    }
  }

  function ensurePnlChart() {
    if (pnlChartApi) return;
    pnlChartApi = LightweightCharts.createChart(els.pnlChart, {
      layout: { background: { color: '#161a20' }, textColor: '#8b95a8' },
      grid: { vertLines: { color: '#252b36' }, horzLines: { color: '#252b36' } },
      rightPriceScale: { borderColor: '#252b36' },
      timeScale: { borderColor: '#252b36', timeVisible: true, secondsVisible: false },
      height: els.pnlChart.clientHeight,
    });
    pnlSeries = pnlChartApi.addLineSeries({
      color: '#fbbf24',
      lineWidth: 2,
      priceLineVisible: false,
    });
  }

  const DEFAULT_CANDLE_MS = 5 * 60 * 1000;

  function spotCandleAnchorMs(t) {
    return buildIstSessionBounds(t).fromMs;
  }

  function bucketStartMs(t, intervalMs, anchorMs) {
    const elapsed = t - anchorMs;
    if (elapsed < 0) return anchorMs;
    return anchorMs + Math.floor(elapsed / intervalMs) * intervalMs;
  }

  function pointToRawCandle(point) {
    const c = point.c ?? point.v;
    if (point.t == null || c == null) return null;
    return {
      t: point.t,
      o: point.o ?? c,
      h: point.h ?? c,
      l: point.l ?? c,
      c,
    };
  }

  function normalizeSpotCandles(candles) {
    if (!candles?.length) return [];
    return candles
      .map((p) => pointToRawCandle(p))
      .filter(Boolean)
      .sort((a, b) => a.t - b.t);
  }

  function toChartData(series) {
    return (series || [])
      .filter((p) => p.t && p.v != null)
      .map((p) => ({ time: Math.floor(p.t / 1000), value: p.v }))
      .sort((a, b) => a.time - b.time);
  }

  function toCandleChartData(candles) {
    const byTime = new Map();
    for (const point of candles || []) {
      if (point.t == null || point.c == null) continue;
      const time = Math.floor(point.t / 1000);
      byTime.set(time, {
        time,
        open: point.o ?? point.c,
        high: point.h ?? point.c,
        low: point.l ?? point.c,
        close: point.c,
      });
    }
    return [...byTime.values()].sort((a, b) => a.time - b.time);
  }

  function spotSeriesToCandles(series) {
    return (series || [])
      .filter((p) => p.t && p.v != null)
      .map((p) => ({ t: p.t, o: p.v, h: p.v, l: p.v, c: p.v }));
  }

  function resolveSpotCandles(data) {
    return {
      '5m': normalizeSpotCandles(data.spotCandles5m?.length ? data.spotCandles5m : spotSeriesToCandles(data.spotSeries)),
      '15m': normalizeSpotCandles(data.spotCandles15m?.length ? data.spotCandles15m : spotSeriesToCandles(data.spotSeries)),
      '1h': normalizeSpotCandles(data.spotCandles1h?.length ? data.spotCandles1h : spotSeriesToCandles(data.spotSeries))
    };
  }

  function spotValueNearTime(ms, tf = '5m') {
    const sec = Math.floor(ms / 1000);
    const cache = spotDataCache[tf];
    if (!cache || !cache.length) return null;
    const exact = cache.find((p) => p.time === sec);
    if (exact) return exact.close;
    let best = cache[0];
    let bestDiff = Math.abs(best.time - sec);
    for (const point of cache) {
      const diff = Math.abs(point.time - sec);
      if (diff < bestDiff) {
        best = point;
        bestDiff = diff;
      }
    }
    return best.close;
  }

  function updateSpotScrub(point, action, data, eventMarkers) {
    if (!point) return;
    Object.keys(charts).forEach(tf => {
      const chart = charts[tf];
      const series = data?.[tf] || spotDataCache[tf];
      if (!chart.series || !series) return;

      const barTime = nearestBarTime(series, Math.floor(point.t / 1000));
      if (barTime == null) return;
      const color = spotColorForAction(action);
      const spot = point.spot != null ? point.spot : spotValueNearTime(point.t, tf);
      const markers = eventMarkers?.[tf] || chartMarkersForEvents(series);

      try {
        chart.series.setMarkers([
          ...markers,
          {
            time: barTime,
            position: 'inBar',
            color,
            shape: 'circle',
            size: 1,
          },
        ]);
      } catch {
        chart.series.setMarkers(markers);
      }

      if (chart.scrubLine) {
        chart.series.removePriceLine(chart.scrubLine);
        chart.scrubLine = null;
      }
      if (spot != null) {
        chart.scrubLine = chart.series.createPriceLine({
          price: spot,
          color,
          lineWidth: 1,
          lineStyle: LightweightCharts.LineStyle.Dashed,
          axisLabelVisible: true,
          title: 'scrub',
        });
      }
    });

    if (els.spotScrubLabel) {
      const spot = point.spot != null ? point.spot : spotValueNearTime(point.t, '5m');
      els.spotScrubLabel.textContent = `· ${formatIstTime(point.t)} · ${spot?.toLocaleString('en-IN') ?? '—'}`;
    }
  }

  let spotDataCache = { '5m': [], '15m': [], '1h': [] };

  function dataIndexForTime(sec, tf = '5m') {
    const cache = spotDataCache[tf];
    if (!cache) return 0;
    const idx = cache.findIndex((p) => p.time === sec);
    return idx >= 0 ? idx : cache.length - 1;
  }

  function patternMarkerColor(tone) {
    if (tone === 'bull') return '#22c55e';
    if (tone === 'bear') return '#ef4444';
    return '#8b95a8';
  }

  function chartMarkersForPatterns(series) {
    if (!series?.length || !patternMarkers.length) return [];
    const markers = [];
    for (const marker of patternMarkers) {
      const barTime = nearestBarTime(series, Math.floor(marker.t / 1000));
      if (barTime == null) continue;
      markers.push({
        time: barTime,
        position: 'aboveBar',
        color: patternMarkerColor(marker.tone),
        shape: 'square',
        text: marker.label.slice(0, 12),
      });
    }
    return markers.sort((a, b) => a.time - b.time);
  }

  function renderPatternContext(ctx) {
    chartSession = ctx?.session ?? chartSession ?? buildIstSessionBounds();
    chartOverlays = ctx?.overlays ?? chartOverlays ?? [];
    if (els.spotSessionLabel && chartSession?.label) {
      els.spotSessionLabel.textContent = chartSession.label;
    }

    if (!els.patternContext) return;
    if (!ctx?.label) {
      els.patternContext.classList.add('hidden');
      els.patternContext.textContent = '';
      els.patternContext.classList.remove('bull', 'bear');
      patternMarkers = ctx?.markers || [];
    } else {
      els.patternContext.textContent = ctx.label;
      els.patternContext.classList.remove('hidden', 'bull', 'bear');
      const tone =
        ctx.markers?.find((m) => m.tone === 'bull' || m.tone === 'bear')?.tone ??
        'neutral';
      if (tone === 'bull' || tone === 'bear') {
        els.patternContext.classList.add(tone);
      }
      patternMarkers = ctx.markers || [];
    }

    if (activeTab === 'charts' && Object.values(spotCandlesPayload).some(c => c.length)) {
      flushSpotChart();
    }
  }

  function chartMarkersForEvents(series) {
    if (!series?.length) return chartMarkersForPatterns(series);
    const barTimes = new Set(series.map((bar) => bar.time));
    const minT = series[0].time;
    const maxT = series[series.length - 1].time;
    const markers = [...chartMarkersForPatterns(series)];
    if (!deckEvents.length) return markers;
    for (const event of deckEvents) {
      const sec = Math.floor(event.t / 1000);
      if (sec < minT || sec > maxT || !barTimes.has(sec)) continue;
      if (event.type !== 'flip' && event.type !== 'veto' && event.type !== 'trade') {
        continue;
      }
      const color =
        event.type === 'trade'
          ? '#fbbf24'
          : event.type === 'veto'
            ? '#f59e0b'
            : spotColorForAction(event.action || 'NO-TRADE');
      markers.push({
        time: sec,
        position: event.type === 'trade' ? 'belowBar' : 'aboveBar',
        color,
        shape: event.type === 'flip' ? 'arrowDown' : 'circle',
        text: event.type === 'flip' ? '↕' : '',
      });
    }
    return markers.sort((a, b) => a.time - b.time);
  }

  function nearestBarTime(series, sec) {
    if (!series.length) return null;
    if (series.some((bar) => bar.time === sec)) return sec;
    let best = series[0].time;
    let bestDiff = Math.abs(best - sec);
    for (const bar of series) {
      const diff = Math.abs(bar.time - sec);
      if (diff < bestDiff) {
        best = bar.time;
        bestDiff = diff;
      }
    }
    return best;
  }

  function applySpotChartData(multiCandles, scrubPoint, scrubAction) {
    const session = resolveChartSession(
      { session: chartSession },
      multiCandles['5m'],
    );

    const multiMarkers = {};

    Object.keys(charts).forEach(tf => {
      const chart = charts[tf];
      const candles = multiCandles[tf] || [];
      if (!chart.series) return;

      const sessionCandles = filterCandlesToSession(
        normalizeSpotCandles(candles),
        session,
      );
      const data = toCandleChartData(sessionCandles);
      spotDataCache[tf] = data;

      if (!data.length) return;

      try {
        chart.series.setData(data);
        const eventMarkers = chartMarkersForEvents(data);
        multiMarkers[tf] = eventMarkers;
        if (!scrubPoint) {
          chart.series.setMarkers(eventMarkers);
          if (chart.scrubLine) {
            chart.series.removePriceLine(chart.scrubLine);
            chart.scrubLine = null;
          }
        }
      } catch (err) {
        console.error(`Failed to apply data to ${tf} chart:`, err);
      }
    });

    applyChartOverlays(chartOverlays);

    if (scrubPoint) {
      updateSpotScrub(scrubPoint, scrubAction, spotDataCache, multiMarkers);
    } else {
      if (els.spotScrubLabel) els.spotScrubLabel.textContent = '';
    }

    if (currentMode === 'live') {
      Object.keys(charts).forEach(tf => {
        const chart = charts[tf];
        if (chart.api && spotDataCache[tf]?.length) {
          focusIntradaySession(session, spotDataCache[tf], chart.api);
        }
      });
    }
  }

  function updateSpotSeries(multiCandles, scrubPoint, scrubAction) {
    spotCandlesPayload = multiCandles || { '5m': [], '15m': [], '1h': [] };
    pendingSpotScrubPoint = scrubPoint ?? null;
    pendingSpotScrubAction = scrubAction ?? null;

    const hasData = Object.values(spotCandlesPayload).some(c => c.length > 0);
    if (!hasData) {
      setSpotChartMessage({ empty: true, error: null });
      return;
    }

    if (activeTab === 'charts') {
      flushSpotChart();
    }
  }

  function renderVetoStrip(activeIndex) {
    if (!els.vetoStrip || !vetoTimeline.length) return;
    els.vetoStrip.innerHTML = '';
    const maxSegs = Math.min(vetoTimeline.length, 120);
    const step = Math.max(1, Math.floor(vetoTimeline.length / maxSegs));
    for (let i = 0; i < vetoTimeline.length; i += step) {
      const seg = vetoTimeline[i];
      const div = document.createElement('div');
      div.className = 'veto-seg';
      if (seg.vetoed) div.classList.add('vetoed');
      else if (seg.action === 'CE-BUY' || seg.action === 'PE-BUY') div.classList.add('clear');
      else div.classList.add('flat');
      const mappedReplayIdx = replayPoints.findIndex((p) => p.t === seg.t);
      if (mappedReplayIdx === activeIndex) div.classList.add('active');
      div.title = seg.vetoReason || `${seg.action}${seg.structuralAction ? ` (struct ${seg.structuralAction})` : ''}`;
      els.vetoStrip.appendChild(div);
    }
  }

  function updatePnlSeries(series) {
    if (!series?.length) return;
    ensurePnlChart();
    pnlSeries.setData(toChartData(series));
  }

  function updateFormingSpotCandle(multiCandles, price, atMs) {
    if (!multiCandles || price == null || !atMs) return multiCandles;
    
    const anchorMs = spotCandleAnchorMs(atMs);
    const resolutions = {
      '5m': 5 * 60 * 1000,
      '15m': 15 * 60 * 1000,
      '1h': 60 * 60 * 1000
    };

    const nextMulti = { ...multiCandles };

    Object.keys(resolutions).forEach(tf => {
      const intervalMs = resolutions[tf];
      const bucketT = bucketStartMs(atMs, intervalMs, anchorMs);
      const candles = [...(multiCandles[tf] || [])];
      if (!candles.length) return;

      const last = candles[candles.length - 1];
      if (last.t === bucketT) {
        candles[candles.length - 1] = {
          ...last,
          h: Math.max(last.h, price),
          l: Math.min(last.l, price),
          c: price,
        };
      } else if (last.t < bucketT) {
        candles.push({
          t: bucketT,
          o: price,
          h: price,
          l: price,
          c: price,
        });
      }
      nextMulti[tf] = candles;
    });

    return nextMulti;
  }

  function applyDeckTick(tick) {
    els.clock.textContent = `${formatClock(tick.asOf)} IST`;
    if (tick.flowMode) setFlowModeUi(tick.flowMode);
    if (tick.marketRegime) renderMarketRegime(tick.marketRegime);
    const tickDisplay = resolveLiveDisplay(tick);
    els.action.textContent = tickDisplay.action;
    updateEntryConviction(
      tickDisplay.conviction,
      tick.entryThreshold,
      tickDisplay.action,
    );

    if (tick.marketOpen) els.live.classList.remove('hidden');
    else els.live.classList.add('hidden');

    if (tickDisplay.whatIf) {
      els.status.textContent = `What-if (${serverVetoMode})`;
    } else if (tick.chartVetoed) {
      els.status.textContent = vetoModeStatusText(serverVetoMode);
    } else if (serverVetoMode !== 'strict') {
      els.status.textContent = vetoModeStatusText(serverVetoMode);
    } else if (tick.gauges.aligned) {
      els.status.textContent = 'Option & PA aligned';
    } else if (tick.gauges.conflict) {
      els.status.textContent = 'Option vs PA conflict';
    } else {
      els.status.textContent = tick.bias;
    }

    applyGauges(
      tick.gauges,
      combinedLanePercent(tick, tick.gauges),
      tickDisplay.action,
    );
    renderConvictionBonuses(
      tick.convictionBonuses,
      tickDisplay.conviction,
      tick.weightedBaseConviction ?? tick.lanes?.combinedPercent,
    );
    renderComponentList(els.optionComponents, tick.optionComponents, 'option');
    renderComponentList(els.paComponents, tick.priceActionComponents, 'pa');
    renderPaDrilldown(tick.paDrilldown);
    renderVetoBreakup(
      [els.vetoBreakup, els.vetoBreakupTab],
      tick.vetoBreakup,
      tick.chartVetoed ? vetoModeStatusText(serverVetoMode) : '',
      buildFlowVetoContext(tick),
    );

    const hasData = Object.values(spotCandlesPayload).some(c => c.length > 0);
    if (tick.lastPrice != null && hasData) {
      const atMs = tick.asOf ? new Date(tick.asOf).getTime() : Date.now();
      spotCandlesPayload = updateFormingSpotCandle(
        spotCandlesPayload,
        tick.lastPrice,
        atMs,
      );
      updateSpotSeries(spotCandlesPayload, null, tick.action);
    }
    renderPatternContext(
      tick.patternContext ?? {
        label: '',
        markers: [],
        overlays: chartOverlays,
        session: chartSession ?? buildIstSessionBounds(),
      },
    );
    renderPatternInsights(tick.patternInsights);
  }

  function applyLive(data) {
    els.symbol.textContent = data.symbolLabel || data.symbol;
    els.style.textContent = data.tradingStyle;
    els.clock.textContent = `${formatClock(data.asOf)} IST`;
    serverVetoMode = data.vetoMode || (data.vetoOff ? 'off' : 'strict');
    setVetoModeUi(serverVetoMode);
    setFlowModeUi(data.flowMode || 'blend');
    const liveDisplay = resolveLiveDisplay(data);
    els.action.textContent = liveDisplay.action;
    updateEntryConviction(
      liveDisplay.conviction,
      data.entryThreshold,
      liveDisplay.action,
    );

    if (liveDisplay.whatIf) {
      els.status.textContent = `What-if (${serverVetoMode})`;
    } else if (data.chartVetoed) {
      els.status.textContent = vetoModeStatusText(serverVetoMode);
    } else if (serverVetoMode !== 'strict') {
      els.status.textContent = vetoModeStatusText(serverVetoMode);
    } else if (data.gauges.aligned) {
      els.status.textContent = 'Option & PA aligned';
    } else if (data.gauges.conflict) {
      els.status.textContent = 'Option vs PA conflict';
    } else {
      els.status.textContent = data.bias;
    }

    if (data.marketOpen) els.live.classList.remove('hidden');
    else els.live.classList.add('hidden');

    applyGauges(
      data.gauges,
      combinedLanePercent(data, data.gauges),
      liveDisplay.action,
    );
    renderConvictionBonuses(
      data.convictionBonuses,
      liveDisplay.conviction,
      data.weightedBaseConviction ?? data.lanes?.combinedPercent,
    );
    renderComponentList(els.optionComponents, data.optionComponents, 'option');
    renderComponentList(els.paComponents, data.priceActionComponents, 'pa');
    renderPaDrilldown(data.paDrilldown);
    renderVetoBreakup(
      [els.vetoBreakup, els.vetoBreakupTab],
      data.vetoBreakup,
      data.chartVetoed ? vetoModeStatusText(serverVetoMode) : '',
      buildFlowVetoContext(data),
    );
    renderStrategyRecommendation(data.strategyRecommendation);
    renderOpenPositions(data.openPositions);
    renderManagementContext(data.managementContext || data.management || null);
    renderMarketRegime(data.marketRegime);
    if (els.optionComponentsNote) {
      if (data.flowMode === 'pa-only') {
        els.optionComponentsNote.textContent =
          'PA-only (/flow pa) — option components for reference only';
        els.optionComponentsNote.classList.remove('hidden');
      } else if (data.flowMode === 'option-only') {
        els.optionComponentsNote.textContent =
          'Option-only (/flow option) — PA components for reference only';
        els.optionComponentsNote.classList.remove('hidden');
      } else {
        els.optionComponentsNote.classList.add('hidden');
        els.optionComponentsNote.textContent = '';
      }
    }
    if (els.vetoSection) {
      vetoTimeline = data.vetoTimeline || [];
      if (vetoTimeline.length) {
        els.vetoSection.classList.remove('hidden');
        els.vetoSection.classList.remove('replay-only');
        renderVetoStrip(vetoTimeline.length - 1);
      } else {
        els.vetoSection.classList.add('hidden');
      }
    }
    if (els.vetoModeOptions) {
      els.vetoModeOptions.querySelectorAll('.veto-mode-btn').forEach((btn) => {
        btn.disabled = true;
      });
    }
    deckEvents = buildEventsFromPayload(data);
    renderEvents(deckEvents);
    spotCandlesPayload = resolveSpotCandles(data);
    const hasData = Object.values(spotCandlesPayload).some(c => c.length > 0);
    if (data.lastPrice != null && hasData) {
      const atMs = data.asOf ? new Date(data.asOf).getTime() : Date.now();
      spotCandlesPayload = updateFormingSpotCandle(
        spotCandlesPayload,
        data.lastPrice,
        atMs,
      );
    }
    updateSpotSeries(spotCandlesPayload, null, data.action);
    renderPatternContext(
      data.patternContext ?? {
        label: '',
        markers: [],
        overlays: [],
        session: buildIstSessionBounds(),
      },
    );
    renderPatternInsights(data.patternInsights);
    setError('');
  }

  function applyLiveEnrichment(data) {
    if (!data) return;
    els.symbol.textContent = data.symbolLabel || data.symbol || shortSymbolLabel(symbol);
    els.style.textContent = data.tradingStyle || style;
    serverVetoMode = data.vetoMode || (data.vetoOff ? 'off' : 'strict');
    setVetoModeUi(serverVetoMode);
    setFlowModeUi(data.flowMode || 'blend');
    renderStrategyRecommendation(data.strategyRecommendation);
    renderOpenPositions(data.openPositions);
    renderManagementContext(data.managementContext || null);
    renderMarketRegime(data.marketRegime);
    if (els.vetoSection) {
      vetoTimeline = data.vetoTimeline || [];
      if (vetoTimeline.length) {
        els.vetoSection.classList.remove('hidden');
        els.vetoSection.classList.remove('replay-only');
        renderVetoStrip(vetoTimeline.length - 1);
      } else {
        els.vetoSection.classList.add('hidden');
      }
    }
    if (els.vetoModeOptions) {
      els.vetoModeOptions.querySelectorAll('.veto-mode-btn').forEach((btn) => {
        btn.disabled = true;
      });
    }
    deckEvents = buildEventsFromPayload(data);
    renderEvents(deckEvents);
    spotCandlesPayload = resolveSpotCandles(data);
    updateSpotSeries(spotCandlesPayload);
    renderPatternContext(
      data.patternContext ?? {
        label: '',
        markers: [],
        overlays: [],
        session: buildIstSessionBounds(),
      },
    );
    renderPatternInsights(data.patternInsights);
    if (els.optionComponentsNote) {
      if (data.flowMode === 'pa-only') {
        els.optionComponentsNote.textContent =
          'PA-only (/flow pa) — option components for reference only';
        els.optionComponentsNote.classList.remove('hidden');
      } else if (data.flowMode === 'option-only') {
        els.optionComponentsNote.textContent =
          'Option-only (/flow option) — PA components for reference only';
        els.optionComponentsNote.classList.remove('hidden');
      } else {
        els.optionComponentsNote.classList.add('hidden');
        els.optionComponentsNote.textContent = '';
      }
    }
  }

  function applyReplayTrades(data) {
    if (!data) return;
    const trades = data.trades || [];
    updatePnlSeries(data.pnlSeries);
    if (els.pnlNote) {
      if (data.pnlNote) {
        els.pnlNote.textContent = data.pnlNote;
        els.pnlNote.classList.remove('hidden');
      } else {
        els.pnlNote.classList.add('hidden');
        els.pnlNote.textContent = '';
      }
    }
    const tradeEvents = trades.map((trade) => {
      const sign = trade.pnlInr >= 0 ? '+' : '';
      return {
        t: trade.t,
        type: 'trade',
        label: trade.label,
        detail: `${sign}₹${Math.round(trade.pnlInr)} · ${trade.verdict}`,
        action: trade.verdict,
      };
    });
    deckEvents = [...deckEvents.filter((e) => e.type !== 'trade'), ...tradeEvents].sort(
      (a, b) => a.t - b.t,
    );
    renderEvents(deckEvents);
  }

  function renderManagementContext(mgmt) {
    if (!mgmt || !mgmt.hasOpenPosition || !els.strategyContent) return;

    // Create or update a management banner inside strategy area
    let banner = document.getElementById('mgmt-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'mgmt-banner';
      banner.style.cssText = 'margin: 8px 0; padding: 6px 8px; border-radius: 6px; background: #2a2f3a; font-size: 0.8rem;';
      els.strategyContent.parentNode.insertBefore(banner, els.strategyContent);
    }

    const h = mgmt.health || mgmt.advice?.positionHealth;
    const advice = mgmt.advice || mgmt;

    let html = `<strong>🧠 MANAGEMENT MODE</strong> — holding ${mgmt.heldDirection || ''}`;
    if (h) {
      const trend = h.trend === 'improving' ? '↑' : h.trend === 'deteriorating' ? '↓' : '';
      html += ` &nbsp; <span style="font-weight:600">Health: ${h.score}/100 ${h.label} ${trend}</span>`;
    }
    if (advice?.headline) {
      html += `<div style="margin-top:4px; opacity:0.9;">${advice.headline}</div>`;
    }
    if (advice?.recommendedActions?.length) {
      const actions = advice.recommendedActions.map(a => `• ${a.detail}`).join('<br>');
      html += `<div style="margin-top:4px; font-size:0.75rem; opacity:0.85;">${actions}</div>`;
    }
    banner.innerHTML = html;
    banner.classList.remove('hidden');

    // Apply suggested stop overlay on chart if provided
    try {
      const stopAdj = advice?.suggestedStopAdjustment;
      if (stopAdj && stopAdj.newStop != null && Number.isFinite(Number(stopAdj.newStop))) {
        const overlay = {
          price: Number(stopAdj.newStop),
          tone: 'bear',
          kind: 'stop',
          dashed: true,
          label: stopAdj.reason ? `Stop: ${stopAdj.reason}` : 'Suggested stop',
        };
        applyChartOverlays([...(chartOverlays || []), overlay]);
      }
    } catch (err) {
      // non-fatal
    }

    // Render adjustments tab content for more detailed view
    if (els.adjustmentsList) {
      els.adjustmentsList.innerHTML = '';
      const header = document.createElement('div');
      header.className = 'panel-head';
      const title = document.createElement('span');
      title.textContent = 'Adjustments';
      header.appendChild(title);
      els.adjustmentsList.appendChild(header);

      const body = document.createElement('div');
      body.className = 'adjustments-body';

      if (h) {
        const healthRow = document.createElement('div');
        healthRow.className = 'adjustment-row';
        healthRow.innerHTML = `<strong>Health</strong> · ${h.score}/100 · ${h.label}`;
        body.appendChild(healthRow);
      }

      if (advice?.riskAdjustment) {
        const ra = document.createElement('div');
        ra.className = 'adjustment-row';
        ra.innerHTML = `<strong>Risk</strong> · ${advice.riskAdjustment.suggestedAction} · ${advice.riskAdjustment.notes?.join(' · ') || ''}`;
        body.appendChild(ra);
      }

      if (advice?.recommendedActions?.length) {
        for (const a of advice.recommendedActions) {
          const item = document.createElement('div');
          item.className = 'adjustment-action';
          const head = document.createElement('div');
          head.className = 'adjustment-action-head';
          head.textContent = a.action.replace(/_/g, ' ');
          const detail = document.createElement('div');
          detail.className = 'adjustment-action-detail';
          detail.textContent = a.detail || '';
          item.appendChild(head);
          item.appendChild(detail);
          if (a.rrTarget) {
            const rr = document.createElement('div');
            rr.className = 'adjustment-action-meta';
            rr.textContent = `Target: ${a.rrTarget}`;
            item.appendChild(rr);
          }
          body.appendChild(item);
        }
      } else {
        const none = document.createElement('div');
        none.className = 'muted';
        none.textContent = 'No adjustment recommendations at this time.';
        body.appendChild(none);
      }

      if (advice?.suggestedStopAdjustment) {
        const s = advice.suggestedStopAdjustment;
        const stopRow = document.createElement('div');
        stopRow.className = 'adjustment-row';
        stopRow.innerHTML = `<strong>Suggested stop</strong> · ${s.newStop} · ${s.reason || ''} <div style="font-size:0.8rem; opacity:0.9">${s.improvement || ''}</div>`;
        body.appendChild(stopRow);
      }

      els.adjustmentsList.appendChild(body);
    }
  }

  function resolveReplayDisplay(point) {
    if (!point.vetoed || vetoMode === 'strict') {
      return {
        action: point.action,
        conviction: point.conviction,
        statusSuffix: point.vetoReason ? ` · ${point.vetoReason}` : '',
      };
    }

    const useWhatIf =
      vetoMode === 'off' ||
      (vetoMode === 'relaxed' && isSoftDecayVetoReason(point.vetoReason));

    if (!useWhatIf) {
      return {
        action: point.action,
        conviction: point.conviction,
        statusSuffix: point.vetoReason ? ` · ${point.vetoReason}` : '',
      };
    }

    return {
      action: point.whatIfAction,
      conviction: point.whatIfConviction,
      statusSuffix: point.structuralAction
        ? ` · what-if ${point.structuralAction}`
        : ` · what-if (${vetoMode})`,
    };
  }

  function replayGaugesFromPoint(point) {
    if (point.liveSynced && replayGauges) return replayGauges;
    const optionPercent =
      point.optionPercent ?? Math.round(Math.abs(point.optionNeedle) * 100);
    const paPercent =
      point.paPercent ?? Math.round(Math.abs(point.paNeedle) * 100);
    return {
      option: {
        value: point.optionNeedle,
        label:
          point.optionNeedle >= 0.35
            ? 'CE'
            : point.optionNeedle <= -0.35
              ? 'PE'
              : 'FLAT',
        percent: optionPercent,
        ghost: null,
      },
      priceAction: {
        value: point.paNeedle,
        label:
          point.paNeedle >= 0.35 ? 'CE' : point.paNeedle <= -0.35 ? 'PE' : 'FLAT',
        percent: paPercent,
        ghost: point.paGhost ?? null,
      },
      aligned:
        Math.sign(point.optionNeedle) === Math.sign(point.paNeedle) ||
        point.optionNeedle === 0 ||
        point.paNeedle === 0,
      conflict:
        point.optionNeedle !== 0 &&
        point.paNeedle !== 0 &&
        Math.sign(point.optionNeedle) !== Math.sign(point.paNeedle),
    };
  }

  function applyReplayIndex(index) {
    if (!replayPoints.length) return;
    const point = replayPoints[Math.max(0, Math.min(index, replayPoints.length - 1))];
    const display = resolveReplayDisplay(point);
    const chartAction = display.action;
    const gauges = replayGaugesFromPoint(point);
    const replayCombined =
      point.weightedBaseConviction ??
      Math.round(
        (gauges.priceAction.percent || 0) * 0.65 +
          (gauges.option.percent || 0) * 0.35,
      );
    applyGauges(gauges, replayCombined, display.action);
    renderConvictionBonuses(
      point.convictionBonuses,
      display.conviction,
      point.weightedBaseConviction ?? replayCombined,
    );
    els.action.textContent = display.action;
    updateEntryConviction(
      display.conviction,
      replayEntryThreshold,
      display.action,
    );
    els.replayMeta.textContent = `${formatIstTime(point.t)} · ${display.action} · spot ${point.spot.toLocaleString('en-IN')}${display.statusSuffix}`;
    if (point.vetoed && display.action === point.action) {
      els.status.textContent = `Chart veto · ${point.vetoReason || 'blocked'}`;
    } else if (point.vetoed && display.action !== point.action) {
      els.status.textContent = `What-if replay (${vetoMode})`;
    }
    renderComponentList(
      els.optionComponents,
      point.optionComponents?.length ? point.optionComponents : replayOptionComponents,
      'option',
    );
    renderComponentList(els.paComponents, point.paComponents || [], 'pa');
    renderPaDrilldown(point.paDrilldown);
    renderVetoBreakup(
      [els.vetoBreakup, els.vetoBreakupTab],
      point.vetoBreakup || [],
      display.statusSuffix ? display.statusSuffix.replace(/^ · /, '') : '',
      buildFlowVetoContext({
        gauges: replayGaugesFromPoint(point),
        structuralAction: point.structuralAction,
        vetoReason: point.vetoReason,
        vetoed: point.vetoed,
      }),
    );
    renderVetoStrip(index);
    pendingSpotScrubPoint = point;
    pendingSpotScrubAction = chartAction;
    if (activeTab === 'charts') flushSpotChart();
  }

  function applyReplay(data) {
    els.symbol.textContent = data.symbolLabel || data.symbol;
    els.style.textContent = data.tradingStyle;
    els.clock.textContent = data.sessionDate;
    els.live.classList.add('hidden');
    els.status.textContent = `Session replay · ${data.trades?.length || 0} trade(s)`;
    els.pnlSection.classList.remove('hidden');
    els.replayDock?.classList.remove('hidden');
    document.body.classList.add('replay-mode');
    if (els.vetoSection) {
      els.vetoSection.classList.remove('hidden');
      els.vetoSection.classList.add('replay-only');
    }
    serverVetoMode = data.vetoMode || 'strict';
    setVetoModeUi(serverVetoMode);
    setFlowModeUi(data.flowMode || 'blend');
    if (els.vetoModeOptions) {
      els.vetoModeOptions.querySelectorAll('.veto-mode-btn').forEach((btn) => {
        btn.disabled = false;
      });
    }

    replayPoints = data.replayPoints || [];
    replayOptionComponents = data.optionComponents || [];
    replayGauges = data.gauges || null;
    replayEntryThreshold = Number(data.entryThreshold) || 60;
    vetoTimeline = data.vetoTimeline || [];
    renderVetoBreakup(
      [els.vetoBreakup, els.vetoBreakupTab],
      data.vetoBreakup || [],
      '',
      buildFlowVetoContext(data),
    );
    renderStrategyRecommendation(data.strategyRecommendation);
    if (els.optionComponentsNote && data.optionComponentsNote) {
      els.optionComponentsNote.textContent = data.optionComponentsNote;
      els.optionComponentsNote.classList.remove('hidden');
    }
    els.replaySlider.max = String(Math.max(0, replayPoints.length - 1));
    els.replaySlider.value = String(Math.max(0, replayPoints.length - 1));

    if (els.pnlNote) {
      if (data.pnlNote && !(data.pnlSeries?.length)) {
        els.pnlNote.textContent = data.pnlNote;
        els.pnlNote.classList.remove('hidden');
      } else {
        els.pnlNote.classList.add('hidden');
        els.pnlNote.textContent = '';
      }
    }

    deckEvents = buildEventsFromPayload(data);
    renderEvents(deckEvents);
    spotCandlesPayload = resolveSpotCandles(data);
    updateSpotSeries(spotCandlesPayload);
    updatePnlSeries(data.pnlSeries);
    renderPatternInsights(data.patternInsights);
    applyReplayIndex(replayPoints.length - 1);
    setError('');
  }

  async function deckFetch(path) {
    const res = await fetch(path, {
      headers: initData ? { 'X-Telegram-Init-Data': initData } : {},
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    return res.json();
  }

  async function fetchDeck() {
    const base =
      mode === 'replay'
        ? `/api/deck/replay?symbol=${encodeURIComponent(symbol)}&style=${encodeURIComponent(style)}${sessionDate ? `&date=${encodeURIComponent(sessionDate)}` : ''}`
        : `/api/deck/live?symbol=${encodeURIComponent(symbol)}&style=${encodeURIComponent(style)}`;
    return deckFetch(base);
  }

  async function fetchDeckEnrichment() {
    const qs = `/api/deck/live?scope=enrichment&symbol=${encodeURIComponent(symbol)}&style=${encodeURIComponent(style)}`;
    return deckFetch(qs);
  }

  async function fetchReplayTrades() {
    const date = sessionDate || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const qs = `/api/deck/replay-trades?symbol=${encodeURIComponent(symbol)}&style=${encodeURIComponent(style)}&date=${encodeURIComponent(date)}`;
    return deckFetch(qs);
  }

  async function refresh(options = {}) {
    const { showLoader = shouldShowLoadingOverlay() } = options;
    if (showLoader) setLoading(true);
    try {
      const data = await fetchDeck();
      currentMode = data.mode || mode;
      if (data.mode === 'replay') applyReplay(data);
      else {
        document.body.classList.remove('replay-mode');
        els.replayDock?.classList.add('hidden');
        applyLive(data);
      }
      if (deckHasRenderableContent(data)) {
        hasDisplayedDeck = true;
      }
      setError('');
    } catch (err) {
      setError(err.message || 'Failed to load deck');
    } finally {
      if (showLoader) setLoading(false);
    }
  }

  function stopDeckStream() {
    if (deckEventSource) {
      deckEventSource.close();
      deckEventSource = null;
    }
  }

  function startFallbackPoll() {
    if (pollTimer) return;
    pollTimer = setInterval(() => refresh({ showLoader: false }), FALLBACK_POLL_MS);
  }

  function stopFallbackPoll() {
    if (!pollTimer) return;
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function connectDeckStream(options = {}) {
    const { onFirstData } = options;
    stopDeckStream();
    stopFallbackPoll();

    const qs = new URLSearchParams({
      symbol,
      style,
    });
    if (initData) qs.set('initData', initData);

    const source = new EventSource(`/api/deck/stream?${qs.toString()}`);
    deckEventSource = source;
    let firstDataSeen = false;

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'error') {
          setError(payload.message || 'Stream update failed');
          return;
        }
        if (payload.type === 'status') {
          setLoading(true, payload.message || 'Fetching data…');
          return;
        }
        if (payload.type === 'full') {
          applyLive(payload);
          if (deckHasRenderableContent(payload)) {
            hasDisplayedDeck = true;
          }
          if (!firstDataSeen) {
            firstDataSeen = true;
            onFirstData?.();
          }
          setError('');
          return;
        }
        if (payload.type === 'tick') {
          applyDeckTick(payload);
          if (deckHasRenderableContent(payload)) {
            hasDisplayedDeck = true;
          }
          if (!firstDataSeen) {
            firstDataSeen = true;
            onFirstData?.();
          }
          setError('');
        }
      } catch (err) {
        setError(err.message || 'Invalid stream payload');
      }
    };

    source.onerror = () => {
      stopDeckStream();
      startFallbackPoll();
    };
  }

  async function loadLiveEnrichment() {
    try {
      const data = await fetchDeckEnrichment();
      applyLiveEnrichment(data);
      setError('');
    } catch (err) {
      if (!hasDisplayedDeck) {
        setError(err.message || 'Failed to load charts and positions');
      }
    }
  }

  async function loadReplayTrades() {
    try {
      const data = await fetchReplayTrades();
      applyReplayTrades(data);
    } catch {
      if (els.pnlNote) {
        els.pnlNote.textContent =
          'Session PnL unavailable — Fyers tradebook may be slow or empty for this date.';
        els.pnlNote.classList.remove('hidden');
      }
    }
  }

  function bootstrapLiveDeck() {
    setLoading(true, 'Fetching data…');
    let loadingSlowTimer = null;
    const clearLoadingSlowTimer = () => {
      if (loadingSlowTimer) {
        clearTimeout(loadingSlowTimer);
        loadingSlowTimer = null;
      }
    };
    loadingSlowTimer = setTimeout(() => {
      if (!hasDisplayedDeck) {
        setLoading(
          true,
          'Still fetching… backtest or heavy replay may be slowing the server',
        );
      }
    }, 12_000);

    connectDeckStream({
      onFirstData: () => {
        clearLoadingSlowTimer();
        setLoading(false);
      },
    });
    void loadLiveEnrichment();
  }

  async function bootstrapReplayDeck() {
    setLoading(true, 'Fetching data…');
    await refresh();
    void loadReplayTrades();
  }

  if (els.tabBar) {
    els.tabBar.addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn');
      if (!btn?.dataset.tab) return;
      switchTab(btn.dataset.tab);
    });
  }

  els.replaySlider.addEventListener('input', (e) => {
    applyReplayIndex(Number(e.target.value));
  });

  if (els.vetoModeOptions) {
    els.vetoModeOptions.addEventListener('click', (e) => {
      const btn = e.target.closest('.veto-mode-btn');
      if (!btn?.dataset.vetoMode || btn.disabled) return;
      const mode = btn.dataset.vetoMode;
      if (currentMode === 'live') return;
      setVetoModeUi(mode, { replayOverride: mode !== serverVetoMode });
      applyReplayIndex(Number(els.replaySlider.value));
    });
  }

  window.addEventListener('resize', () => {
    if (activeTab === 'charts') {
      mountSpotChart(true);
      flushSpotChart();
    }
  });

  if (mode === 'live') {
    bootstrapLiveDeck();
  } else {
    void bootstrapReplayDeck();
  }

  window.addEventListener('beforeunload', () => {
    stopDeckStream();
    stopFallbackPoll();
  });
})();