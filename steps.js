(function () {
  'use strict';

  // Custom booking flow built from individual Enviso step components.
  // Config comes only from URL query parameters; nothing is persisted by this script.

  var STAGING_WIDGET_API = 'https://api.staging-enviso.io/ticketwidgetapi/';
  var BASE = 'https://widget.staging-enviso.io';
  var LOADER = BASE + '/loader.js';
  var C = BASE + '/build-ts/components/';

  // Real bundle paths (checked against the staging CDN). Note: the docs list
  // tickets/enviso-ticket-selection-step-element.js, which serves an HTML fallback;
  // the working file lives under common/enviso-tickets/.
  var COMPONENTS = [
    C + 'tickets/enviso-offer-overview-element.js',
    C + 'common/enviso-tickets/enviso-ticket-selection-step-element.js',
    C + 'tickets/enviso-time-selection-step-element.js',
    C + 'basket/enviso-basket-overview-element.js',
    C + 'basket/enviso-basket-my-info-element.js',
    C + 'tickets/enviso-payment-step-element.js',
    C + 'tickets/enviso-ticket-order-complete-step-element.js'
  ];

  var TAGS = [
    'enviso-offer-overview',
    'enviso-ticket-selection-step',
    'enviso-time-selection-step',
    'enviso-basket-overview',
    'enviso-basket-my-info',
    'enviso-payment-step',
    'enviso-ticket-order-complete-step'
  ];

  // Widget-owned basket session (set by the widget itself after reservations).
  // This is NOT an API key; we reuse the widget's own key name so its basket sees our reservations.
  var WIDGET_SESSION_STORAGE_KEY = 'sessionId';
  var SESSION_HEADER = 'x-session-id';

  var STEPS = [
    { id: 'offer', label: 'Angebot' },
    { id: 'tickets', label: 'Tickets' },
    { id: 'time', label: 'Datum & Zeit' },
    { id: 'basket', label: 'Warenkorb' },
    { id: 'info', label: 'Deine Daten' },
    { id: 'payment', label: 'Zahlung' },
    { id: 'done', label: 'Abschluss' }
  ];

  var state = {
    config: null,
    current: null,
    history: [],
    offer: null, // { id, name, capacityFrequency, offerType }
    needsTime: true,
    paymentMounted: false,
    orderNumber: null
  };

  // ---------- helpers ----------

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function setStatus(text, isError) {
    var el = $('#status');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('error', !!isError);
  }

  function readConfig() {
    var p = new URLSearchParams(window.location.search);
    var apiKey = (p.get('apikey') || p.get('apiKey') || '').trim();
    var sp = Number((p.get('salespoint') || p.get('salesPoint') || '').trim());
    var offersRaw = (p.get('offers') || p.get('offerIds') || '').trim();
    var apiUrl = (p.get('apiurl') || p.get('apiUrl') || '').trim() || STAGING_WIDGET_API;
    if (apiUrl.slice(-1) !== '/') apiUrl += '/';
    var offerIds = offersRaw
      ? offersRaw.split(',').map(function (s) { return Number(s.trim()); })
          .filter(function (n) { return Number.isFinite(n) && n > 0; })
      : [];
    return {
      apiKey: apiKey,
      salesPointId: sp,
      offerIds: offerIds,
      language: (p.get('lang') || p.get('language') || 'de').trim(),
      locale: (p.get('locale') || 'de-DE').trim(),
      apiUrl: apiUrl
    };
  }

  function isPaymentReturn() {
    var p = new URLSearchParams(window.location.search);
    return p.has('redirectResult') || p.has('payload');
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

  function basket() {
    return window.enviso && window.enviso.basket ? window.enviso.basket : null;
  }

  function basketCount() {
    var b = basket();
    try {
      return b ? b.getBasketItemsArray().length : 0;
    } catch (e) {
      return 0;
    }
  }

  // ---------- event log (non-personal fields only) ----------

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
    var t = new Date().toLocaleTimeString('de-DE');
    var extra = fields && Object.keys(fields).length ? ' ' + JSON.stringify(fields) : '';
    var span = document.createElement('span');
    span.className = 't';
    span.textContent = t + ' ';
    li.appendChild(span);
    li.appendChild(document.createTextNode(name + extra));
    list.insertBefore(li, list.firstChild);
  }

  // ---------- stepper ----------

  function renderStepper() {
    var ol = $('#stepper');
    ol.innerHTML = '';
    var visibleIndex = 0;
    var currentIdx = STEPS.findIndex(function (s) { return s.id === state.current; });
    STEPS.forEach(function (s, i) {
      var li = document.createElement('li');
      var skipped = s.id === 'time' && !state.needsTime;
      if (!skipped) visibleIndex += 1;
      li.textContent = (skipped ? '–' : 'Schritt ' + visibleIndex) + ': ' + s.label;
      if (skipped) li.classList.add('skipped');
      if (s.id === state.current) li.classList.add('active');
      else if (i < currentIdx && !skipped) li.classList.add('done');
      ol.appendChild(li);
    });
  }

  function show(stepId, opts) {
    if (state.current && !(opts && opts.noHistory)) state.history.push(state.current);
    state.current = stepId;
    document.querySelectorAll('.step').forEach(function (el) {
      el.classList.toggle('active', el.getAttribute('data-step') === stepId);
    });
    renderStepper();
    setStatus('');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function back() {
    // Never navigate back into or out of the payment step (it creates an order when shown).
    if (state.paymentMounted) return;
    var prev = state.history.pop();
    if (prev) show(prev, { noHistory: true });
  }

  function mount(containerId, el) {
    var host = document.getElementById(containerId);
    host.innerHTML = '';
    host.appendChild(el);
    return el;
  }

  // ---------- step 1: offer overview ----------

  function mountOfferOverview() {
    var el = document.createElement('enviso-offer-overview');
    el.setAttribute('offer-type', 'ticket');
    if (state.config.offerIds.length) {
      // Real attribute name is included-offer-ids (docs say include-offer-ids).
      el.setAttribute('included-offer-ids', JSON.stringify(state.config.offerIds));
      el.setAttribute('sort-by-include-offer-ids', '');
    }
    el.addEventListener('offeroverviewloaded', function (e) {
      log('offeroverviewloaded', pick(e.detail, ['offerCount']));
    });
    el.addEventListener('buyticketsclick', function (e) {
      var offer = e.detail && e.detail.offer;
      if (!offer) return;
      log('buyticketsclick', { offerId: offer.id });
      selectOffer(offer.id);
    });
    mount('mount-offer', el);
  }

  function fetchOfferDetail(offerId) {
    var c = state.config;
    var url = c.apiUrl + 'salespoints/' + c.salesPointId + '/offers/' + offerId +
      '?language=' + encodeURIComponent(c.language);
    return fetch(url, { headers: { 'x-api-key': c.apiKey } }).then(function (r) {
      if (!r.ok) throw new Error('Angebot konnte nicht geladen werden (' + r.status + ')');
      return r.json();
    });
  }

  function selectOffer(offerId) {
    setStatus('Angebot wird geladen …');
    fetchOfferDetail(offerId).then(function (d) {
      state.offer = {
        id: d.id,
        name: d.localizedName || d.name,
        offerType: d.offerType,
        capacityFrequency: d.capacityFrequency
      };
      // Same rule as the built-in ticket flow: time step only for Ticket offers that are not "Total".
      state.needsTime = d.offerType === 'Ticket' && d.capacityFrequency !== 'Total';
      log('offerdetail', { offerId: d.id, capacityFrequency: d.capacityFrequency });
      mountTicketSelection();
      show('tickets');
    }).catch(function (err) {
      setStatus(err.message, true);
    });
  }

  // ---------- step 2: ticket selection ----------

  function ticketStep() {
    return $('#mount-tickets enviso-ticket-selection-step');
  }

  function mountTicketSelection() {
    var el = document.createElement('enviso-ticket-selection-step');
    el.setAttribute('offer-id', String(state.offer.id));
    el.setAttribute('offer-type', state.offer.offerType || 'Ticket');
    el.addEventListener('change', function (e) {
      log('ticketselection.change', pick(e.detail, ['requiredTickets', 'guideLanguage']));
    });
    mount('mount-tickets', el);
  }

  function selectedProducts() {
    var ts = ticketStep();
    var values = (ts && ts.values) || [];
    return values.filter(function (v) { return v && v.quantity > 0; });
  }

  function ticketsNext() {
    var ts = ticketStep();
    if (!ts) return;
    // checkValidity(true, true) is what the built-in flow calls (shows validation messages).
    if (!ts.checkValidity(true, true)) {
      setStatus('Bitte mindestens ein Ticket wählen.', true);
      return;
    }
    var products = selectedProducts();
    // The standalone step does not emit "ticketsselected" itself; we log our own equivalent.
    log('ticketsselected (eigenes Event)', {
      offerId: state.offer.id,
      products: products.length,
      requiredTickets: ts.requiredTickets
    });
    if (state.needsTime) {
      mountTimeSelection();
      show('time');
    } else {
      addToBasket();
    }
  }

  // ---------- step 3: date / timeslot ----------

  function timeStep() {
    return $('#mount-time enviso-time-selection-step');
  }

  function mountTimeSelection() {
    var ts = ticketStep();
    var el = document.createElement('enviso-time-selection-step');
    el.setAttribute('offer-id', String(state.offer.id));
    // required-tickets must be set before the element becomes visible, otherwise it never loads.
    el.setAttribute('required-tickets', String(ts.requiredTickets || 0));
    if (ts.selectedGuideLanguage) el.setAttribute('guide-language', ts.selectedGuideLanguage);
    el.selectedProducts = ts.values; // property only (no attribute), used for price display
    el.addEventListener('change', function (e) {
      var d = e.detail || {};
      log('timeselection.change', {
        date: d.date || null,
        timeslotId: d.timeslot ? d.timeslot.id : null
      });
    });
    mount('mount-time', el);
  }

  // ---------- add to basket (own call, same endpoint the ticket flow uses) ----------

  function addToBasket() {
    var ts = ticketStep();
    var tm = state.needsTime ? timeStep() : null;
    if (tm && !tm.checkValidity()) {
      setStatus('Bitte Datum' + (state.offer.capacityFrequency === 'PerSlot' ? ' und Zeitfenster' : '') + ' wählen.', true);
      return;
    }
    var products = selectedProducts();
    if (!products.length) {
      setStatus('Keine Tickets gewählt.', true);
      return;
    }
    var reservations = products.map(function (v) {
      var r = { productId: v.ticket.id, quantity: v.quantity };
      if (tm && tm.selectedDate) r.visitDate = tm.selectedDate; // yyyy-MM-dd
      if (tm && tm.selectedTimeslot) r.timeslotId = tm.selectedTimeslot.id;
      if (ts.selectedGuideLanguage) r.guideLanguage = ts.selectedGuideLanguage;
      return r;
    });

    var c = state.config;
    var headers = { 'x-api-key': c.apiKey, 'Content-Type': 'application/json; charset=utf-8' };
    var sid = null;
    try { sid = window.localStorage.getItem(WIDGET_SESSION_STORAGE_KEY); } catch (e) { sid = null; }
    if (sid) headers[SESSION_HEADER] = sid;

    var btns = document.querySelectorAll('[data-action="add-to-basket"],[data-action="tickets-next"]');
    btns.forEach(function (b) { b.disabled = true; });
    setStatus('Reservierung wird angelegt …');

    fetch(c.apiUrl + 'reservations?salespointid=' + c.salesPointId, {
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
          var msg = 'Reservierung fehlgeschlagen (' + r.status + ')';
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
      mountBasketOverview();
      show('basket');
    }).catch(function (err) {
      setStatus(err.message, true);
    }).then(function () {
      btns.forEach(function (b) { b.disabled = false; });
    });
  }

  // ---------- step 4: basket ----------

  function mountBasketOverview() {
    mount('mount-basket', document.createElement('enviso-basket-overview'));
    updateBasketButton();
  }

  function updateBasketButton() {
    var b = $('[data-action="basket-next"]');
    if (b) b.disabled = basketCount() === 0;
  }

  function basketNext() {
    if (basketCount() === 0) {
      setStatus('Der Warenkorb ist leer.', true);
      return;
    }
    mountMyInfo();
    show('info');
  }

  // ---------- step 5: customer info ----------

  function mountMyInfo() {
    var el = document.createElement('enviso-basket-my-info');
    // Optional: el.setAttribute('terms', '<url>'); not set here (no real terms page in a demo).
    el.addEventListener('change', function () { log('myinfo.change', {}); });
    mount('mount-info', el);
  }

  function infoNext() {
    var el = $('#mount-info enviso-basket-my-info');
    if (!el || !el.checkValidity()) {
      setStatus('Bitte alle Pflichtfelder ausfüllen.', true);
      return;
    }
    var ok = window.confirm(
      'Jetzt wird im Staging eine Bestellung angelegt und die Zahlung gestartet. Fortfahren?'
    );
    if (!ok) return;
    mountPayment();
  }

  // ---------- step 6: payment (creates the order when it becomes visible) ----------

  function mountPayment() {
    if (state.paymentMounted) return;
    state.paymentMounted = true;
    var el = document.createElement('enviso-payment-step');
    el.addEventListener('ordercreated', function (e) {
      state.orderNumber = typeof e.detail === 'string' ? e.detail : null;
      log('ordercreated', { orderNumber: state.orderNumber });
      setStatus('Bestellung angelegt. Zahlung läuft – Status danach serverseitig prüfen.');
    });
    el.addEventListener('orderfailed', function (e) {
      log('orderfailed', pick(e.detail, ['error']));
      setStatus('Bestellung fehlgeschlagen.', true);
    });
    mount('mount-payment', el);
    show('payment');
  }

  function finish(status, failed, errorText) {
    var el = document.createElement('enviso-ticket-order-complete-step');
    if (state.orderNumber) el.setAttribute('order-id', state.orderNumber);
    if (status) el.setAttribute('status', status);
    if (failed) el.setAttribute('failed', '');
    if (errorText) el.setAttribute('order-failed-error', errorText);
    el.addEventListener('back-to-offer-overview', function () { restart(); });
    mount('mount-done', el);
    show('done');
  }

  // Payment events bubble (composed) from the inner payment element.
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
    document.addEventListener('paymentpartiallypaid', function () { log('paymentpartiallypaid', {}); });
    document.addEventListener('paymentretry', function (e) {
      log('paymentretry', pick(e.detail, ['canRetry']));
    });
  }

  // ---------- restart ----------

  function restart() {
    state.history = [];
    state.offer = null;
    state.needsTime = true;
    state.paymentMounted = false;
    state.orderNumber = null;
    ['mount-tickets', 'mount-time', 'mount-basket', 'mount-info', 'mount-payment', 'mount-done']
      .forEach(function (id) { document.getElementById(id).innerHTML = ''; });
    state.current = null;
    show('offer', { noHistory: true });
  }

  // ---------- wiring ----------

  function wireButtons() {
    document.addEventListener('click', function (e) {
      var btn = e.target.closest && e.target.closest('[data-action]');
      if (!btn || btn.disabled) return;
      switch (btn.getAttribute('data-action')) {
        case 'back': back(); break;
        case 'tickets-next': ticketsNext(); break;
        case 'add-to-basket': addToBasket(); break;
        case 'more': show('offer'); break;
        case 'basket-next': basketNext(); break;
        case 'info-next': infoNext(); break;
        case 'restart': restart(); break;
        default: break;
      }
    });
  }

  function wireBasket() {
    var b = basket();
    if (!b || typeof b.addEventListener !== 'function') return;
    b.addEventListener('change', function () {
      log('basket.change', { items: basketCount() });
      updateBasketButton();
    });
    b.addEventListener('expire', function () {
      log('basket.expire', {});
      setStatus('Der Warenkorb ist abgelaufen.', true);
    });
  }

  function start() {
    var config = readConfig();
    state.config = config;
    if (!config.apiKey || !Number.isFinite(config.salesPointId) || config.salesPointId <= 0) {
      $('#setup').classList.remove('hidden');
      setStatus('Pflicht-Parameter fehlen: apikey, salespoint');
      return;
    }

    window.enviso = window.enviso || {};
    window.enviso.settings = window.enviso.settings || {};
    window.enviso.settings.apiKey = config.apiKey;
    window.enviso.settings.salesPointId = config.salesPointId;
    window.enviso.settings.ticketingWidgetApi = config.apiUrl;
    window.enviso.settings.language = config.language;
    window.enviso.settings.locale = config.locale;

    $('#app').classList.remove('hidden');
    wireButtons();
    wirePaymentEvents();
    document.addEventListener('enviso-scripts-loaded', function () { log('enviso-scripts-loaded', {}); });

    loadScript(LOADER).then(function () {
      if (!window.enviso || typeof window.enviso.load !== 'function') throw new Error('loader');
      window.enviso.load(COMPONENTS);
      return Promise.all(TAGS.map(function (t) { return window.customElements.whenDefined(t); }));
    }).then(function () {
      log('components defined', { count: TAGS.length });
      wireBasket();
      if (isPaymentReturn()) {
        // Returning from an external payment page: show the payment step so it can finish.
        state.paymentMounted = false;
        mountPayment();
        return;
      }
      mountOfferOverview();
      show('offer', { noHistory: true });
    }).catch(function () {
      setStatus('Widget-Skripte konnten nicht geladen werden.', true);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
