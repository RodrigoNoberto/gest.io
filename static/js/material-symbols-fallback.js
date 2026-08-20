(function () {
  var icons = {
    add: '<path d="M12 5v14M5 12h14"/>',
    visibility: '<path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6z"/><circle cx="12" cy="12" r="3"/>',
    fullscreen: '<path d="M8 3H3v5M16 3h5v5M8 21H3v-5M21 16v5h-5"/><path d="M3 3l6 6M21 3l-6 6M3 21l6-6M21 21l-6-6"/>',
    fullscreen_exit: '<path d="M9 3v6H3M15 3v6h6M9 21v-6H3M15 21v-6h6"/><path d="M9 9 3 3M15 9l6-6M9 15l-6 6M15 15l6 6"/>',
    swap_horiz: '<path d="M7 7h13M17 4l3 3-3 3M17 17H4M7 14l-3 3 3 3"/>',
    save: '<path d="M5 3h12l2 2v16H5z"/><path d="M8 3v7h8V3M8 21v-7h8v7"/>',
    groups: '<path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21a7 7 0 0 1 14 0"/><path d="M17 11a3 3 0 1 0-1.5-5.6M17 14a5 5 0 0 1 5 5v2"/>',
    warning: '<path d="M12 3 2 21h20z"/><path d="M12 9v5M12 18h.01"/>',
    fact_check: '<path d="M4 5h16v14H4z"/><path d="M8 9h5M8 13h5M8 17h3M15 16l2 2 4-5"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>',
    table_view: '<path d="M4 5h16v14H4zM4 10h16M10 5v14"/>',
    text_fields: '<path d="M4 6V4h16v2M12 4v16M9 20h6"/><path d="M4 11h6M7 11v9M5 20h4"/>',
    science: '<path d="M9 3h6M10 3v5l-5 9a3 3 0 0 0 2.6 4.5h8.8A3 3 0 0 0 19 17l-5-9V3"/><path d="M8 15h8"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
    delete: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 14h10l1-14M9 7V4h6v3"/>',
    chat_bubble: '<path d="M5 5h14v10H8l-4 4V6a1 1 0 0 1 1-1z"/>',
    chevron_right: '<path d="m9 6 6 6-6 6"/>',
    expand_more: '<path d="m6 9 6 6 6-6"/>',
    filter_list: '<path d="M4 6h16M7 12h10M10 18h4"/>',
    view_timeline: '<path d="M4 6h6v4H4zM14 6h6v4h-6zM7 14h10v4H7z"/><path d="M10 8h4M12 10v4"/>',
    auto_awesome: '<path d="m12 3 1.8 4.4L18 9.2l-4.2 1.8L12 15l-1.8-4L6 9.2l4.2-1.8L12 3z"/><path d="m5 14 .9 2.1L8 17l-2.1.9L5 20l-.9-2.1L2 17l2.1-.9L5 14zM19 14l.9 2.1L22 17l-2.1.9L19 20l-.9-2.1L16 17l2.1-.9L19 14z"/>',
    play_arrow: '<path d="M8 5v14l11-7z"/>',
    pause: '<path d="M8 5h3v14H8zM13 5h3v14h-3z"/>',
    restart_alt: '<path d="M4 6v5h5"/><path d="M5.7 15A7 7 0 1 0 7 7.8L4 11"/>',
    tune: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10M4 12h4M12 12h8"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/><circle cx="10" cy="12" r="2"/>',
    skip_previous: '<path d="M6 5v14"/><path d="m18 6-9 6 9 6z"/>',
    skip_next: '<path d="M18 5v14"/><path d="m6 6 9 6-9 6z"/>',
    replay: '<path d="M4 7v6h6"/><path d="M5.8 17A7 7 0 1 0 6 7.7L4 13"/>',
    content_copy: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2"/>'
  };

  function iconSvg(name) {
    var path = icons[name];
    if (!path) return '';
    return '<svg class="cr-icon-svg" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + path + '</svg>';
  }

  function hydrateIcon(el) {
    if (!el || el.dataset.crIconized === '1') return;
    var name = (el.textContent || '').trim();
    var svg = iconSvg(name);
    if (!svg) return;
    el.dataset.crIcon = name;
    el.dataset.crIconized = '1';
    el.setAttribute('aria-hidden', 'true');
    el.innerHTML = svg;
  }

  function hydrate(root) {
    if (!root) return;
    if (root.matches && root.matches('.material-symbols-outlined')) {
      hydrateIcon(root);
    }
    root.querySelectorAll && root.querySelectorAll('.material-symbols-outlined').forEach(hydrateIcon);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { hydrate(document); });
  } else {
    hydrate(document);
  }

  new MutationObserver(function (mutations) {
    mutations.forEach(function (mutation) {
      mutation.addedNodes.forEach(function (node) {
        if (node.nodeType === 1) hydrate(node);
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
