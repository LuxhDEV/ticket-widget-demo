(function () {
  'use strict';

  // Demo ticket shop built from individual Enviso step components.
  // Config comes only from URL query parameters; this script persists nothing itself.

  var STAGING_WIDGET_API = 'https://api.staging-enviso.io/ticketwidgetapi/';
  var BASE = 'https://widget.staging-enviso.io';
  var LOADER = BASE + '/loader.js';
  var C = BASE + '/build-ts/components/';

  // Real bundle paths (checked on the staging CDN). The docs list
  // tickets/enviso-ticket-selection-step-element.js, which only serves an HTML fallback.
  var COMPONENTS = [
    C + 'common/enviso-tickets/enviso-ticket-selection-step-element.js',
    C + 'tickets/enviso-time-selection-step-element.js',
    C + 'basket/enviso-basket-overview-element.js',
    C + 'basket/enviso-basket-my-info-element.js',
    C + 'tickets/enviso-payment-step-element.js',
    C + 'tickets/enviso-ticket-order-complete-step-element.js'
  ];
  var TAGS = [
    'enviso-ticket-selection-step',
    'enviso-time-selection-step',
    'enviso-basket-overview',
    'enviso-basket-my-info',
    'enviso-payment-step',
    'enviso-ticket-order-complete-step'
  ];

  // Basket session key owned by the widget itself (not an API key). Reused so the
  // widget basket sees reservations created by our own add-to-basket call.
  var WIDGET_SESSION_STORAGE_KEY = 'sessionId';
  var SESSION_HEADER = 'x-session-id';

  var PROGRESS = [
    { id: 'tickets', label: 'Tickets' },
    { id: 'time', label: 'Datum & Zeit' },
    { id: 'basket', label: 'Warenkorb' },
    { id: 'info', label: 'Deine Daten' },
    { id: 'payment', label: 'Zahlung' },
    { id: 'done', label: 'Abschluss' }
  ];

  var state = {
    config: null,
    ready: false,
    venueTz: undefined,
    offers: null, // cached offer cards
    offer: null, // current booking offer
    needsTime: true,
    bookingSub: 'tickets',
    checkoutSub: 'info',
    paymentMounted: false,
    orderNumber: null,
    lastCount: 0,
    openDrawerAfterRoute: false,
    expiryTimer: null
  };

  // ---------- helpers ----------

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $all(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function setStatus(text, isError) {
    var el = $('#status');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('error', !!isError);
  }

  function money(value, currency) {
    try {
      return new Intl.NumberFormat(state.config.locale, { style: 'currency', currency: currency || 'EUR' })
        .format(Number(value) || 0);
    } catch (e) {
      return (Number(value) || 0).toFixed(2) + ' ' + (currency || 'EUR');
    }
  }

  function fmtDate(iso) {
    if (!iso) return '';
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso));
    if (!m) return String(iso);
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.toLocaleDateString(state.config.locale, { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function fmtTime(value) {
    if (!value) return '';
    var d = value instanceof Date ? value : new Date(value);
    if (isNaN(d.getTime())) return '';
    var o = { hour: '2-digit', minute: '2-digit' };
    if (state.venueTz) o.timeZone = state.venueTz;
    return d.toLocaleTimeString(state.config.locale, o);
  }

  function readConfig() {
    var p = new URLSearchParams(window.location.search);
    var apiUrl = (p.get('apiurl') || p.get('apiUrl') || '').trim() || STAGING_WIDGET_API;
    if (apiUrl.slice(-1) !== '/') apiUrl += '/';
    var offersRaw = (p.get('offers') || p.get('offerIds') || '').trim();
    return {
      apiKey: (p.get('apikey') || p.get('apiKey') || '').trim(),
      salesPointId: Number((p.get('salespoint') || p.get('salesPoint') || '').trim()),
      offerIds: offersRaw
        ? offersRaw.split(',').map(function (s) { return Number(s.trim()); })
            .filter(function (n) { return Number.isFinite(n) && n > 0; })
        : [],
      language: (p.get('lang') || p.get('language') || 'de').trim(),
      locale: (p.get('locale') || 'de-DE').trim(),
      apiUrl: apiUrl
    };
  }

  function isPaymentReturn() {
    var p = new URLSearchParams(window.location.search);
    return p.has('redirectResult') || p.has('payload');
  }

  function api(path, opts) {
    var c = state.config;
    var o = opts || {};
    var headers = Object.assign({ 'x-api-key': c.apiKey }, o.headers || {});
    return fetch(c.apiUrl + path, { method: o.method || 'GET', headers: headers, body: o.body });
  }

  function apiJson(path) {
    return api(path).then(function (r) {
      if (!r.ok) throw new Error('API ' + r.status);
      return r.json();
    });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = function () { resolve(); };
      s.onerror = function () { reject(new Error('script load failed')); };
      document.head.appendChild(s);
    });
  }

  function basket() { return window.enviso && window.enviso.basket ? window.enviso.basket : null; }

  function basketItems() {
    var b = basket();
    try { return b ? b.getBasketItemsArray() : []; } catch (e) { return []; }
  }

  // ---------- event log (non-personal fields only) ----------

  var logCount = 0;
  function pick(obj, keys) {
    var out = {};
    if (!obj || typeof obj !== 'object') return out;
    keys.forEach(function (k) {
      if (obj[k] !== undefined && obj[k] !== null && typeof obj[k] !== 'object') out[k] = obj[k];
    });
    return out;
  }

  function log(name, fields) {
    var list = $('#eventlog');
    if (!list) return;
    var li = document.createElement('li');
    var t = document.createElement('span');
    t.className = 't';
    t.textContent = new Date().toLocaleTimeString('de-DE') + ' ';
    li.appendChild(t);
    var extra = fields && Object.keys(fields).length ? ' ' + JSON.stringify(fields) : '';
    li.appendChild(document.createTextNode(name + extra));
    list.insertBefore(li, list.firstChild);
    logCount += 1;
    var cnt = $('#dev-count');
    if (cnt) cnt.textContent = String(logCount);
  }

  // ---------- progress bar ----------

  function renderProgress(activeId) {
    var activeIdx = PROGRESS.findIndex(function (s) { return s.id === activeId; });
    $all('[data-progress]').forEach(function (ol) {
      ol.innerHTML = '';
      PROGRESS.forEach(function (s, i) {
        var li = document.createElement('li');
        li.textContent = s.label;
        var skipped = s.id === 'time' && state.offer && !state.needsTime && activeIdx <= 2;
        if (skipped) li.classList.add('skipped');
        if (i === activeIdx) li.classList.add('active');
        else if (i < activeIdx && !skipped) li.classList.add('done');
        ol.appendChild(li);
      });
    });
  }

  function showSub(viewName, sub) {
    $all('.view[data-view="' + viewName + '"] .step-panel').forEach(function (p) {
      p.classList.toggle('active', p.getAttribute('data-substep') === sub);
    });
    renderProgress(sub);
  }

  // ---------- offers (own cards from the API) ----------

  function offerKind(cf) {
    if (cf === 'PerSlot') return { tag: 'Zeitfenster', text: 'Ticket mit festem Zeitfenster – Uhrzeit wählst du bei der Buchung.' };
    if (cf === 'PerDay') return { tag: 'Tagesticket', text: 'Tagesticket – Besuchsdatum frei wählbar.' };
    return { tag: 'Flexibel', text: 'Gültig im gesamten Angebotszeitraum.' };
  }

  function loadOffers() {
    if (state.offers) return Promise.resolve(state.offers);
    var c = state.config;
    var q = 'salespoints/' + c.salesPointId + '/offers?language=' + encodeURIComponent(c.language) + '&offertype=ticket';
    if (c.offerIds.length) q += '&includedofferids=' + c.offerIds.join(',');
    return apiJson(q).then(function (list) {
      list = Array.isArray(list) ? list : [];
      return Promise.all(list.map(function (o) {
        return apiJson('salespoints/' + c.salesPointId + '/offers/' + o.id + '?language=' + encodeURIComponent(c.language))
          .then(function (d) {
            var prices = (d.products || []).map(function (p) { return p.price; }).filter(function (n) { return typeof n === 'number'; });
            return {
              id: d.id,
              name: d.localizedName || d.name,
              description: d.shortDescription || d.description || '',
              capacityFrequency: d.capacityFrequency,
              offerType: d.offerType,
              minPrice: prices.length ? Math.min.apply(null, prices) : null,
              currency: (d.products && d.products[0] && d.products[0].currency) || 'EUR'
            };
          });
      }));
    }).then(function (offers) {
      if (c.offerIds.length) {
        offers.sort(function (a, b) { return c.offerIds.indexOf(a.id) - c.offerIds.indexOf(b.id); });
      }
      state.offers = offers;
      log('offers loaded', { count: offers.length });
      return offers;
    });
  }

  function renderOfferCards(containerId, limit) {
    var host = document.getElementById(containerId);
    loadOffers().then(function (offers) {
      var list = limit ? offers.slice(0, limit) : offers;
      if (!list.length) {
        host.innerHTML = '<p class="muted">Aktuell keine Angebote verfügbar.</p>';
        return;
      }
      host.innerHTML = list.map(function (o, i) {
        var k = offerKind(o.capacityFrequency);
        return '<article class="offer-card">' +
          '<div class="offer-visual v' + (i % 4) + '"><span class="offer-tag">' + esc(k.tag) + '</span></div>' +
          '<div class="offer-body"><h3>' + esc(o.name) + '</h3>' +
          '<p>' + esc(o.description || k.text) + '</p>' +
          '<div class="offer-foot"><span class="price">' +
          (o.minPrice != null ? '<small>ab </small>' + esc(money(o.minPrice, o.currency)) : '') +
          '</span><a class="btn btn-primary" href="#buchen/' + o.id + '">Tickets wählen</a></div></div></article>';
      }).join('');
    }).catch(function () {
      host.innerHTML = '<p class="status error">Angebote konnten nicht geladen werden.</p>';
    });
  }

  // ---------- booking: tickets + date ----------

  function ticketStep() { return $('#mount-tickets enviso-ticket-selection-step'); }
  function timeStep() { return $('#mount-time enviso-time-selection-step'); }

  function openBooking(offerId) {
    if (state.offer && state.offer.id === offerId && ticketStep()) {
      state.bookingSub = 'tickets';
      showSub('buchen', 'tickets');
      updateBookingSummary();
      return;
    }
    $('#mount-tickets').innerHTML = '<p class="muted">Lade Angebot …</p>';
    $('#mount-time').innerHTML = '';
    apiJson('salespoints/' + state.config.salesPointId + '/offers/' + offerId + '?language=' + encodeURIComponent(state.config.language))
      .then(function (d) {
        state.offer = {
          id: d.id,
          name: d.localizedName || d.name,
          offerType: d.offerType,
          capacityFrequency: d.capacityFrequency
        };
        // Same rule as the built-in ticket flow.
        state.needsTime = d.offerType === 'Ticket' && d.capacityFrequency !== 'Total';
        $('#booking-title').textContent = state.offer.name;
        log('offerdetail', { offerId: d.id, capacityFrequency: d.capacityFrequency });
        mountTicketSelection();
        state.bookingSub = 'tickets';
        showSub('buchen', 'tickets');
        updateBookingSummary();
      })
      .catch(function () {
        $('#mount-tickets').innerHTML = '';
        setStatus('Angebot konnte nicht geladen werden.', true);
      });
  }

  function mountTicketSelection() {
    var el = document.createElement('enviso-ticket-selection-step');
    el.setAttribute('offer-id', String(state.offer.id));
    el.setAttribute('offer-type', state.offer.offerType || 'Ticket');
    el.addEventListener('change', function (e) {
      log('ticketselection.change', pick(e.detail, ['requiredTickets', 'guideLanguage']));
      updateBookingSummary();
    });
    var host = $('#mount-tickets');
    host.innerHTML = '';
    host.appendChild(el);
  }

  function selectedProducts() {
    var ts = ticketStep();
    return ((ts && ts.values) || []).filter(function (v) { return v && v.quantity > 0; });
  }

  function updateBookingSummary() {
    var dl = $('#booking-sum');
    if (!dl || !state.offer) return;
    var products = selectedProducts();
    var count = 0;
    var total = 0;
    var currency = 'EUR';
    products.forEach(function (v) {
      count += v.quantity;
      if (v.ticket && typeof v.ticket.price === 'number') total += v.ticket.price * v.quantity;
      if (v.ticket && v.ticket.currency) currency = v.ticket.currency;
    });
    var tm = timeStep();
    var rows = [
      ['Angebot', state.offer.name],
      ['Tickets', count ? String(count) : '–']
    ];
    if (state.needsTime) {
      rows.push(['Datum', tm && tm.selectedDate ? fmtDate(tm.selectedDate) : '–']);
      if (state.offer.capacityFrequency === 'PerSlot') {
        var slot = tm && tm.selectedTimeslot;
        rows.push(['Uhrzeit', slot ? fmtTime(slot.startTime) + ' – ' + fmtTime(slot.endTime) : '–']);
      }
    }
    rows.push(['Preis', count ? money(total, currency) : '–']);
    dl.innerHTML = rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('');
  }

  function ticketsNext() {
    var ts = ticketStep();
    if (!ts) return;
    if (!ts.checkValidity(true, true)) {
      setStatus('Bitte mindestens ein Ticket wählen.', true);
      return;
    }
    setStatus('');
    log('ticketsselected (eigenes Event)', { offerId: state.offer.id, requiredTickets: ts.requiredTickets });
    if (state.needsTime) {
      mountTimeSelection();
      state.bookingSub = 'time';
      showSub('buchen', 'time');
      updateBookingSummary();
    } else {
      addToBasket();
    }
  }

  function mountTimeSelection() {
    var ts = ticketStep();
    var el = document.createElement('enviso-time-selection-step');
    el.setAttribute('offer-id', String(state.offer.id));
    // Must be set before the element becomes visible, otherwise it never loads.
    el.setAttribute('required-tickets', String(ts.requiredTickets || 0));
    if (ts.selectedGuideLanguage) el.setAttribute('guide-language', ts.selectedGuideLanguage);
    el.selectedProducts = ts.values;
    el.addEventListener('change', function (e) {
      var d = e.detail || {};
      log('timeselection.change', { date: d.date || null, timeslotId: d.timeslot ? d.timeslot.id : null });
      updateBookingSummary();
    });
    var host = $('#mount-time');
    host.innerHTML = '';
    host.appendChild(el);
  }

  // Own add-to-basket call: same endpoint the built-in ticket flow uses internally.
  function addToBasket() {
    var ts = ticketStep();
    var tm = state.needsTime ? timeStep() : null;
    if (tm && !tm.checkValidity()) {
      setStatus('Bitte Datum' + (state.offer.capacityFrequency === 'PerSlot' ? ' und Uhrzeit' : '') + ' wählen.', true);
      return;
    }
    var products = selectedProducts();
    if (!products.length) {
      setStatus('Keine Tickets gewählt.', true);
      return;
    }
    var reservations = products.map(function (v) {
      var r = { productId: v.ticket.id, quantity: v.quantity };
      if (tm && tm.selectedDate) r.visitDate = tm.selectedDate;
      if (tm && tm.selectedTimeslot) r.timeslotId = tm.selectedTimeslot.id;
      if (ts.selectedGuideLanguage) r.guideLanguage = ts.selectedGuideLanguage;
      return r;
    });

    var headers = { 'Content-Type': 'application/json; charset=utf-8' };
    var sid = null;
    try { sid = window.localStorage.getItem(WIDGET_SESSION_STORAGE_KEY); } catch (e) { sid = null; }
    if (sid) headers[SESSION_HEADER] = sid;

    var btns = $all('[data-action="add-to-basket"],[data-action="tickets-next"]');
    btns.forEach(function (b) { b.disabled = true; });
    setStatus('Wird in den Warenkorb gelegt …');

    api('reservations?salespointid=' + state.config.salesPointId, {
      method: 'POST',
      headers: headers,
      body: JSON.stringify({ reservations: reservations })
    }).then(function (r) {
      var newSid = r.headers.get(SESSION_HEADER);
      if (newSid) {
        try { window.localStorage.setItem(WIDGET_SESSION_STORAGE_KEY, newSid); } catch (e) { /* ignore */ }
      }
      return r.text().then(function (t) {
        if (!r.ok) {
          var msg = 'Konnte nicht in den Warenkorb legen (' + r.status + ')';
          try {
            var j = JSON.parse(t);
            var e0 = Array.isArray(j.errors) ? j.errors[0] : j;
            if (e0 && e0.message) msg += ': ' + e0.message;
          } catch (e) { /* ignore */ }
          throw new Error(msg);
        }
        return t ? JSON.parse(t) : {};
      });
    }).then(function (res) {
      log('reservationscreated (eigener API-Call)', {
        reservations: (res.reservations || []).length,
        visitDate: reservations[0].visitDate || null,
        timeslotId: reservations[0].timeslotId || null
      });
      var b = basket();
      return b ? b.refresh() : null;
    }).then(function () {
      setStatus('Im Warenkorb! Du kannst weitere Tickets hinzufügen oder zur Kasse gehen.');
      // Reset the booking so the next offer starts fresh, then continue shopping.
      state.offer = null;
      $('#mount-tickets').innerHTML = '';
      $('#mount-time').innerHTML = '';
      if (location.hash === '#tickets') {
        openDrawer();
      } else {
        state.openDrawerAfterRoute = true; // route() would otherwise close it again
        state.keepStatus = true;
        location.hash = '#tickets';
      }
    }).catch(function (err) {
      setStatus(err.message, true);
    }).then(function () {
      btns.forEach(function (b) { b.disabled = false; });
    });
  }

  // ---------- own cart rendering (drawer + sidebars) ----------

  function itemMeta(item) {
    var parts = [];
    var r = item.reservation || {};
    var e1 = typeof item.extraInfo === 'string' ? item.extraInfo : '';
    var e2 = typeof item.extraInfo2 === 'string' ? item.extraInfo2 : '';
    if (e1) parts.push(e1);
    else if (r.visitDate) {
      var vd = new Date(r.visitDate);
      var o = { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' };
      if (state.venueTz) o.timeZone = state.venueTz;
      if (!isNaN(vd.getTime())) parts.push(vd.toLocaleDateString(state.config.locale, o));
    }
    if (e2) parts.push(e2 + ' Uhr');
    else if (r.timeslot) parts.push(fmtTime(r.timeslot.start) + ' – ' + fmtTime(r.timeslot.end) + ' Uhr');
    return parts.join(' · ');
  }

  function renderCarts() {
    var items = basketItems();
    var b = basket();
    var currency = (items[0] && items[0].currency) || 'EUR';
    var total = 0;
    try { total = b ? b.totalPriceWithDiscount : 0; } catch (e) { total = 0; }
    var count = 0;
    items.forEach(function (it) { count += Number(it.quantity) || 0; });

    $all('[data-cart-list]').forEach(function (host) {
      var readonly = host.hasAttribute('data-readonly');
      if (!items.length) {
        host.innerHTML = '<div class="cart-empty">Dein Warenkorb ist leer.</div>';
        return;
      }
      host.innerHTML = items.map(function (it) {
        var r = it.reservation || {};
        var lines = (r.productReservations || []).map(function (pr) {
          var p = pr.product || {};
          var lineTotal = pr.pricing ? pr.pricing.total : (pr.unitPrice || 0) * pr.quantity;
          var qty = readonly
            ? '<span>' + esc(pr.quantity) + ' ×</span>'
            : '<span class="qty"><button type="button" data-act="dec" data-pr="' + esc(pr.id) + '" data-r="' + esc(r.id) +
              '" data-q="' + esc(pr.quantity) + '" data-lines="' + (r.productReservations || []).length + '" aria-label="weniger">−</button>' +
              '<span>' + esc(pr.quantity) + '</span>' +
              '<button type="button" data-act="inc" data-pr="' + esc(pr.id) + '" data-q="' + esc(pr.quantity) +
              '" data-max="' + esc(p.maximumTicketQuantity || 100) + '" aria-label="mehr">+</button></span>';
          return '<div class="ci-line"><span>' + esc(p.localizedName || p.name || 'Ticket') + '</span>' + qty +
            '<strong>' + esc(money(lineTotal, it.currency || currency)) + '</strong></div>';
        }).join('');
        return '<div class="cart-item"><div class="ci-head"><div><div class="ci-title">' +
          esc(it.offerName || (r.offer && r.offer.localizedName) || 'Ticket') + '</div><div class="ci-meta">' +
          esc(itemMeta(it)) + '</div></div>' +
          (readonly ? '' : '<button type="button" class="ci-remove" data-act="remove" data-r="' + esc(r.id) + '">Entfernen</button>') +
          '</div>' + lines + '</div>';
      }).join('');
    });

    $all('[data-cart-total]').forEach(function (el) { el.textContent = money(total, currency); });
    $all('[data-needs-items]').forEach(function (el) { el.classList.toggle('disabled', items.length === 0); });

    var badge = $('#cart-badge');
    badge.textContent = String(count);
    badge.classList.toggle('zero', count === 0);
    if (count !== state.lastCount) {
      badge.classList.add('bump');
      setTimeout(function () { badge.classList.remove('bump'); }, 250);
      state.lastCount = count;
    }
    updateExpiry();
  }

  function updateExpiry() {
    var b = basket();
    var text = '';
    if (b && basketItems().length) {
      var exp = b.expiryDate ? new Date(b.expiryDate) : null;
      if (exp && !isNaN(exp.getTime()) && exp.getFullYear() > 1900) {
        var ms = exp.getTime() - Date.now();
        if (ms > 0) {
          var m = Math.floor(ms / 60000);
          var s = Math.floor((ms % 60000) / 1000);
          text = 'Deine Tickets sind noch ' + m + ':' + (s < 10 ? '0' : '') + s + ' Min. reserviert.';
        }
      }
    }
    $all('[data-expiry]').forEach(function (el) { el.textContent = text; });
    var et = $('#expiry-text');
    if (et) et.textContent = text;
  }

  function cartAction(btn) {
    var b = basket();
    if (!b) return;
    var act = btn.getAttribute('data-act');
    var prId = Number(btn.getAttribute('data-pr'));
    var rId = Number(btn.getAttribute('data-r'));
    var q = Number(btn.getAttribute('data-q'));
    var p;
    if (act === 'inc') {
      var max = Number(btn.getAttribute('data-max')) || 100;
      if (q + 1 > max) return;
      p = b.updateReservation(prId, q + 1);
      log('basket.updateReservation', { quantity: q + 1 });
    } else if (act === 'dec') {
      if (q - 1 <= 0 && Number(btn.getAttribute('data-lines')) <= 1) {
        p = b.removeReservation(rId);
        log('basket.removeReservation', {});
      } else {
        p = b.updateReservation(prId, Math.max(0, q - 1));
        log('basket.updateReservation', { quantity: Math.max(0, q - 1) });
      }
    } else if (act === 'remove') {
      p = b.removeReservation(rId);
      log('basket.removeReservation', {});
    }
    if (!p) return;
    $all('[data-cart-list]').forEach(function (el) { el.classList.add('cart-busy'); });
    Promise.resolve(p).then(function () {
      var err = b.error$ && b.error$.value;
      if (err) setStatus(String(err), true);
    }).catch(function () {
      setStatus('Warenkorb konnte nicht geändert werden.', true);
    }).then(function () {
      $all('[data-cart-list]').forEach(function (el) { el.classList.remove('cart-busy'); });
      renderCarts();
      if (location.hash === '#warenkorb') mountBasketOverview();
    });
  }

  function openDrawer() {
    renderCarts();
    $('#drawer').classList.add('open');
    $('#drawer').setAttribute('aria-hidden', 'false');
    $('#drawer-backdrop').classList.remove('hidden');
  }

  function closeDrawer() {
    $('#drawer').classList.remove('open');
    $('#drawer').setAttribute('aria-hidden', 'true');
    $('#drawer-backdrop').classList.add('hidden');
  }

  // ---------- basket page + checkout ----------

  function mountBasketOverview() {
    var host = $('#mount-basket');
    host.innerHTML = '';
    host.appendChild(document.createElement('enviso-basket-overview'));
  }

  function openCheckout() {
    if (state.paymentMounted) {
      showSub('kasse', state.checkoutSub);
      return;
    }
    if (!basketItems().length) {
      $('#mount-info').innerHTML = '<p class="muted">Dein Warenkorb ist leer. <a href="#tickets">Jetzt Tickets wählen</a></p>';
      state.checkoutSub = 'info';
      showSub('kasse', 'info');
      return;
    }
    var el = document.createElement('enviso-basket-my-info');
    el.addEventListener('change', function () { log('myinfo.change', {}); });
    var host = $('#mount-info');
    host.innerHTML = '';
    host.appendChild(el);
    state.checkoutSub = 'info';
    showSub('kasse', 'info');
  }

  function infoNext() {
    var el = $('#mount-info enviso-basket-my-info');
    if (!el) return;
    if (!el.checkValidity()) {
      setStatus('Bitte alle Pflichtfelder ausfüllen.', true);
      return;
    }
    if (!window.confirm('Jetzt wird in der Testumgebung eine Bestellung angelegt und die Zahlung gestartet. Fortfahren?')) return;
    mountPayment();
  }

  // The payment step creates the order as soon as it becomes visible -> mount only once.
  function mountPayment() {
    if (state.paymentMounted) return;
    state.paymentMounted = true;
    var el = document.createElement('enviso-payment-step');
    el.addEventListener('ordercreated', function (e) {
      state.orderNumber = typeof e.detail === 'string' ? e.detail : null;
      log('ordercreated', { orderNumber: state.orderNumber });
      $('#order-ref').textContent = state.orderNumber ? 'Bestellnummer: ' + state.orderNumber : '';
      setStatus('Bestellung angelegt. Zahlung läuft – Status danach serverseitig prüfen.');
    });
    el.addEventListener('orderfailed', function (e) {
      log('orderfailed', pick(e.detail, ['error']));
      setStatus('Bestellung fehlgeschlagen.', true);
    });
    var host = $('#mount-payment');
    host.innerHTML = '';
    host.appendChild(el);
    state.checkoutSub = 'payment';
    if (location.hash !== '#kasse') location.hash = '#kasse';
    showSub('kasse', 'payment');
  }

  function finish(status, failed, errorText) {
    var el = document.createElement('enviso-ticket-order-complete-step');
    if (state.orderNumber) el.setAttribute('order-id', state.orderNumber);
    if (status) el.setAttribute('status', status);
    if (failed) el.setAttribute('failed', '');
    if (errorText) el.setAttribute('order-failed-error', errorText);
    el.addEventListener('back-to-offer-overview', function () { restart(); });
    var host = $('#mount-done');
    host.innerHTML = '';
    host.appendChild(el);
    state.checkoutSub = 'done';
    showSub('kasse', 'done');
  }

  function wirePaymentEvents() {
    document.addEventListener('paymentverified', function (e) {
      var d = pick(e.detail, ['paymentStatus']);
      log('paymentverified', d);
      finish(d.paymentStatus || '', false);
    });
    document.addEventListener('paymentfailed', function (e) {
      var d = pick(e.detail, ['canRetry', 'resultDescription']);
      log('paymentfailed', d);
      if (d.canRetry === false) finish('', true, d.resultDescription || 'Zahlung fehlgeschlagen');
    });
    document.addEventListener('paymentretry', function (e) { log('paymentretry', pick(e.detail, ['canRetry'])); });
    document.addEventListener('paymentpartiallypaid', function () { log('paymentpartiallypaid', {}); });
  }

  function restart() {
    state.offer = null;
    state.paymentMounted = false;
    state.orderNumber = null;
    state.checkoutSub = 'info';
    ['mount-tickets', 'mount-time', 'mount-basket', 'mount-info', 'mount-payment', 'mount-done']
      .forEach(function (id) { document.getElementById(id).innerHTML = ''; });
    $('#order-ref').textContent = '';
    location.hash = '#tickets';
  }

  // ---------- router ----------

  function route() {
    if (!state.ready) return;
    if (state.openDrawerAfterRoute) {
      state.openDrawerAfterRoute = false;
      window.setTimeout(openDrawer, 0);
    } else {
      closeDrawer();
    }
    if (!state.keepStatus) setStatus('');
    state.keepStatus = false;
    var h = (location.hash || '#start').slice(1);
    var parts = h.split('/');
    var view = parts[0] || 'start';
    if (['start', 'tickets', 'buchen', 'warenkorb', 'kasse'].indexOf(view) < 0) view = 'start';

    $all('.view').forEach(function (v) { v.classList.toggle('active', v.getAttribute('data-view') === view); });
    $all('[data-nav]').forEach(function (a) {
      var n = a.getAttribute('data-nav');
      a.classList.toggle('active', n === view || (n === 'tickets' && view === 'buchen') || (n === 'warenkorb' && view === 'kasse'));
    });

    if (view === 'start') renderOfferCards('featured-offers', 3);
    if (view === 'tickets') renderOfferCards('all-offers');
    if (view === 'buchen') {
      var id = Number(parts[1]);
      if (Number.isFinite(id) && id > 0) openBooking(id);
      else location.hash = '#tickets';
    }
    if (view === 'warenkorb') {
      mountBasketOverview();
      renderProgress('basket');
    }
    if (view === 'kasse') openCheckout();
    renderCarts();
    if (h === 'info') {
      var el = document.getElementById('info');
      if (el) el.scrollIntoView();
    } else {
      window.scrollTo(0, 0);
    }
  }

  // ---------- wiring ----------

  function wireUi() {
    document.addEventListener('click', function (e) {
      var cartBtn = e.target.closest && e.target.closest('[data-act]');
      if (cartBtn) { cartAction(cartBtn); return; }
      var btn = e.target.closest && e.target.closest('[data-action]');
      if (!btn || btn.disabled) return;
      switch (btn.getAttribute('data-action')) {
        case 'tickets-next': ticketsNext(); break;
        case 'time-back': state.bookingSub = 'tickets'; showSub('buchen', 'tickets'); break;
        case 'add-to-basket': addToBasket(); break;
        case 'info-next': infoNext(); break;
        case 'restart': restart(); break;
        case 'close-drawer': closeDrawer(); break;
        default: break;
      }
    });
    $('#cart-btn').addEventListener('click', openDrawer);
    $('#drawer-backdrop').addEventListener('click', closeDrawer);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeDrawer(); });
    $('#dev-toggle').addEventListener('change', function (e) {
      document.body.classList.toggle('dev-on', e.target.checked);
    });
    window.addEventListener('hashchange', route);
  }

  function wireBasket() {
    var b = basket();
    if (!b || typeof b.addEventListener !== 'function') return;
    b.addEventListener('change', function () {
      log('basket.change', { items: basketItems().length });
      renderCarts();
    });
    b.addEventListener('expire', function () {
      log('basket.expire', {});
      setStatus('Die Reservierung ist abgelaufen – der Warenkorb wurde geleert.', true);
      renderCarts();
    });
    state.expiryTimer = window.setInterval(updateExpiry, 1000);
  }

  function start() {
    var config = readConfig();
    state.config = config;
    var aio = $('#aio-link');
    if (aio && window.location.search) aio.href = './index.html' + window.location.search;

    if (!config.apiKey || !Number.isFinite(config.salesPointId) || config.salesPointId <= 0) {
      $all('.view').forEach(function (v) { v.classList.remove('active'); });
      $('#setup').classList.remove('hidden');
      return;
    }

    window.enviso = window.enviso || {};
    window.enviso.settings = window.enviso.settings || {};
    window.enviso.settings.apiKey = config.apiKey;
    window.enviso.settings.salesPointId = config.salesPointId;
    window.enviso.settings.ticketingWidgetApi = config.apiUrl;
    window.enviso.settings.language = config.language;
    window.enviso.settings.locale = config.locale;

    var host = '';
    try { host = new URL(config.apiUrl).host; } catch (e) { host = '?'; }
    $('#dev-config').textContent = 'Salespoint ' + config.salesPointId + ' · API ' + host +
      ' · Key gesetzt · ' + config.language + '/' + config.locale;

    wireUi();
    wirePaymentEvents();
    document.addEventListener('enviso-scripts-loaded', function () { log('enviso-scripts-loaded', {}); });

    apiJson('venue').then(function (v) { state.venueTz = v && v.timeZoneId; }).catch(function () { /* optional */ });

    setStatus('Shop wird geladen …');
    loadScript(LOADER).then(function () {
      if (!window.enviso || typeof window.enviso.load !== 'function') throw new Error('loader');
      window.enviso.load(COMPONENTS);
      return Promise.all(TAGS.map(function (t) { return window.customElements.whenDefined(t); }));
    }).then(function () {
      log('components defined', { count: TAGS.length });
      setStatus('');
      state.ready = true;
      wireBasket();
      var b = basket();
      if (b) b.refresh().then(renderCarts).catch(function () { /* empty basket */ });
      if (isPaymentReturn()) {
        location.hash = '#kasse';
        route();
        mountPayment();
        return;
      }
      route();
    }).catch(function () {
      setStatus('Shop-Komponenten konnten nicht geladen werden.', true);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
