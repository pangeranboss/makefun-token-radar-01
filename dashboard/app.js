// Token Radar's dashboard. It reads window.RADAR (written beside dashboard/ by
// main.ts) and renders the ranked board, the filters, the per-protocol detail
// drawer and the Already trading view. No network: every byte it shows is in data.js.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var rows = DATA.rows || [];
  var live = DATA.live || [];
  var model = DATA.model || {};

  var state = { tab: 'board', q: '', cat: 'all', chain: 'all', tvl: 'all', sort: 'implied', dir: -1, watch: false, selected: null };

  function esc(s) {
    return String(s === null || s === undefined ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (Math.abs(n) >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(2) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return Math.max(0, Math.round(days)) + 'd';
  }
  function pctClass(n) {
    if (n === null || n === undefined) return 'flat';
    return n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
  }

  // The model in one function, as in lib/model.ts: the page recomputes a row
  // from the snapshot figures and checks the number board.json carries, so the
  // page's code and the board's data are visibly the same arithmetic.
  function impliedOf(r) {
    var growth = Math.min(model.growth_cap, Math.max(model.growth_floor, r.change_7d === null ? 0 : r.change_7d));
    var growthMult = 1 + (growth / 100) * model.growth_weight;
    var age = r.age_days === null ? model.unknown_age_days : r.age_days;
    var maturity = model.maturity_floor + model.maturity_range * Math.sqrt(Math.min(Math.max(age, 0), model.maturity_days) / model.maturity_days);
    return Math.max(1, Math.round(r.tvl_usd * model.base_multiple * growthMult * maturity));
  }

  function $(id) { return document.getElementById(id); }
  function money(n) { return fmtUsd(n); }

  // ---- Header, stats, model strip -------------------------------------------
  $('meta').innerHTML =
    '<dt>Snapshot</dt><dd>' + esc(DATA.as_of) + '</dd>' +
    '<dt>Source</dt><dd>DefiLlama protocols</dd>' +
    '<dt>Watchlist floor</dt><dd>' + money(DATA.floor_usd) + '</dd>' +
    '<dt>Model</dt><dd>' + esc(DATA.model_version) + '</dd>';
  $('stats').innerHTML =
    '<div class="stat hot"><b>' + DATA.board_size + '</b><span>protocols ranked</span></div>' +
    '<div class="stat"><b>' + DATA.watchlist_size + '</b><span>on the watchlist</span></div>' +
    '<div class="stat"><b>' + DATA.early_size + '</b><span>early finds below the floor</span></div>' +
    '<div class="stat"><b>' + DATA.pre_token_count + '</b><span>record no token in the snapshot</span></div>';
  $('model').innerHTML =
    '<p class="formula"><strong>implied value = TVL &times; 0.30</strong> &times; ' +
    'growth multiplier from the 7-day TVL change (clamped &minus;50% to +150%, weight 0.6) &times; ' +
    'maturity multiplier from age (0.55 + 0.45 &times; &radic;(age &divide; 4y)). ' +
    'Worked out by <code>impliedValue</code> in <code>lib/model.ts</code>; ' +
    'protocols whose token already trades are set aside, never ranked.</p>';

  // ---- Filter options --------------------------------------------------------
  function fillSelect(id, values) {
    var sel = $(id);
    values.forEach(function (v) {
      var o = document.createElement('option');
      o.value = v; o.textContent = v;
      sel.appendChild(o);
    });
  }
  var cats = [], chains = [];
  rows.forEach(function (r) {
    if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category);
    (r.chains || []).forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  fillSelect('cat', cats.sort());
  fillSelect('chain', chains.sort());

  // ---- Filtering and sorting -------------------------------------------------
  function inTvl(r) {
    var t = r.tvl_usd;
    if (state.tvl === '5-50') return t >= 5e6 && t < 50e6;
    if (state.tvl === '50-250') return t >= 50e6 && t < 250e6;
    if (state.tvl === '250-1000') return t >= 250e6 && t < 1e9;
    if (state.tvl === '1000+') return t >= 1e9;
    return true;
  }
  function visible() {
    var q = state.q.trim().toLowerCase();
    return rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.cat !== 'all' && r.category !== state.cat) return false;
      if (state.chain !== 'all' && (r.chains || []).indexOf(state.chain) < 0) return false;
      if (!inTvl(r)) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
  }
  function sorter(a, b) {
    var k = state.sort, d = state.dir, x, y;
    if (k === 'name') { x = a.name.toLowerCase(); y = b.name.toLowerCase(); }
    else if (k === 'tvl') { x = a.tvl_usd; y = b.tvl_usd; }
    else if (k === 'change') { x = a.change_7d === null ? -Infinity : a.change_7d; y = b.change_7d === null ? -Infinity : b.change_7d; }
    else if (k === 'age') { x = a.age_days === null ? -1 : a.age_days; y = b.age_days === null ? -1 : b.age_days; }
    else if (k === 'category') { x = (a.category || '').toLowerCase(); y = (b.category || '').toLowerCase(); }
    else if (k === 'rank') { x = a.rank; y = b.rank; }
    else { x = a.implied_value_usd; y = b.implied_value_usd; }
    if (x < y) return -d;
    if (x > y) return d;
    return a.slug < b.slug ? -1 : 1;
  }

  // ---- Board table -----------------------------------------------------------
  function renderBoard() {
    var list = visible().sort(sorter);
    var tb = $('rows');
    tb.innerHTML = list.map(function (r) {
      var badge = r.watchlist ? '<span class="badge watch">Watchlist</span>' : '<span class="badge early">Early find</span>';
      var ch = (r.chains || []).slice(0, 2).map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('');
      if ((r.chains || []).length > 2) ch += '<span class="chip">+' + (r.chains.length - 2) + '</span>';
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.selected === r.slug ? ' class="open"' : '') + '>' +
        '<td class="rank">' + r.rank + '</td>' +
        '<td class="name"><b>' + esc(r.name) + badge + '</b><span>' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + ch + '</td>' +
        '<td class="tvl">' + money(r.tvl_usd) + '</td>' +
        '<td class="chg ' + pctClass(r.change_7d) + '">' + fmtPct(r.change_7d) + '</td>' +
        '<td class="age">' + fmtAge(r.age_days) + '</td>' +
        '<td class="impl">' + money(r.implied_value_usd) + '</td>' +
        '<td class="go">&rsaquo;</td></tr>';
    }).join('');
    $('empty').hidden = list.length > 0;
    $('count').innerHTML = 'Showing <b>' + list.length + '</b> of <b>' + rows.length + '</b> ranked protocols' +
      (state.watch ? ' on the watchlist' : '') +
      (state.cat !== 'all' ? ' · category <b>' + esc(state.cat) + '</b>' : '') +
      (state.chain !== 'all' ? ' · chain <b>' + esc(state.chain) + '</b>' : '') +
      ' · sorted by ' + esc(state.sort) + (state.dir < 0 ? ' ↓' : ' ↑');
    document.querySelectorAll('#board thead th[data-sort]').forEach(function (th) {
      th.classList.toggle('sorted', th.getAttribute('data-sort') === state.sort || (state.sort === 'implied' && th.getAttribute('data-sort') === 'implied'));
    });
  }

  // ---- Already trading -------------------------------------------------------
  function renderLive() {
    $('live-rows').innerHTML = live.map(function (r) {
      var ch = (r.chains || []).slice(0, 2).map(function (c) { return '<span class="chip">' + esc(c) + '</span>'; }).join('');
      if ((r.chains || []).length > 2) ch += '<span class="chip">+' + (r.chains.length - 2) + '</span>';
      return '<tr>' +
        '<td class="name"><b>' + esc(r.name) + '</b><span>' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + ch + '</td>' +
        '<td class="tvl">' + money(r.tvl_usd) + '</td>' +
        '<td class="tvl">' + money(r.mcap_usd) + '</td>' +
        '<td class="tvl">' + (isFinite(r.mcap_per_tvl) ? r.mcap_per_tvl.toFixed(2) + '×' : 'n/a') + '</td>' +
        '<td class="chg ' + pctClass(r.change_7d) + '">' + fmtPct(r.change_7d) + '</td></tr>';
    }).join('');
    $('count').innerHTML = '<b>' + live.length + '</b> largest protocols whose token already trades, by market cap — ' +
      'shown at the market&rsquo;s own value, never ranked against the pre-token board.';
  }

  function setTab(tab) {
    state.tab = tab;
    $('tab-board').setAttribute('aria-selected', tab === 'board' ? 'true' : 'false');
    $('tab-live').setAttribute('aria-selected', tab === 'live' ? 'true' : 'false');
    $('board').hidden = tab !== 'board';
    $('live').hidden = tab !== 'live';
    if (tab === 'board') renderBoard(); else renderLive();
  }

  // ---- Detail drawer ---------------------------------------------------------
  function parseStep(s) {
    var ci = s.lastIndexOf(' Cost: ');
    var ti = s.lastIndexOf(' Time: ');
    if (ci < 0 || ti < 0 || ti < ci) return { text: s, cost: '', time: '' };
    return {
      text: s.slice(0, ci),
      cost: s.slice(ci + 7, ti).replace(/\.$/, ''),
      time: s.slice(ti + 7).replace(/\.$/, ''),
    };
  }
  function openDetail(slug) {
    var r = null;
    for (var i = 0; i < rows.length; i++) if (rows[i].slug === slug) { r = rows[i]; break; }
    if (!r) return;
    state.selected = slug;
    var recomputed = impliedOf(r);
    var steps = r.farm_steps.map(function (s) {
      var p = parseStep(s);
      return '<li>' + esc(p.text) +
        '<span class="costs"><span>Cost: ' + esc(p.cost) + '</span><span>Time: ' + esc(p.time) + '</span></span></li>';
    }).join('');
    $('drawer-body').innerHTML =
      '<h2>' + esc(r.name) + '</h2>' +
      '<p class="slug">' + esc(r.slug) + ' · listed ' + esc(r.listed_at || 'date not reported') + '</p>' +
      '<p class="badges">' + (r.watchlist ? '<span class="badge watch">Watchlist</span>' : '<span class="badge early">Early find</span>') +
      '<span class="badge early">' + esc(r.category || 'No category') + '</span></p>' +
      '<div class="kv">' +
      '<div><span>TVL</span><b>' + money(r.tvl_usd) + '</b></div>' +
      '<div><span>7-day change</span><b class="' + pctClass(r.change_7d) + '">' + fmtPct(r.change_7d) + '</b></div>' +
      '<div><span>Age</span><b>' + fmtAge(r.age_days) + '</b></div>' +
      '<div><span>Chains</span><b>' + esc((r.chains || []).slice(0, 3).join(', ') || '—') + '</b></div>' +
      '</div>' +
      '<h3>Implied value — the model&rsquo;s arithmetic</h3>' +
      '<table class="math"><tbody>' +
      '<tr><td>Base — TVL &times; 0.30</td><td>' + money(r.base_usd) + '</td></tr>' +
      '<tr><td>Growth multiplier — 7d ' + fmtPct(r.change_7d) + '</td><td>&times;' + r.growth_multiplier.toFixed(4) + '</td></tr>' +
      '<tr><td>Maturity multiplier — age ' + fmtAge(r.age_days) + '</td><td>&times;' + r.maturity_multiplier.toFixed(4) + '</td></tr>' +
      '<tr class="total"><td>Implied value</td><td>' + money(r.implied_value_usd) + '</td></tr>' +
      '</tbody></table>' +
      '<p class="note">This page recomputes the value from the same figures: ' + money(recomputed) +
      (recomputed === r.implied_value_usd ? ' — it matches board.json.' : ' — it differs from board.json; trust the recomputed figure.') + '</p>' +
      '<h3>Farm plan — rank #' + r.rank + ' of ' + rows.length + '</h3>' +
      '<ol class="plan">' + steps + '</ol>' +
      '<p class="note">This protocol records no token in the snapshot — DefiLlama&rsquo;s record ' +
      'is not proof it has none. The plan is a starting point, not advice: verify ' +
      'every step on the protocol&rsquo;s own pages and never pay to claim anything.</p>';
    $('drawer').hidden = false;
    $('scrim').hidden = false;
    renderBoard();
  }
  function closeDetail() {
    state.selected = null;
    $('drawer').hidden = true;
    $('scrim').hidden = true;
    renderBoard();
  }

  // ---- Events ----------------------------------------------------------------
  $('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) openDetail(tr.getAttribute('data-slug'));
  });
  $('drawer-close').addEventListener('click', closeDetail);
  $('scrim').addEventListener('click', closeDetail);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDetail(); });
  $('tab-board').addEventListener('click', function () { setTab('board'); });
  $('tab-live').addEventListener('click', function () { setTab('live'); });
  $('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  $('cat').addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  $('tvl').addEventListener('change', function (e) { state.tvl = e.target.value; renderBoard(); });
  $('watch').addEventListener('change', function (e) { state.watch = e.target.checked; renderBoard(); });
  $('sort').addEventListener('change', function (e) {
    state.sort = e.target.value;
    state.dir = state.sort === 'name' ? 1 : -1;
    renderBoard();
  });
  document.querySelectorAll('#board thead th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (state.sort === k) state.dir = -state.dir;
      else { state.sort = k; state.dir = k === 'name' || k === 'category' ? 1 : -1; }
      var sel = $('sort');
      if (sel.querySelector('option[value="' + k + '"]')) sel.value = k;
      renderBoard();
    });
  });

  // ---- Deep links: #tab=live, #cat=Risk Curators, #q=veda, #p=slug ----------
  (function fromHash() {
    var h = (location.hash || '').replace(/^#/, '');
    if (!h) return;
    h.split('&').forEach(function (part) {
      var kv = part.split('=');
      var k = kv[0], v = decodeURIComponent((kv[1] || '').replace(/\+/g, ' '));
      if (k === 'tab' && v === 'live') setTab('live');
      if (k === 'cat' && cats.indexOf(v) >= 0) { state.cat = v; $('cat').value = v; }
      if (k === 'chain' && chains.indexOf(v) >= 0) { state.chain = v; $('chain').value = v; }
      if (k === 'q') { state.q = v; $('q').value = v; }
      if (k === 'watch' && v === '1') { state.watch = true; $('watch').checked = true; }
    });
    var m = h.match(/(?:^|&)p=([^&]+)/);
    if (m) openDetail(decodeURIComponent(m[1]));
  })();

  if (state.tab === 'live') renderLive(); else renderBoard();
})();
