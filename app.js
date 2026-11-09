(function () {
  'use strict';

  var STAGING_WIDGET_API = 'https://api.staging-enviso.io/ticketwidgetapi/';
  var LOADER = 'https://widget.staging-enviso.io/loader.js';
  var ELEMENT =
    'https://widget.staging-enviso.io/build-ts/components/tickets/enviso-ticket-widget-element.js';

  function qs() {
    return new URLSearchParams(window.location.search);
  }

  function readConfig(params) {
    var apiKey = (params.get('apikey') || params.get('apiKey') || '').trim();
    var salesPointRaw = (params.get('salespoint') || params.get('salesPoint') || '').trim();
    var salesPointId = salesPointRaw ? Number(salesPointRaw) : NaN;
    var offersRaw = (params.get('offers') || params.get('offerIds') || '').trim();
    var offerRaw = (params.get('offer') || params.get('offerId') || '').trim();
    var language = (params.get('lang') || params.get('language') || '').trim();
    var locale = (params.get('locale') || '').trim();
    var tenant = (params.get('tenant') || params.get('tenantKey') || '').trim();
    var apiUrl = (params.get('apiurl') || params.get('apiUrl') || '').trim();

    var offerIds = [];
    if (offersRaw) {
      offerIds = offersRaw
        .split(',')
        .map(function (part) {
          return Number(String(part).trim());
        })
        .filter(function (n) {
          return Number.isFinite(n) && n > 0;
        });
    }

    var offerId = offerRaw ? Number(offerRaw) : NaN;

    return {
      apiKey: apiKey,
      salesPointId: salesPointId,
      offerIds: offerIds,
      offerId: offerId,
      language: language,
      locale: locale,
      tenantProvided: Boolean(tenant),
      apiUrl: apiUrl
    };
  }

  function showSetup() {
    document.getElementById('setup').classList.remove('hidden');
    document.getElementById('widget-root').classList.add('hidden');
  }

  function setStatus(text) {
    var el = document.getElementById('status');
    if (el) el.textContent = text;
  }

  function loadScript(src) {
    return new Promise(function (resolve, reject) {
      var s = document.createElement('script');
      s.src = src;
      s.async = true;
      s.onload = function () {
        resolve();
      };
      s.onerror = function () {
        reject(new Error('Failed to load widget loader'));
      };
      document.head.appendChild(s);
    });
  }

  function mountWidget(config) {
    window.enviso = window.enviso || {};
    window.enviso.settings = window.enviso.settings || {};

    // Official Getting Started settings: apiKey + salesPointId (required).
    // language / locale optional. tenantKey is NOT a documented widget setting.
    window.enviso.settings.apiKey = config.apiKey;
    window.enviso.settings.salesPointId = config.salesPointId;
    window.enviso.settings.ticketingWidgetApi = config.apiUrl || STAGING_WIDGET_API;

    if (config.language) {
      window.enviso.settings.language = config.language;
    }
    if (config.locale) {
      window.enviso.settings.locale = config.locale;
    }

    var host = document.getElementById('widget-root');
    host.innerHTML = '';

    var el = document.createElement('enviso-ticket-widget');
    el.setAttribute('offer-type', 'ticket');
    el.setAttribute('show-prices', '');
    el.setAttribute('disable-auto-visit-time-selection', '');

    if (Number.isFinite(config.offerId) && config.offerId > 0) {
      el.setAttribute('offer-id', String(config.offerId));
    } else if (config.offerIds.length === 1) {
      el.setAttribute('offer-id', String(config.offerIds[0]));
    } else if (config.offerIds.length > 1) {
      el.setAttribute('included-offer-ids', JSON.stringify(config.offerIds));
    }

    // Intentionally no event payload logging (no order ids, payment refs, emails).
    el.addEventListener('connected', function () {
      setStatus('Widget connected.');
    });
    el.addEventListener('ordercreated', function () {
      setStatus('Order created. Payment verification still required.');
    });
    el.addEventListener('paymentverified', function () {
      setStatus('Payment event received. Confirm status server-side.');
    });
    el.addEventListener('paymentfailed', function () {
      setStatus('Payment failed event received.');
    });

    host.appendChild(el);
    document.getElementById('setup').classList.add('hidden');
    host.classList.remove('hidden');

    return loadScript(LOADER).then(function () {
      if (!window.enviso || typeof window.enviso.load !== 'function') {
        throw new Error('Widget loader unavailable');
      }
      window.enviso.load([ELEMENT]);
      setStatus('Widget scripts requested.');
    });
  }

  function start() {
    var config = readConfig(qs());
    var missing = [];
    if (!config.apiKey) missing.push('apikey');
    if (!Number.isFinite(config.salesPointId) || config.salesPointId <= 0) {
      missing.push('salespoint');
    }

    if (missing.length) {
      showSetup();
      setStatus('Missing required URL parameters: ' + missing.join(', '));
      return;
    }

    // config.tenantProvided is accepted for URL compatibility but unused:
    // Getting Started does not document a tenant setting for the ticketing widget.
    mountWidget(config).catch(function () {
      showSetup();
      setStatus('Could not load the staging widget scripts.');
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
