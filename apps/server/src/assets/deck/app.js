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
    vetoBreakupComponents: document.getElementById('veto-breakup-components'),
    vetoBreakupNote: document.getElementById('veto-breakup-note'),
    vetoSection: document.getElementById('veto-section'),
    vetoStrip: document.getElementById('veto-strip'),
    vetoModeOptions: document.getElementById('veto-mode-options'),
    vetoModeNote: document.getElementById('veto-mode-note'),
    spotScrubLabel: document.getElementById('spot-scrub-label'),
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
  let vetoMode = 'strict';
  let serverVetoMode = 'strict';
  let currentMode = mode;
  let spotCandlesPayload = [];
  let pendingSpotScrubPoint = null;
  let pendingSpotScrubAction = null;
  const SPOT_CHART_HEIGHT = 200;

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

  function renderVetoBreakup(containers, items, noteText) {
    const targets = (Array.isArray(containers) ? containers : [containers]).filter(
      Boolean,
    );
    for (const container of targets) {
      container.innerHTML = '';
      if (!items?.length) {
        container.innerHTML =
          '<div class="muted" style="font-size:0.72rem">No veto data</div>';
        continue;
      }

      for (const item of items) {
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

  function chartMarkersForEvents(series) {
    if (!series?.length || !deckEvents.length) return [];
    const barTimes = new Set(series.map((bar) => bar.time));
    const minT = series[0].time;
    const maxT = series[series.length - 1].time;
    const markers = [];
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
      [els.vetoBreakup, els.vetoBreakupComponents],
      data.vetoBreakup,
      data.chartVetoed ? vetoModeStatusText(serverVetoMode) : '',
    );
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
      [els.vetoBreakup, els.vetoBreakupComponents],
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
      [els.vetoBreakup, els.vetoBreakupComponents],
      data.vetoBreakup || [],
      '',
    );
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

  async function refresh() {
    setLoading(true);
    try {
      const data = await fetchDeck();
      currentMode = data.mode || mode;
      if (data.mode === 'replay') applyReplay(data);
      else {
        document.body.classList.remove('replay-mode');
        els.replayDock?.classList.add('hidden');
        applyLive(data);
      }
    } catch (err) {
      setError(err.message || 'Failed to load deck');
    } finally {
      setLoading(false);
    }
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

  refresh();
  if (mode === 'live') {
    pollTimer = setInterval(refresh, 45_000);
  }

  window.addEventListener('beforeunload', () => {
    if (pollTimer) clearInterval(pollTimer);
  });
})();