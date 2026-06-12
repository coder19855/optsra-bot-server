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

  const els = {
    symbol: document.getElementById('symbol-label'),
    style: document.getElementById('style-label'),
    clock: document.getElementById('clock-label'),
    live: document.getElementById('live-badge'),
    actionCard: document.getElementById('action-card'),
    action: document.getElementById('action-label'),
    conviction: document.getElementById('conviction-label'),
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
    spotChart: document.getElementById('spot-chart'),
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
    componentsVetoNotice: document.getElementById('components-veto-notice'),
    strategyContent: document.getElementById('strategy-content'),
    strategyReplayNote: document.getElementById('strategy-replay-note'),
    vetoSection: document.getElementById('veto-section'),
    vetoStrip: document.getElementById('veto-strip'),
    vetoModeOptions: document.getElementById('veto-mode-options'),
    vetoModeNote: document.getElementById('veto-mode-note'),
    spotScrubLabel: document.getElementById('spot-scrub-label'),
    patternContext: document.getElementById('pattern-context'),
    spotChartEmpty: document.getElementById('spot-chart-empty'),
    spotChartError: document.getElementById('spot-chart-error'),
    pnlNote: document.getElementById('pnl-note'),
    loadingOverlay: document.getElementById('loading-overlay'),
  };

  let spotChartApi = null;
  let spotSeries = null;
  let spotScrubPriceLine = null;
  let pnlChartApi = null;
  let pnlSeries = null;
  let replayPoints = [];
  let replayOptionComponents = [];
  let vetoTimeline = [];
  let deckEvents = [];
  let activeTab = 'signal';
  let activeEventTime = null;
  let pollTimer = null;
  let deckEventSource = null;
  const FALLBACK_POLL_MS = 45_000;
  let vetoMode = 'strict';
  let serverVetoMode = 'strict';
  let currentMode = mode;
  let spotCandlesPayload = [];
  let pendingSpotScrubPoint = null;
  let pendingSpotScrubAction = null;
  let hasDisplayedDeck = false;
  let patternMarkers = [];
  const SPOT_CHART_HEIGHT = 200;

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

    return events.sort((a, b) => b.t - a.t);
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

  function setLoading(on) {
    if (!els.loadingOverlay) return;
    els.loadingOverlay.classList.toggle('hidden', !on);
    els.loadingOverlay.setAttribute('aria-busy', on ? 'true' : 'false');
  }

  function chartHeight(el, fallback) {
    const measured = el?.clientHeight ?? 0;
    return measured > 0 ? measured : fallback;
  }

  function resizeCharts(fitSpot) {
    if (spotChartApi && els.spotChart) {
      spotChartApi.applyOptions({
        height: chartHeight(els.spotChart, SPOT_CHART_HEIGHT),
      });
      if (fitSpot) {
        try {
          spotChartApi.timeScale().fitContent();
        } catch {
          // Chart may not have data yet.
        }
      }
    }
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
    const canvas = els.spotChart?.querySelector('canvas');
    return canvas?.clientWidth ?? 0;
  }

  function destroySpotChart() {
    if (spotChartApi) {
      spotChartApi.remove();
      spotChartApi = null;
      spotSeries = null;
      spotScrubPriceLine = null;
    }
  }

  function mountSpotChart(forceRemount = false) {
    if (!els.spotChart) return false;
    if (typeof LightweightCharts === 'undefined') {
      setSpotChartMessage({
        empty: false,
        error: 'Chart library failed to load. Check network and reload.',
      });
      return false;
    }

    const width = els.spotChart.clientWidth;
    if (width <= 0) return false;

    if (
      forceRemount ||
      (spotChartApi && spotChartCanvasWidth() < 10)
    ) {
      destroySpotChart();
    }
    if (spotChartApi) {
      resizeCharts(false);
      return true;
    }

    try {
      spotChartApi = LightweightCharts.createChart(els.spotChart, {
        autoSize: true,
        layout: { background: { color: '#161a20' }, textColor: '#8b95a8' },
        grid: { vertLines: { color: '#252b36' }, horzLines: { color: '#252b36' } },
        rightPriceScale: { borderColor: '#252b36' },
        timeScale: { borderColor: '#252b36', timeVisible: true, secondsVisible: false },
        crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
        height: chartHeight(els.spotChart, SPOT_CHART_HEIGHT),
      });
      spotSeries = spotChartApi.addCandlestickSeries({
        upColor: '#22c55e',
        downColor: '#ef4444',
        borderVisible: false,
        wickUpColor: '#22c55e',
        wickDownColor: '#ef4444',
        priceLineVisible: false,
        lastValueVisible: true,
      });
      setSpotChartMessage({ empty: false, error: null });
      return true;
    } catch (err) {
      destroySpotChart();
      setSpotChartMessage({
        empty: false,
        error: err?.message || 'Unable to initialize chart',
      });
      return false;
    }
  }

  function flushSpotChart() {
    if (!spotCandlesPayload.length) {
      setSpotChartMessage({ empty: true, error: null });
      return;
    }
    if (!mountSpotChart(false)) return;
    applySpotChartData(
      spotCandlesPayload,
      pendingSpotScrubPoint,
      pendingSpotScrubAction,
    );
    resizeCharts(true);
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

  function applyVetoScoreNotice(items) {
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
  }

  function renderVetoBreakup(containers, items, noteText) {
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

    applyVetoScoreNotice(sorted);
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

  function applySignedLane(fillEl, signedValue, percent) {
    const v = Math.max(-1, Math.min(1, Number(signedValue) || 0));
    const width = `${Math.abs(v) * 50}%`;
    fillEl.style.width = width;
    fillEl.classList.remove('signed-positive', 'signed-negative');
    if (v > 0.02) fillEl.classList.add('signed-positive');
    else if (v < -0.02) fillEl.classList.add('signed-negative');
    else {
      fillEl.style.left = '50%';
      fillEl.style.right = 'auto';
      fillEl.style.width = '0%';
    }
    return percent;
  }

  function spotColorForAction(action) {
    if (action === 'CE-BUY') return '#22c55e';
    if (action === 'PE-BUY') return '#ef4444';
    return '#8b95a8';
  }

  function applyGauges(gauges, lanes) {
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

    if (lanes) {
      const optionPct = applySignedLane(
        els.laneOption,
        option.value,
        lanes.optionPercent,
      );
      const paPct = applySignedLane(els.lanePa, pa.value, lanes.priceActionPercent);
      els.laneCombined.style.width = `${lanes.combinedPercent}%`;
      els.laneCombined.classList.remove('signed-positive', 'signed-negative');
      els.laneCombined.style.left = '0';
      els.laneCombined.style.right = 'auto';
      els.laneOptionPct.textContent = `${optionPct}%`;
      els.lanePaPct.textContent = `${paPct}%`;
      els.laneCombinedPct.textContent = `${lanes.combinedPercent}%`;
    }

    els.actionCard.classList.remove('bullish', 'bearish', 'conflict');
    if (gauges.conflict) els.actionCard.classList.add('conflict');
    else if (option.value > 0.2 && pa.value > 0.2) els.actionCard.classList.add('bullish');
    else if (option.value < -0.2 && pa.value < -0.2) els.actionCard.classList.add('bearish');
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
    if (data.spotCandles?.length) return data.spotCandles;
    return spotSeriesToCandles(data.spotSeries);
  }

  function spotValueNearTime(ms) {
    const sec = Math.floor(ms / 1000);
    const exact = spotDataCache.find((p) => p.time === sec);
    if (exact) return exact.close;
    if (!spotDataCache.length) return null;
    let best = spotDataCache[0];
    let bestDiff = Math.abs(best.time - sec);
    for (const point of spotDataCache) {
      const diff = Math.abs(point.time - sec);
      if (diff < bestDiff) {
        best = point;
        bestDiff = diff;
      }
    }
    return best.close;
  }

  function updateSpotScrub(point, action, data, eventMarkers) {
    if (!point || !spotSeries) return;
    const series = data || spotDataCache;
    const barTime = nearestBarTime(series, Math.floor(point.t / 1000));
    if (barTime == null) return;
    const color = spotColorForAction(action);
    const spot =
      point.spot != null ? point.spot : spotValueNearTime(point.t);
    const markers = eventMarkers || chartMarkersForEvents(series);
    try {
      spotSeries.setMarkers([
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
      spotSeries.setMarkers(markers);
    }
    if (spotScrubPriceLine) {
      spotSeries.removePriceLine(spotScrubPriceLine);
      spotScrubPriceLine = null;
    }
    if (spot != null) {
      spotScrubPriceLine = spotSeries.createPriceLine({
        price: spot,
        color,
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        axisLabelVisible: true,
        title: 'scrub',
      });
    }
    if (els.spotScrubLabel) {
      els.spotScrubLabel.textContent = `· ${formatIstTime(point.t)} · ${spot?.toLocaleString('en-IN') ?? '—'}`;
    }
    try {
      spotChartApi.timeScale().setVisibleLogicalRange({
        from: Math.max(0, dataIndexForTime(barTime) - 30),
        to: dataIndexForTime(barTime) + 10,
      });
    } catch {
      // Chart may not be ready yet.
    }
  }

  let spotDataCache = [];

  function dataIndexForTime(sec) {
    const idx = spotDataCache.findIndex((p) => p.time === sec);
    return idx >= 0 ? idx : spotDataCache.length - 1;
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
    if (!els.patternContext) return;
    if (!ctx?.label) {
      els.patternContext.classList.add('hidden');
      els.patternContext.textContent = '';
      els.patternContext.classList.remove('bull', 'bear');
      patternMarkers = [];
      return;
    }
    els.patternContext.textContent = ctx.label;
    els.patternContext.classList.remove('hidden', 'bull', 'bear');
    const tone =
      ctx.markers?.find((m) => m.tone === 'bull' || m.tone === 'bear')?.tone ??
      'neutral';
    if (tone === 'bull' || tone === 'bear') {
      els.patternContext.classList.add(tone);
    }
    patternMarkers = ctx.markers || [];
    if (activeTab === 'charts' && spotCandlesPayload.length) {
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

  function applySpotChartData(candles, scrubPoint, scrubAction) {
    if (!spotSeries) return;
    const data = toCandleChartData(candles);
    spotDataCache = data;
    if (!data.length) {
      setSpotChartMessage({ empty: true, error: null });
      return;
    }

    setSpotChartMessage({ empty: false, error: null });
    try {
      spotSeries.setData(data);
      const eventMarkers = chartMarkersForEvents(data);
      if (scrubPoint) {
        updateSpotScrub(scrubPoint, scrubAction, data, eventMarkers);
      } else {
        spotSeries.setMarkers(eventMarkers);
        if (spotScrubPriceLine) {
          spotSeries.removePriceLine(spotScrubPriceLine);
          spotScrubPriceLine = null;
        }
        if (els.spotScrubLabel) els.spotScrubLabel.textContent = '';
      }
    } catch (err) {
      setSpotChartMessage({
        empty: false,
        error: err?.message || 'Unable to render chart data',
      });
    }
  }

  function updateSpotSeries(candles, scrubPoint, scrubAction) {
    spotCandlesPayload = candles || [];
    pendingSpotScrubPoint = scrubPoint ?? null;
    pendingSpotScrubAction = scrubAction ?? null;

    if (!spotCandlesPayload.length) {
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

  function mergeSpotSeriesTail(candles, tail) {
    if (!tail?.length) return candles;
    const cutoff = tail[0].t;
    const base = (candles || []).filter((p) => p.t < cutoff);
    return [...base, ...spotSeriesToCandles(tail)];
  }

  function applyDeckTick(tick) {
    els.clock.textContent = `${formatClock(tick.asOf)} IST`;
    els.action.textContent = tick.action;
    els.conviction.textContent = `${tick.conviction}%`;

    if (tick.marketOpen) els.live.classList.remove('hidden');
    else els.live.classList.add('hidden');

    els.status.textContent = tick.chartVetoed
      ? vetoModeStatusText(serverVetoMode)
      : serverVetoMode !== 'strict'
        ? vetoModeStatusText(serverVetoMode)
        : tick.gauges.aligned
          ? 'Option & PA aligned'
          : tick.gauges.conflict
            ? 'Option vs PA conflict'
            : tick.bias;

    applyGauges(tick.gauges, tick.lanes);
    renderComponentList(els.optionComponents, tick.optionComponents, 'option');
    renderComponentList(els.paComponents, tick.priceActionComponents, 'pa');
    renderPaDrilldown(tick.paDrilldown);
    renderVetoBreakup(
      [els.vetoBreakup, els.vetoBreakupTab],
      tick.vetoBreakup,
      tick.chartVetoed ? vetoModeStatusText(serverVetoMode) : '',
    );

    if (tick.spotSeries?.length) {
      spotCandlesPayload = mergeSpotSeriesTail(spotCandlesPayload, tick.spotSeries);
      updateSpotSeries(spotCandlesPayload, null, tick.action);
    }
    renderPatternContext(tick.patternContext);
  }

  function applyLive(data) {
    els.symbol.textContent = data.symbolLabel || data.symbol;
    els.style.textContent = data.tradingStyle;
    els.clock.textContent = `${formatClock(data.asOf)} IST`;
    els.action.textContent = data.action;
    els.conviction.textContent = `${data.conviction}%`;
    serverVetoMode = data.vetoMode || (data.vetoOff ? 'off' : 'strict');
    setVetoModeUi(serverVetoMode);
    els.status.textContent = data.chartVetoed
      ? vetoModeStatusText(serverVetoMode)
      : serverVetoMode !== 'strict'
        ? vetoModeStatusText(serverVetoMode)
        : data.gauges.aligned
          ? 'Option & PA aligned'
          : data.gauges.conflict
            ? 'Option vs PA conflict'
            : data.bias;

    if (data.marketOpen) els.live.classList.remove('hidden');
    else els.live.classList.add('hidden');

    applyGauges(data.gauges, data.lanes);
    renderComponentList(els.optionComponents, data.optionComponents, 'option');
    renderComponentList(els.paComponents, data.priceActionComponents, 'pa');
    renderPaDrilldown(data.paDrilldown);
    renderVetoBreakup(
      [els.vetoBreakup, els.vetoBreakupTab],
      data.vetoBreakup,
      data.chartVetoed ? vetoModeStatusText(serverVetoMode) : '',
    );
    renderStrategyRecommendation(data.strategyRecommendation);
    if (els.optionComponentsNote) {
      els.optionComponentsNote.classList.add('hidden');
      els.optionComponentsNote.textContent = '';
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
    updateSpotSeries(spotCandlesPayload, null, data.action);
    renderPatternContext(data.patternContext);
    setError('');
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

  function applyReplayIndex(index) {
    if (!replayPoints.length) return;
    const point = replayPoints[Math.max(0, Math.min(index, replayPoints.length - 1))];
    const display = resolveReplayDisplay(point);
    const chartAction = display.action;
    const gauges = {
      option: {
        value: point.optionNeedle,
        label: point.optionNeedle >= 0.35 ? 'CE' : point.optionNeedle <= -0.35 ? 'PE' : 'FLAT',
        percent: Math.round(Math.abs(point.optionNeedle) * 100),
        ghost: null,
      },
      priceAction: {
        value: point.paNeedle,
        label: point.paNeedle >= 0.35 ? 'CE' : point.paNeedle <= -0.35 ? 'PE' : 'FLAT',
        percent: Math.round(Math.abs(point.paNeedle) * 100),
        ghost: null,
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
    applyGauges(gauges, {
      optionPercent: Math.round(Math.abs(point.optionNeedle) * 100),
      priceActionPercent: Math.round(Math.abs(point.paNeedle) * 100),
      combinedPercent: display.conviction,
    });
    els.action.textContent = display.action;
    els.conviction.textContent = `${display.conviction}%`;
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
    if (els.vetoModeOptions) {
      els.vetoModeOptions.querySelectorAll('.veto-mode-btn').forEach((btn) => {
        btn.disabled = false;
      });
    }

    replayPoints = data.replayPoints || [];
    replayOptionComponents = data.optionComponents || [];
    vetoTimeline = data.vetoTimeline || [];
    renderVetoBreakup(
      [els.vetoBreakup, els.vetoBreakupTab],
      data.vetoBreakup || [],
      '',
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
    applyReplayIndex(replayPoints.length - 1);
    setError('');
  }

  async function fetchDeck() {
    const base =
      mode === 'replay'
        ? `/api/deck/replay?symbol=${encodeURIComponent(symbol)}&style=${encodeURIComponent(style)}${sessionDate ? `&date=${encodeURIComponent(sessionDate)}` : ''}`
        : `/api/deck/live?symbol=${encodeURIComponent(symbol)}&style=${encodeURIComponent(style)}`;

    const res = await fetch(base, {
      headers: initData ? { 'X-Telegram-Init-Data': initData } : {},
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed (${res.status})`);
    }
    return res.json();
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

  function connectDeckStream() {
    stopDeckStream();
    stopFallbackPoll();

    const qs = new URLSearchParams({
      symbol,
      style,
    });
    if (initData) qs.set('initData', initData);

    const source = new EventSource(`/api/deck/stream?${qs.toString()}`);
    deckEventSource = source;

    source.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.type === 'error') {
          setError(payload.message || 'Stream update failed');
          return;
        }
        if (payload.type === 'full') {
          applyLive(payload);
          if (deckHasRenderableContent(payload)) {
            hasDisplayedDeck = true;
          }
          setError('');
          return;
        }
        if (payload.type === 'tick') {
          applyDeckTick(payload);
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

  refresh().then(() => {
    if (mode === 'live') connectDeckStream();
  });

  window.addEventListener('beforeunload', () => {
    stopDeckStream();
    stopFallbackPoll();
  });
})();