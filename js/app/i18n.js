/* Texts of the user interface in the language of the user. */
(function (root) {
  'use strict';
  var DL = root.DL;

  var locales = {};     // code -> { key: text }
  DL.locale = 'en';
  DL.strings = {};

  // A locale file calls this with its texts. The English table holds every key.
  DL.registerLocale = function (code, strings) {
    locales[code] = strings;
  };

  // Makes a locale active. Keys that the locale does not have fall back to English.
  DL.setLocale = function (code) {
    DL.locale = locales[code] ? code : 'en';
    DL.strings = locales[DL.locale] || {};
  };

  // Gives the text for a key. {name} in the text is replaced by vars.name.
  DL.t = function (key, vars) {
    var s = DL.strings[key];
    if (s === undefined) s = locales.en && locales.en[key];
    if (s === undefined) s = key;
    if (!vars) return s;
    return s.replace(/\{(\w+)\}/g, function (m, k) { return vars[k] === undefined || vars[k] === null ? m : String(vars[k]); });
  };

  // Puts the texts into the page. data-i18n sets the text, data-i18n-title the title,
  // data-i18n-placeholder the placeholder and data-i18n-label the aria-label.
  DL.applyI18n = function (rootEl) {
    var attrs = { 'data-i18n-title': 'title', 'data-i18n-placeholder': 'placeholder', 'data-i18n-label': 'aria-label' };
    Array.prototype.forEach.call(rootEl.querySelectorAll('[data-i18n]'), function (el) {
      el.textContent = DL.t(el.getAttribute('data-i18n'));
    });
    Object.keys(attrs).forEach(function (a) {
      Array.prototype.forEach.call(rootEl.querySelectorAll('[' + a + ']'), function (el) {
        el.setAttribute(attrs[a], DL.t(el.getAttribute(a)));
      });
    });
  };

  // The language of the page: ?lang=xx, else the language of the browser.
  DL.detectLocale = function () {
    var m = /[?&]lang=([a-zA-Z-]+)/.exec(root.location ? root.location.search : '');
    var lang = m ? m[1] : (root.navigator && (root.navigator.language || '')) || 'en';
    return lang.toLowerCase().split('-')[0];
  };
})(typeof self !== 'undefined' ? self : this);
