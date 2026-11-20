(function () {
  'use strict';

  // Staging only. API key and sales point come exclusively from URL parameters (never stored).
  var WIDGET_BASE = 'https://widget.staging-enviso.io';
  var STAGING_WIDGET_API = 'https://api.staging-enviso.io/ticketwidgetapi/';
  var COMPONENTS = [
    WIDGET_BASE + '/build-ts/components/tickets/enviso-ticket-widget-element.js',
    WIDGET_BASE + '/build-ts/components/tickets/enviso-ticket-flow-element.js',
    WIDGET_BASE + '/build-ts/components/common/enviso-tickets/enviso-ticket-item-element.js',
    WIDGET_BASE + '/build-ts/components/common/enviso-checkbox-element.js',
    WIDGET_BASE + '/build-ts/components/common/enviso-style-element.js'
  ];
  // Nur als Hinweis; welche Zahlarten wirklich erscheinen, bestimmt Enviso/Adyen je Land (Staging: Karten + WeChat Pay)
  var PAYMENT_METHODS = ['Visa', 'Mastercard', 'weitere je nach Land'];

  var params = new URLSearchParams(window.location.search);
  function param() {
    for (var i = 0; i < arguments.length; i++) {
      var v = params.get(arguments[i]);
      if (v && v.trim()) return v.trim();
    }
    return '';
  }
  function setStatus(text) {
    var el = document.getElementById('status');
    if (el) el.textContent = text;
  }
  function isHttpUrl(v) {
    return /^https?:\/\//i.test(v);
  }

  var apiKey = param('apikey', 'apiKey');
  var salesPointId = Number(param('salespoint', 'salesPoint'));
  var offerIds = param('offers', 'offerIds').split(',').map(function (p) { return Number(p.trim()); })
    .filter(function (n) { return Number.isFinite(n) && n > 0; });
  var lang = param('lang', 'language');
  if (lang) document.documentElement.setAttribute('lang', lang);

  var home = document.getElementById('home-link');
  if (home && window.location.search) home.href = './index.html' + window.location.search;

  if (!apiKey || !Number.isFinite(salesPointId) || salesPointId <= 0) {
    document.getElementById('setup').classList.remove('hidden');
    document.querySelector('.enviso-loading-message').classList.add('hidden');
    setStatus('Fehlende URL-Parameter: apikey und/oder salespoint.');
    return;
  }

  // 1) Settings-Block (vor dem Laden der Komponenten)
  window.enviso = window.enviso || {};
  var s = (window.enviso.settings = window.enviso.settings || {});
  s.apiKey = apiKey;
  s.salesPointId = salesPointId;
  s.ticketingWidgetApi = STAGING_WIDGET_API;
  s.testPayment = true; // Staging: Test-Zahlung, passend zum Staging-Test-Client-Key aus env.js
  s.language = document.documentElement.getAttribute('lang') || 'de';
  // Locale für Datums-/Uhrzeitformat (sonst 12-h-Format); per ?locale= überschreibbar
  var LOCALES = { de: 'de-DE', nl: 'nl-BE', fr: 'fr-BE', en: 'en-GB' };
  s.locale = param('locale') || LOCALES[s.language] || s.language;
  // Optional: nur setzen, wenn per URL übergeben (sonst gelten die Staging-Defaults aus env.js)
  var adyenClientKey = param('adyenClientKey');
  if (adyenClientKey) s.adyenClientKey = adyenClientKey;
  var fusionAuthClientId = param('fusionAuthClientId');
  if (fusionAuthClientId) s.fusionAuthClientId = fusionAuthClientId;
  var fusionAuthClientRedirectUri = param('fusionAuthClientRedirectUri');
  if (fusionAuthClientRedirectUri && isHttpUrl(fusionAuthClientRedirectUri)) {
    s.fusionAuthClientRedirectUri = fusionAuthClientRedirectUri;
  }

  // 2) Platzhalter durch das Komplett-Widget ersetzen (DOM statt HTML-String, damit URL-Werte nicht als HTML landen)
  var widget = document.createElement('enviso-ticket-widget');
  widget.id = 'shop';
  widget.setAttribute('preferred-dates', '[]');
  widget.setAttribute('show-prices', '');
  widget.setAttribute('show-prices-type', 'highestUnit');
  if (offerIds.length) {
    widget.setAttribute('included-offer-ids', JSON.stringify(offerIds));
    widget.setAttribute('sort-by-include-offer-ids', '');
  }
  var terms = param('terms');
  if (terms && isHttpUrl(terms)) widget.setAttribute('terms', terms);
  var privacy = param('privacy');
  if (privacy && isHttpUrl(privacy)) widget.setAttribute('privacy', privacy);
  widget.setAttribute('newsletter', 'true');
  widget.style.textAlign = 'left';

  var overview = document.createElement('enviso-offer-overview');
  overview.setAttribute('image-click-action', 'tickets');
  overview.style.display = 'none';
  widget.appendChild(overview);

  var timeSelection = document.createElement('enviso-time-selection');
  timeSelection.setAttribute('auto-select-visit-time', 'true');
  timeSelection.style.display = 'none';
  widget.appendChild(timeSelection);

  var belowBasket = document.createElement('div');
  belowBasket.setAttribute('slot', 'below-basket-items');
  belowBasket.style.display = 'none';
  widget.appendChild(belowBasket);

  // Zahlarten-Hinweis als reiner Text (keine fremden Logos)
  var below = document.createElement('div');
  below.setAttribute('slot', 'below-ticket-widget');
  var pm = document.createElement('div');
  pm.className = 'payment-methods';
  var h = document.createElement('h3');
  h.textContent = 'Sicher bezahlen mit';
  pm.appendChild(h);
  var logos = document.createElement('div');
  logos.className = 'payment-methods__logos';
  PAYMENT_METHODS.forEach(function (name) {
    var b = document.createElement('div');
    b.className = 'payment-methods__logo';
    b.textContent = name;
    logos.appendChild(b);
  });
  pm.appendChild(logos);
  below.appendChild(pm);
  widget.appendChild(below);

  // Nur dokumentierte Events, ohne Payload-Logging
  widget.addEventListener('ordercreated', function () { setStatus('Bestellung angelegt – Zahlung ausstehend.'); });
  widget.addEventListener('paymentverified', function () { setStatus('Zahlungs-Event erhalten.'); });
  widget.addEventListener('paymentfailed', function () { setStatus('Zahlung fehlgeschlagen.'); });

  document.querySelector('.enviso-placeholder').replaceWith(widget);

  // 3) Loader + Komponenten (define = enviso.load, wie im Loader vorgesehen)
  var loader = document.createElement('script');
  loader.src = WIDGET_BASE + '/loader.js';
  loader.onload = function () {
    var load = window.enviso && window.enviso.load;
    if (typeof load !== 'function') { setStatus('Widget-Loader nicht verfügbar.'); return; }
    COMPONENTS.forEach(function (url) { load([url]); });
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      if (window.enviso.apis && window.enviso.apis.ticketingWidget) {
        clearInterval(t);
        document.querySelector('.enviso-loading-message').classList.add('hidden');
        document.dispatchEvent(new Event('enviso-loaded'));
        setStatus('Widget geladen.');
      } else if (tries > 150) {
        clearInterval(t);
        setStatus('Widget lädt nicht (Timeout).');
      }
    }, 100);
  };
  loader.onerror = function () { setStatus('Widget-Skripte konnten nicht geladen werden.'); };
  document.head.appendChild(loader);
})();
