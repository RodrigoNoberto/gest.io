(function () {
  'use strict';

  var STORAGE_KEY = 'tm:temporizador:setup';
  var root = document.getElementById('tmRoot');
  if (!root) return;

  var state = {
    items: [],
    current: 0,
    remaining: 0,
    running: false,
    timerId: null,
    itemStartedAt: null,
    presentationStartedAt: null,
  };

  function $(id) { return document.getElementById(id); }
  function all(sel, ctx) { return Array.prototype.slice.call((ctx || document).querySelectorAll(sel)); }
  function clamp(n, min, max) { return Math.max(min, Math.min(max, n)); }
  function pad(n) { return String(Math.floor(Math.abs(n))).padStart(2, '0'); }

  function parseTime(value) {
    var raw = String(value || '').trim().replace(',', '.');
    if (!raw) return 0;
    if (raw.indexOf(':') >= 0) {
      var parts = raw.split(':').map(function (p) { return parseInt(p, 10) || 0; });
      if (parts.length === 3) return Math.max(0, parts[0] * 3600 + parts[1] * 60 + parts[2]);
      return Math.max(0, parts[0] * 60 + parts[1]);
    }
    return Math.max(0, Math.round(parseFloat(raw) * 60) || 0);
  }

  function fmt(seconds, withHours) {
    var sign = seconds < 0 ? '-' : '';
    var s = Math.abs(Math.round(seconds));
    var h = Math.floor(s / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    if (withHours || h) return sign + pad(h) + ':' + pad(m) + ':' + pad(sec);
    return sign + pad(m) + ':' + pad(sec);
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (m) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m];
    });
  }

  function activeMode() {
    var checked = document.querySelector('input[name="tmMode"]:checked');
    return checked ? checked.value : 'slides';
  }

  function scaleValue(id, min, max) {
    var input = $(id);
    return input ? clamp(parseInt(input.value, 10) || 100, min, max) : 100;
  }

  function applyDisplaySettings() {
    var meta = scaleValue('tmMetaScale', 100, 250);
    var text = scaleValue('tmTextScale', 100, 160);
    var timer = scaleValue('tmTimerScale', 100, 150);
    root.style.setProperty('--tm-meta-pad-y', (8 * meta / 100) + 'px');
    root.style.setProperty('--tm-meta-pad-x', (12 * meta / 100) + 'px');
    root.style.setProperty('--tm-meta-font', (13 * meta / 100) + 'px');
    root.style.setProperty('--tm-stage-label-font', (15 * text / 100) + 'px');
    root.style.setProperty('--tm-stage-title-font', (36 * text / 100) + 'px');
    root.style.setProperty('--tm-timer-min', (82 * timer / 100) + 'px');
    root.style.setProperty('--tm-timer-fluid', (14 * timer / 100) + 'vw');
    root.style.setProperty('--tm-timer-max', (180 * timer / 100) + 'px');
  }

  function distribute(totalSeconds, count) {
    count = Math.max(1, count);
    var base = Math.floor(totalSeconds / count);
    var remainder = totalSeconds - base * count;
    var out = [];
    for (var i = 0; i < count; i++) out.push(base + (i < remainder ? 1 : 0));
    return out;
  }

  function renderSlideRows() {
    var count = clamp(parseInt($('tmSlideCount').value, 10) || 1, 1, 200);
    $('tmSlideCount').value = count;
    var wrap = $('tmSlideTimes');
    var strategy = $('tmSlideStrategy').value;
    $('tmSlideTotalField').classList.toggle('tm-hidden', strategy !== 'total');
    $('tmSlideDefaultField').classList.toggle('tm-hidden', strategy !== 'per-slide');
    wrap.classList.toggle('tm-hidden', strategy !== 'per-slide');
    if (strategy !== 'per-slide') return;

    var existing = all('input', wrap).map(function (input) { return input.value; });
    var def = $('tmSlideDefault').value || '02:00';
    wrap.innerHTML = '';
    for (var i = 0; i < count; i++) {
      var row = document.createElement('label');
      row.className = 'tm-time-row';
      row.innerHTML = '<span>Slide ' + (i + 1) + '</span>' +
        '<input type="text" data-slide-time="' + i + '" value="' + esc(existing[i] || def) + '" placeholder="mm:ss">' +
        '<button class="tm-iconbtn" type="button" title="Usar tempo padrao"><span class="material-symbols-outlined">content_copy</span></button>';
      row.querySelector('button').addEventListener('click', function (ev) {
        ev.currentTarget.parentNode.querySelector('input').value = $('tmSlideDefault').value || '02:00';
        updatePreview();
      });
      wrap.appendChild(row);
    }
  }

  function sectionDefaults() {
    return [
      { name: 'Abertura', slides: 3, time: '05:00' },
      { name: 'Desenvolvimento', slides: 6, time: '18:00' },
      { name: 'Fechamento', slides: 2, time: '07:00' },
    ];
  }

  function ensureSections(seed) {
    var wrap = $('tmSections');
    if (wrap.children.length) return;
    (seed || sectionDefaults()).forEach(function (sec) { addSection(sec); });
  }

  function addSection(sec) {
    var wrap = $('tmSections');
    var index = wrap.children.length + 1;
    var block = document.createElement('div');
    block.className = 'tm-section-block';
    block.innerHTML =
      '<div class="tm-section-row">' +
      '<input type="text" data-section-name value="' + esc(sec && sec.name || ('Secao ' + index)) + '" aria-label="Nome da secao">' +
      '<input type="number" data-section-slides min="1" max="100" value="' + esc(sec && sec.slides || 3) + '" aria-label="Slides da secao">' +
      '<input type="text" data-section-time value="' + esc(sec && sec.time || $('tmSectionDefault').value || '05:00') + '" aria-label="Tempo da secao">' +
      '<button class="tm-iconbtn" type="button" title="Remover secao"><span class="material-symbols-outlined">delete</span></button>' +
      '</div>' +
      '<div class="tm-section-slides" data-section-slide-times></div>';
    block.querySelector('button').addEventListener('click', function () {
      block.remove();
      if (!wrap.children.length) addSection({ name: 'Secao 1', slides: 3, time: $('tmSectionDefault').value || '05:00' });
      syncSetup();
      updatePreview();
    });
    wrap.appendChild(block);
    if (sec && sec.slideTimes) {
      renderSectionRows();
      all('[data-section-slide-time]', block).forEach(function (input, i) {
        if (sec.slideTimes[i]) input.value = sec.slideTimes[i];
      });
    }
  }

  function renderSectionRows() {
    ensureSections();
    var strategy = $('tmSectionStrategy').value;
    $('tmSectionTotalField').classList.toggle('tm-hidden', strategy !== 'total');
    $('tmSectionDefaultField').classList.toggle('tm-hidden', strategy === 'total');
    all('.tm-section-block', $('tmSections')).forEach(function (block) {
      var slides = clamp(parseInt(block.querySelector('[data-section-slides]').value, 10) || 1, 1, 100);
      var list = block.querySelector('[data-section-slide-times]');
      var existing = all('input', list).map(function (input) { return input.value; });
      var sectionTime = block.querySelector('[data-section-time]');
      sectionTime.classList.toggle('tm-hidden', strategy === 'total' || strategy === 'per-slide');
      list.classList.toggle('tm-hidden', strategy !== 'per-slide');
      if (strategy !== 'per-slide') return;
      list.innerHTML = '';
      for (var i = 0; i < slides; i++) {
        var input = document.createElement('input');
        input.type = 'text';
        input.value = existing[i] || $('tmSectionDefault').value || '02:00';
        input.placeholder = 'Slide ' + (i + 1);
        input.setAttribute('data-section-slide-time', String(i));
        input.setAttribute('aria-label', 'Tempo do slide ' + (i + 1));
        list.appendChild(input);
      }
    });
  }

  function syncSetup() {
    renderSlideRows();
    renderSectionRows();
    $('tmSlidesPanel').classList.toggle('tm-hidden', activeMode() !== 'slides');
    $('tmSectionsPanel').classList.toggle('tm-hidden', activeMode() !== 'sections');
  }

  function buildSlidesPlan() {
    var count = clamp(parseInt($('tmSlideCount').value, 10) || 1, 1, 200);
    var strategy = $('tmSlideStrategy').value;
    var durations = strategy === 'total'
      ? distribute(parseTime($('tmSlideTotal').value), count)
      : all('[data-slide-time]').slice(0, count).map(function (input) { return parseTime(input.value); });

    return durations.map(function (duration, i) {
      return {
        title: 'Slide ' + (i + 1),
        label: 'Slide ' + (i + 1) + ' / ' + count,
        section: '',
        slide: i + 1,
        duration: Math.max(1, duration),
      };
    });
  }

  function readSections() {
    ensureSections();
    return all('.tm-section-block', $('tmSections')).map(function (block, index) {
      return {
        name: block.querySelector('[data-section-name]').value.trim() || ('Secao ' + (index + 1)),
        slides: clamp(parseInt(block.querySelector('[data-section-slides]').value, 10) || 1, 1, 100),
        time: block.querySelector('[data-section-time]').value,
        slideTimes: all('[data-section-slide-time]', block).map(function (input) { return input.value; }),
      };
    });
  }

  function buildSectionsPlan() {
    var sections = readSections();
    var strategy = $('tmSectionStrategy').value;
    var sectionDurations;

    if (strategy === 'total') {
      sectionDurations = distribute(parseTime($('tmSectionTotal').value), sections.length);
    } else {
      sectionDurations = sections.map(function (sec) { return parseTime(sec.time || $('tmSectionDefault').value); });
    }

    var items = [];
    sections.forEach(function (sec, si) {
      var durations = strategy === 'per-slide'
        ? Array(sec.slides).fill(0).map(function (_, i) { return parseTime(sec.slideTimes[i] || $('tmSectionDefault').value); })
        : distribute(sectionDurations[si], sec.slides);
      durations.forEach(function (duration, slideIndex) {
        items.push({
          title: sec.name,
          label: sec.name + ' - slide ' + (slideIndex + 1) + ' / ' + sec.slides,
          section: sec.name,
          slide: slideIndex + 1,
          duration: Math.max(1, duration),
        });
      });
    });
    return items;
  }

  function buildPlan() {
    return activeMode() === 'sections' ? buildSectionsPlan() : buildSlidesPlan();
  }

  function saveSetup() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        mode: activeMode(),
        slideCount: $('tmSlideCount').value,
        slideStrategy: $('tmSlideStrategy').value,
        slideTotal: $('tmSlideTotal').value,
        slideDefault: $('tmSlideDefault').value,
        slideTimes: all('[data-slide-time]').map(function (input) { return input.value; }),
        sectionStrategy: $('tmSectionStrategy').value,
        sectionTotal: $('tmSectionTotal').value,
        sectionDefault: $('tmSectionDefault').value,
        metaScale: $('tmMetaScale').value,
        textScale: $('tmTextScale').value,
        timerScale: $('tmTimerScale').value,
        sections: readSections(),
      }));
    } catch (e) { }
  }

  function loadSetup() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      var data = JSON.parse(raw);
      if (data.mode) {
        var mode = document.querySelector('input[name="tmMode"][value="' + data.mode + '"]');
        if (mode) mode.checked = true;
      }
      $('tmSlideCount').value = data.slideCount || $('tmSlideCount').value;
      $('tmSlideStrategy').value = data.slideStrategy || $('tmSlideStrategy').value;
      $('tmSlideTotal').value = data.slideTotal || $('tmSlideTotal').value;
      $('tmSlideDefault').value = data.slideDefault || $('tmSlideDefault').value;
      $('tmSectionStrategy').value = data.sectionStrategy || $('tmSectionStrategy').value;
      $('tmSectionTotal').value = data.sectionTotal || $('tmSectionTotal').value;
      $('tmSectionDefault').value = data.sectionDefault || $('tmSectionDefault').value;
      $('tmMetaScale').value = data.metaScale || $('tmMetaScale').value;
      $('tmTextScale').value = data.textScale || $('tmTextScale').value;
      $('tmTimerScale').value = data.timerScale || $('tmTimerScale').value;
      applyDisplaySettings();
      $('tmSections').innerHTML = '';
      ensureSections(data.sections || null);
      renderSlideRows();
      (data.slideTimes || []).forEach(function (value, i) {
        var input = document.querySelector('[data-slide-time="' + i + '"]');
        if (input) input.value = value;
      });
    } catch (e) { }
  }

  function updatePreview() {
    var items = buildPlan();
    var total = items.reduce(function (acc, item) { return acc + item.duration; }, 0);
    $('tmTotalPreview').textContent = fmt(total);
    $('tmItemPreview').textContent = String(items.length);
    $('tmSummaryText').textContent = items.length + ' slide(s), ' + fmt(total) + ' no total.';
    $('tmPreview').innerHTML = items.slice(0, 12).map(function (item, i) {
      return '<div class="tm-preview-row"><span>' + esc(item.label || item.title || ('Slide ' + (i + 1))) + '</span><strong>' + fmt(item.duration) + '</strong></div>';
    }).join('') + (items.length > 12 ? '<div class="tm-preview-row"><span>Mais ' + (items.length - 12) + ' slide(s)</span><strong>...</strong></div>' : '');
    saveSetup();
  }

  function renderRunner() {
    var item = state.items[state.current];
    if (!item) return;
    $('tmStageLabel').textContent = item.label;
    $('tmStageTitle').textContent = item.title;
    $('tmTime').textContent = fmt(state.remaining);
    $('tmTime').classList.toggle('tm-negative', state.remaining < 0);
    var pct = item.duration > 0 ? clamp((state.remaining / item.duration) * 100, 0, 100) : 0;
    $('tmProgress').style.width = pct + '%';
    $('tmStartPause').innerHTML = state.running
      ? '<span class="material-symbols-outlined">pause</span>'
      : '<span class="material-symbols-outlined">play_arrow</span>';
    $('tmStartPause').title = state.running ? 'Pausar' : 'Iniciar';
    $('tmAgenda').innerHTML = state.items.map(function (agendaItem, i) {
      var cls = i === state.current ? ' active' : (i < state.current ? ' done' : '');
      return '<div class="tm-agenda-row' + cls + '"><span>' + esc(agendaItem.label) + '</span><strong>' + fmt(agendaItem.duration) + '</strong></div>';
    }).join('');
  }

  function tick() {
    if (!state.running) return;
    state.remaining -= 1;
    renderRunner();
    state.timerId = window.setTimeout(tick, 1000);
  }

  function startPause() {
    state.running = !state.running;
    if (state.running) {
      if (!state.presentationStartedAt) state.presentationStartedAt = Date.now();
      tick();
    } else if (state.timerId) {
      window.clearTimeout(state.timerId);
    }
    renderRunner();
  }

  function goTo(index) {
    if (!state.items.length) return;
    state.current = clamp(index, 0, state.items.length - 1);
    state.remaining = state.items[state.current].duration;
    renderRunner();
  }

  function prepareRunner(ev) {
    ev.preventDefault();
    state.items = buildPlan();
    if (!state.items.length) return;
    state.current = 0;
    state.remaining = state.items[0].duration;
    state.running = false;
    state.presentationStartedAt = null;
    $('tmElapsed').textContent = '00:00:00';
    $('tmSetup').classList.add('tm-hidden');
    $('tmRunner').classList.remove('tm-hidden');
    renderRunner();
  }

  function updateClock() {
    var now = new Date();
    $('tmClock').textContent = pad(now.getHours()) + ':' + pad(now.getMinutes()) + ':' + pad(now.getSeconds());
    if (state.presentationStartedAt) {
      $('tmElapsed').textContent = fmt(Math.floor((Date.now() - state.presentationStartedAt) / 1000), true);
    }
    window.setTimeout(updateClock, 1000);
  }

  function toggleFullscreen() {
    root.classList.toggle('tm-full');
    document.body.classList.toggle('tm-fullbody', root.classList.contains('tm-full'));
  }

  function resetDefaults() {
    try { localStorage.removeItem(STORAGE_KEY); } catch (e) { }
    document.querySelector('input[name="tmMode"][value="slides"]').checked = true;
    $('tmSlideCount').value = 10;
    $('tmSlideStrategy').value = 'total';
    $('tmSlideTotal').value = '20:00';
    $('tmSlideDefault').value = '02:00';
    $('tmSectionStrategy').value = 'per-section';
    $('tmSectionTotal').value = '30:00';
    $('tmSectionDefault').value = '05:00';
    $('tmMetaScale').value = 100;
    $('tmTextScale').value = 100;
    $('tmTimerScale').value = 100;
    applyDisplaySettings();
    $('tmSections').innerHTML = '';
    ensureSections();
    syncSetup();
    updatePreview();
  }

  function wire() {
    root.addEventListener('input', function (ev) {
      if (ev.target && ev.target.matches('#tmMetaScale, #tmTextScale, #tmTimerScale')) applyDisplaySettings();
      if (ev.target && ev.target.matches('#tmSlideCount, [data-section-slides]')) syncSetup();
      updatePreview();
    });
    root.addEventListener('change', function (ev) {
      if (ev.target && ev.target.matches('input[name="tmMode"], #tmSlideStrategy, #tmSectionStrategy, #tmSlideCount, [data-section-slides]')) syncSetup();
      updatePreview();
    });
    $('tmForm').addEventListener('submit', prepareRunner);
    $('tmAddSection').addEventListener('click', function () { addSection(); syncSetup(); updatePreview(); });
    $('tmResetSetup').addEventListener('click', resetDefaults);
    $('tmLoadDemo').addEventListener('click', function () {
      document.querySelector('input[name="tmMode"][value="sections"]').checked = true;
      $('tmSectionStrategy').value = 'per-section';
      $('tmSections').innerHTML = '';
      ensureSections(sectionDefaults());
      syncSetup();
      updatePreview();
    });
    $('tmBackSetup').addEventListener('click', function () {
      state.running = false;
      if (state.timerId) window.clearTimeout(state.timerId);
      $('tmRunner').classList.add('tm-hidden');
      $('tmSetup').classList.remove('tm-hidden');
      document.body.classList.remove('tm-fullbody');
      root.classList.remove('tm-full');
    });
    $('tmStartPause').addEventListener('click', startPause);
    $('tmPrev').addEventListener('click', function () { goTo(state.current - 1); });
    $('tmNext').addEventListener('click', function () { goTo(state.current + 1); });
    $('tmRestart').addEventListener('click', function () { goTo(state.current); });
    $('tmFullscreen').addEventListener('click', toggleFullscreen);
    document.addEventListener('keydown', function (ev) {
      if ($('tmRunner').classList.contains('tm-hidden')) return;
      if (ev.key === 'ArrowRight') goTo(state.current + 1);
      if (ev.key === 'ArrowLeft') goTo(state.current - 1);
      if (ev.key === ' ') { ev.preventDefault(); startPause(); }
      if (ev.key === 'Escape' && root.classList.contains('tm-full')) toggleFullscreen();
    });
  }

  loadSetup();
  ensureSections();
  wire();
  applyDisplaySettings();
  syncSetup();
  updatePreview();
  updateClock();
})();
