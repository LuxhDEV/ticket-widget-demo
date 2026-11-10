(function () {
  'use strict';

  // Widget-only demo shop. Everything shop-related (offers, ticket selection, date/time slot,
  // add to basket, basket, customer form, payment, confirmation, login / visitor profile)
  // is done by official Enviso web components. This script only:
  //   1. reads the URL parameters into window.enviso.settings and loads the components,
  //   2. shows/hides page sections (hash navigation),
  //   3. sets attributes on widget elements from documented widget events.
  // No API calls, no storage writes.

  var BASE = 'https://widget.staging-enviso.io';
  var C = BASE + '/build-ts/components/';
  var COMPONENTS = [
    C + 'tickets/enviso-offer-overview-element.js',
    C + 'tickets/enviso-ticket-flow-element.js',
    C + 'basket/enviso-basket-flow-element.js',
    C + 'basket/enviso-basket-button-element.js',
    // The docs list basket/enviso-basket-expiry-countdown.js; the CDN serves the bundle under this name:
    C + 'basket/enviso-basket-expiry-countdown-element.js',
    C + 'tickets/enviso-ticket-order-complete-step-element.js',
    // Official profile button (login, sign-up, my orders / details / relations / sign-out).
    // Docs path is auth/enviso-profile-element.js (staging + production).
    C + 'auth/enviso-profile-element.js'
  ];

  var params = new URLSearchParams(window.location.search);
  function p(a, b) { return (params.get(a) || (b ? params.get(b) : '') || '').trim(); }

  var apiKey = p('apikey', 'apiKey');
  var salesPointId = Number(p('salespoint', 'salesPoint'));
  var apiUrl = p('apiurl', 'apiUrl') || 'https://api.staging-enviso.io/ticketwidgetapi/';
  if (apiUrl.slice(-1) !== '/') apiUrl += '/';
  var offerIds = p('offers', 'offerIds').split(',').map(Number).filter(function (n) { return n > 0; });

  var lastOrderId = '';

  function $(s) { return document.querySelector(s); }

  function log(name, info) {
    var li = document.createElement('li');
    li.textContent = new Date().toLocaleTimeString('de-DE') + '  ' + name + (info ? '  ' + JSON.stringify(info) : '');
    $('#eventlog').prepend(li);
    $('#dev-count').textContent = String($('#eventlog').children.length);
  }

  // ---- 2. show/hide sections ----
  function show(view) {
    document.querySelectorAll('.view').forEach(function (v) {
      v.classList.toggle('active', v.getAttribute('data-view') === view);
    });
    document.querySelectorAll('[data-nav]').forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('data-nav') === view);
    });
    window.scrollTo(0, 0);
  }

  function route() {
    var view = (location.hash || '#start').slice(1);
    if (view === 'buchen' && !$('#mount-flow enviso-ticket-flow')) view = 'tickets';
    if (view === 'fertig' && !$('#mount-done enviso-ticket-order-complete-step')) view = 'warenkorb';
    if (!document.querySelector('.view[data-view="' + view + '"]')) view = 'start';
    show(view);
  }

  // ---- 3. attributes from documented events ----
  function mountOfferOverview() {
    var el = document.createElement('enviso-offer-overview');
    el.setAttribute('offer-type', 'ticket');
    if (offerIds.length) {
      el.setAttribute('included-offer-ids', JSON.stringify(offerIds));
      el.setAttribute('sort-by-include-offer-ids', '');
    }
    // documented: buyticketsclick { offer, selectedDates }
    el.addEventListener('buyticketsclick', function (e) {
      var offer = e.detail && e.detail.offer;
      if (!offer) return;
      log('buyticketsclick', { offerId: offer.id });
      var flow = document.createElement('enviso-ticket-flow');
      flow.setAttribute('offer-id', String(offer.id));
      flow.setAttribute('offer-type', 'ticket');
      flow.setAttribute('show-offer-specs', '');
      flow.setAttribute('indicate-last-tickets', '');
      $('#mount-flow').replaceChildren(flow);
      location.hash = '#buchen';
    });
    el.addEventListener('offeroverviewloaded', function (e) {
      log('offeroverviewloaded', { offerCount: e.detail && e.detail.offerCount });
    });
    $('#mount-offers').replaceChildren(el);
  }

  function showComplete(attrs) {
    var done = document.createElement('enviso-ticket-order-complete-step');
    Object.keys(attrs).forEach(function (k) {
      if (attrs[k] === true) done.setAttribute(k, '');
      else if (attrs[k]) done.setAttribute(k, String(attrs[k]));
    });
    done.addEventListener('back-to-offer-overview', function () { location.hash = '#tickets'; });
    $('#mount-done').replaceChildren(done);
    location.hash = '#fertig';
  }

  function wireCheckoutEvents() {
    var bf = $('#basket-flow');
    // documented on the payment step / basket flow; they bubble out of enviso-basket-flow
    bf.addEventListener('ordercreated', function (e) {
      lastOrderId = String(e.detail || '');
      log('ordercreated', { orderId: lastOrderId });
    });
    bf.addEventListener('paymentverified', function (e) {
      var d = e.detail || {};
      log('paymentverified', { orderId: d.orderNumber, status: d.paymentStatus });
      showComplete({ 'order-id': d.orderNumber || lastOrderId, status: d.paymentStatus, email: d.email });
    });
    bf.addEventListener('paymentfailed', function () {
      log('paymentfailed');
      showComplete({ 'order-id': lastOrderId, failed: true });
    });
    bf.addEventListener('orderfailed', function () {
      log('orderfailed');
      showComplete({ failed: true });
    });
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.onload = resolve;
      s.onerror = reject;
      document.head.appendChild(s);
    });
  }

  function start() {
    if (window.location.search) {
      document.querySelectorAll('a[data-carry]').forEach(function (a) {
        a.href = a.getAttribute('href').split('?')[0] + window.location.search;
      });
    }
    $('#dev-toggle').addEventListener('change', function (e) {
      document.body.classList.toggle('dev-on', e.target.checked);
    });

    if (!apiKey || !(salesPointId > 0)) {
      document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
      $('#setup').classList.remove('hidden');
      return;
    }

    // ---- 1. settings + components ----
    window.enviso = window.enviso || {};
    window.enviso.settings = Object.assign(window.enviso.settings || {}, {
      apiKey: apiKey,
      salesPointId: salesPointId,
      ticketingWidgetApi: apiUrl,
      language: p('lang', 'language') || 'de',
      locale: p('locale') || 'de-DE'
    });

    wireCheckoutEvents();
    window.addEventListener('hashchange', route);

    loadScript(BASE + '/loader.js').then(function () {
      window.enviso.load(COMPONENTS);
      mountOfferOverview();
      // returning from a payment redirect: enviso-basket-flow handles the result itself
      if (params.has('redirectResult') || params.has('payload')) location.hash = '#warenkorb';
      route();
    }).catch(function () {
      $('#status').textContent = 'Widget-Komponenten konnten nicht geladen werden.';
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
