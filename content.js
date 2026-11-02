// content.js - LinkRadar beta 0.2.1
// Работает только по клику на иконку.
// Без innerHTML, UI в Shadow DOM (closed), блокировка на внутренних доменах.
// Все ответы на onMessage — синхронные (return false).
// Защита от параллельного рендера через renderToken.
// MutationObserver фильтрует собственные мутации (isOurMutation).
// Кэш хеша + isPanelOpen вместо style.maxHeight.
// TIMINGS для всех задержек. Feedback через <a>+click.
// TreeWalker для обхода DOM. Сохранение inline-стилей при подсветке.
// chrome.runtime?.id перед sendMessage. Копирование с фолбэком и ✗.
// Панель создаётся сразу открытой. Observer стартует/стопает по isPanelOpen.
// ВАЖНО (ИБ): расширение только ЗАПИСЫВАЕТ в буфер по клику.
// FIX: isJunkLink пропускает WhatsApp-ссылки с ?phone=...
// FIX: mutationsCouldAddData реагирует на появление соцсетевых ссылок (SPA).

(function () {
  'use strict';

  if (window.__linkRadarInitialized) return;
  window.__linkRadarInitialized = true;

  const SOCIAL_ICONS = {
    vk: '🎧', ok: '👥', instagram: '📸', telegram: '✈️',
    youtube: '📺', rutube: '🎬', max: '🎬', tiktok: '🎵',
    twitter: '🐦', facebook: '📘', whatsapp: '💬', pinterest: '📌',
    linkedin: '🔗', viber: '📞', skype: '☎️', dzen: '📰'
  };

  const SOCIAL_COLORS = {
    vk: '#4680ff', ok: '#f58220', instagram: '#d62976',
    telegram: '#26A5E4', youtube: '#FF0000', rutube: '#0088cc',
    max: '#ff6b35', tiktok: '#010101', twitter: '#1DA1F2',
    facebook: '#1877F2', whatsapp: '#25D366', pinterest: '#E60023',
    linkedin: '#0A66C2', viber: '#7360F2', skype: '#00AFF0',
    dzen: '#000000'
  };

  const SOCIAL_DOMAINS = {
    vk: ['vk.com', 'vk.ru', 'vkontakte.ru', 'vk.cc', 'vk.me'],
    ok: ['ok.ru', 'odnoklassniki.ru'],
    instagram: ['instagram.com', 'instagr.am', 'ig.me'],
    telegram: ['t.me', 'telegram.me', 'tg.me', 'telegram.org'],
    youtube: ['youtube.com', 'youtu.be'],
    rutube: ['rutube.ru'], max: ['max.ru', 'iimax.ru'], tiktok: ['tiktok.com'],
    twitter: ['twitter.com', 'x.com'],
    facebook: ['facebook.com', 'fb.com', 'fb.me'],
    whatsapp: ['wa.me', 'whatsapp.com'], pinterest: ['pinterest.com'],
    linkedin: ['linkedin.com'], viber: ['viber.com'], skype: ['skype.com'],
    dzen: ['dzen.ru', 'zen.yandex.ru', 'zen.ru', 'dzen.yandex.ru']
  };

  const SOCIAL_CANONICAL_HOST = {
    vk: 'vk.com', ok: 'ok.ru', telegram: 't.me', instagram: 'instagram.com',
    twitter: 'x.com', facebook: 'facebook.com', dzen: 'dzen.ru'
  };

  const BOOKING_ICONS = { dikidi: '🗓️', yclients: '🗓️', mst: '🗓️' };
  const BOOKING_COLORS = { dikidi: '#7c3aed', yclients: '#ff6b35', mst: '#0ea5e9' };
  const BOOKING_NAMES = { dikidi: 'DIKIDI', yclients: 'YCLIENTS', mst: 'MST.LINK' };

  const BOOKING_DOMAINS = {
    dikidi: ['dikidi.net', 'dikidi.ru', 'dikidi.kz', 'dikidi.by', 'dikidi.com', 'dikidi.ua', 'dikidi.me'],
    yclients: ['yclients.com', 'yclients.ru', 'yclients.by', 'yclients.kz', 'yclients.ua', 'yclients.am'],
    mst: ['mst.link', 'mst.cx']
  };

  const SITE_BLOCK_SELECTORS = [
    '[data-testid="group-info-site"]',
    '[data-testid="profile-info-site"]',
    '[data-testid="community-info-site"]',
    '.group-info_row.__site',
    '.profile-info_row.__site',
    '.group-info__site',
    '.profile-info__site',
    '.portal__site',
    '.user-info__site',
    '.group-info-site',
    '[data-testid$="-site"]'
  ];

  const SERVICE_DOMAINS = new Set(['knd.gov.ru', 'gosuslugi.ru', 'roscomnadzor.gov.ru', 'rkn.gov.ru']);
  const REDIRECT_HOST_PATTERN = /(^|\.)(vk\.com|vk\.ru|ok\.ru|odnoklassniki\.ru|mail\.ru)$/i;
  const SITE_LABEL_REGEX = /^\s*(сайт|website|site)\s*:\s*/i;

  const LOCAL_PHONE_LABEL_REGEX = /(?<![\p{L}\d])(?:тел\.?|телефон\p{L}{0,4}|phone|tel\.?|telephone|call|звоните|позвоните|📞|☎\uFE0F?)(?![\p{L}])/iu;
  const LOCAL_PHONE_GROUPS_REGEX = /(?<!\d)((?:\d{1,4}[\s.\u00A0\-\u2010\u2011\u2012\u2013\u2014\u2212]+){1,3}\d{1,4})(?![\d\p{L}])/g;
  const LOCAL_PHONE_CLASS_REGEX = /^(tel|phone|mobile)([-_]|$)/i;

  const TIME_PATTERN = /^\d{1,2}[:.]\d{2}(?:\s*[\-\u2010\u2011\u2012\u2013\u2014\u2212]\s*\d{1,2}[:.]\d{2})?$/;

  const ALLOWED_EMAIL_DOMAINS = new Set([
    'mail.ru', 'bk.ru', 'list.ru', 'inbox.ru', 'internet.ru',
    'rambler.ru', 'ya.ru', 'yandex.ru', 'yandex.by', 'yandex.kz',
    'yandex.ua', 'yandex.com', 'mail.ua', 'ukr.net', 'i.ua',
    'meta.ua', 'bigmir.net', 'tut.by', 'open.by', 'mail.by',
    'gmail.com', 'outlook.com', 'hotmail.com', 'live.com',
    'icloud.com', 'me.com', 'proton.me', 'protonmail.com',
    'yahoo.com', 'aol.com', 'gmx.com', 'gmx.net',
    'tutanota.com', 'tuta.com', 'mail.com', 'zoho.com',
    'fastmail.com', 'hey.com', 'posteo.de', 'mailbox.org'
  ]);

  const KNOWN_TLDS = new Set([
    'ru', 'com', 'net', 'org', 'info', 'biz', 'pro', 'io', 'su',
    'by', 'kz', 'ua', 'uz', 'md', 'am', 'ge', 'az', 'kg', 'tj', 'tm',
    'co', 'me', 'tv', 'cc', 'ws', 'site', 'online', 'store', 'shop',
    'xn--p1ai', 'xn--80asehdb', 'xn--80aswg', 'xn--80adxhks',
    'xn--p1acf', 'xn--c1avg'
  ]);

  const VALID_CITY_CODES = new Set([
    '877', '388', '347', '301', '872', '856', '873', '866', '847', '878',
    '814', '821', '365', '857', '836', '834', '411', '867', '843', '855',
    '394', '341', '390', '871', '835',
    '385', '302', '415', '861', '862', '391', '342', '423', '865', '879', '421',
    '416', '818', '851', '472', '483', '492', '844', '817', '820', '473',
    '810', '493', '395', '401', '484', '384', '833', '494', '352', '471',
    '813', '474', '413', '495', '496', '498', '815', '831', '816', '383',
    '381', '353', '486', '841', '811', '863', '491', '846', '848', '845',
    '424', '343', '481', '475', '482', '382', '487', '345', '842', '860',
    '351', '485', '499', '812', '869', '426', '346', '427', '349'
  ]);

  const INVALID_9XX = new Set(['970', '971']);
  const OAUTH_HOST_PREFIXES = ['oauth.', 'login.', 'signin.', 'auth.', 'sso.'];

  const COMMON_JUNK = [
    '/share', '/widget', '/like/', '/follow/',
    '/oauth/', '/login/', '/signup/', '/embed/',
    '/authorize', '/signin', '/oauth2', '/sso/',
    '/dev/', '/api/', '/stats/', '/analytics/',
    '/promo/', '/ads/', '/app/',
    '/support/', '/help/', '/about/', '/team/', '/jobs/', '/careers/', '/press/',
    '/blog/', '/news/', '/feed/', '/search/', '/explore/', '/trending/',
    '/settings/', '/privacy/', '/terms/'
  ];

  const JUNK_PATTERNS = {
    rutube: [...COMMON_JUNK, '/shorts/', '/video/', '/playlist/', '/catalog/', '/podcasts/'],
    youtube: [...COMMON_JUNK, '/shorts/', '/watch', '/playlist', '/results', '/music', '/gaming', '/sports'],
    vk: [...COMMON_JUNK, '/sticker/', '/stickers/', '/wall', '/video', '/audio', '/photo', '/album', '/clips', '/images'],
    ok: [...COMMON_JUNK, '/video', '/photo', '/album', '/games', 'connect.', 'WidgetShare'],
    instagram: [...COMMON_JUNK, '/p/', '/reel/', '/stories/', '/tv/', '/guide/', '/discover'],
    tiktok: [...COMMON_JUNK, '/video/', '/tag/', '/music/', '/discover'],
    twitter: [...COMMON_JUNK, '/hashtag', '/i/', '/trends', '/home', '/notifications', '/messages'],
    facebook: [...COMMON_JUNK, '/posts/', '/photos/', '/videos/', '/watch', '/groups', '/marketplace', '/events', '/pages'],
    telegram: [...COMMON_JUNK, '/s/', '/k/', '/joinchat', '/addstickers', '/bot'],
    pinterest: [...COMMON_JUNK, '/pin/', '/ideas/', '/shop/', '/inbox'],
    linkedin: [...COMMON_JUNK, '/jobs', '/groups', '/company', '/school', '/learning'],
    whatsapp: [...COMMON_JUNK, '/download/', '/features/', '/security/', '/faq/'],
    viber: [...COMMON_JUNK, '/download/', '/features/'],
    skype: [...COMMON_JUNK, '/download/', '/features/'],
    max: [...COMMON_JUNK, '/watch', '/tv', '/movies', '/series/', '/sports', ':share'],
    dzen: [...COMMON_JUNK, '/profile', '/settings', '/publisher', '/search',
           '/tag/', '/topic/', '/notifications', '/bookmarks', '/feed',
           '/video/', '/shorts/']
  };

  const VK_OBJECT_PATH_REGEX = /^\/(?:wall|photo|video|clip|album)-?\d+_\d+/;
  const OK_OBJECT_PATH_REGEX = /^\/(?:video|photo)\/\d+/;

  const URL_PARAMS_TO_REMOVE = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'utm_id', 'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic',
    'fbclid', 'gclid', 'yclid', 'dclid', 'msclkid'
  ];

  const PHONE_REGEX_STRICT = /(?<!\d)(?:\+7|\+?8|7)[\s\-\u2010\u2011\u2012\u2013\u2014\u2212]*\(?\d{3}\)?[\s\-\u2010\u2011\u2012\u2013\u2014\u2212]*\d{3}[\s\-\u2010\u2011\u2012\u2013\u2014\u2212]?\d{2}[\s\-\u2010\u2011\u2012\u2013\u2014\u2212]?\d{2}(?!\d)/g;
  const PHONE_REGEX_CITY4 = /(?<!\d)(?:\+7|\+?8|7)[\s\-\u2010\u2011\u2012\u2013\u2014\u2212]*\(\d{4}\)[\s\-\u2010\u2011\u2012\u2013\u2014\u2212]*\d{3}[\s\-\u2010\u2011\u2012\u2013\u2014\u2212]?\d{3}(?!\d)/g;
  const PHONE_REGEX_LOOSE = /(?:\+?\d[\d\-()\u2010\u2011\u2012\u2013\u2014\u2212]{8,18}\d)/g;

  const EMAIL_REGEX = /[\p{L}0-9._%+\-]+@[\p{L}\p{N}.\-]+\.[\p{L}]{2,}/gu;
  const INN_LABEL_REGEX = /ИНН\s*[:.]?\s*(\d{12}|\d{10})\b/gi;
  const OGRN_LABEL_REGEX = /ОГРН\s*[:.]?\s*(\d{13})\b/gi;
  const OGRNIP_LABEL_REGEX = /ОГРНИП\s*[:.]?\s*(\d{15})\b/gi;

  const TEXT_FILTER_REGEX = /[0-9@]|ИНН|ОГРН/i;
  const TEXT_URL_REGEX = /(https?:\/\/[^\s]+|(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s]*)?)/gi;

  const PANEL_CONFIG = {
    badgeSize: '48px',
    badgeColor: 'linear-gradient(135deg, #00a550, #008844)',
    windowWidth: '380px',
    windowMaxHeight: '520px',
    borderRadius: '16px'
  };

  const CACHE_CONFIG = { ttl: 1500, maxItems: 25, chunkSize: 5 };

  const TIMINGS = {
    renderStartDelay: 10,
    moreButtonDelay: 50,
    observerDebounce: 500,
    copyButtonFeedback: 800,
    highlightDuration: 3000,
    dragThreshold: 5
  };

  const SELECTORS = {
    telLinks: 'a[href^="tel:"]',
    mailtoLinks: 'a[href^="mailto:"]',
    phoneDataAttrs: '[data-phone], [data-tel], [data-number], [data-contact]',
    emailDataAttrs: '[data-email], [data-mail], [data-contact-email]',
    innDataAttrs: '[data-inn], [data-innfl], [data-innul]',
    ogrnDataAttrs: '[data-ogrn], [data-ogrnip], [data-ogrnul]',
    dataListAttrs: '[data-list]',
    links: [
      'a[href]', 'iframe[src]', 'embed[src]', 'object[data]',
      '[data-url]', '[data-to]', '[data-link]', '[data-href]'
    ]
  };

  function toUrlString(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (typeof value === 'object') {
      const base = value.baseVal;
      if (typeof base === 'string') return base;
      try {
        const s = value.toString();
        if (s && s !== '[object SVGAnimatedString]' && s !== '[object Object]') return s;
      } catch { /* ignore */ }
    }
    return '';
  }

  function decodeBase64Utf8(s) {
    if (!s || typeof s !== 'string') return '';
    try {
      const binary = atob(s);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      try { return new TextDecoder('utf-8').decode(bytes); }
      catch {
        let out = '';
        for (let i = 0; i < bytes.length; i++) out += String.fromCharCode(bytes[i]);
        return out;
      }
    } catch { return ''; }
  }

  const CARD_META = {
    email: {
      icon: '✉️',
      verifiedBorder: '#00a550', verifiedBg: '#f0fdf4',
      verifiedHoverBorder: '#008844', verifiedHoverBg: '#e6f7e6',
      nonVerifiedHoverBorder: '#00a550', nonVerifiedHoverBg: '#f0fdf4',
      getTitle: (item) => item.email.email,
      getSubtitle: () => null,
      getCopyValue: (item) => item.email.email,
      isVerified: (item) => !!item.email.isVerified,
      highlight: (item) => highlightData(item.email, 'email', '#f59e0b', 'linkradar-email-highlight')
    },
    phone: {
      icon: '📞',
      verifiedBorder: '#00a550', verifiedBg: '#f0fdf4',
      verifiedHoverBorder: '#008844', verifiedHoverBg: '#e6f7e6',
      nonVerifiedHoverBorder: '#00a550', nonVerifiedHoverBg: '#f0fdf4',
      getTitle: (item) => item.phone.display || item.phone.phone,
      getSubtitle: () => null,
      getCopyValue: (item) => {
        const p = item.phone.phone;
        if (!p) return '';
        if (item.phone.isLocal) return p;
        if (p.length === 11 && (p.startsWith('7') || p.startsWith('8'))) return p.slice(1);
        return p;
      },
      isVerified: (item) => !!item.phone.isVerified,
      highlight: (item) => highlightData(item.phone, 'phone', '#3b82f6', 'linkradar-phone-highlight')
    },
    inn: {
      icon: '🆔',
      verifiedBorder: '#8b5cf6', verifiedBg: '#f5f3ff',
      verifiedHoverBorder: '#7c3aed', verifiedHoverBg: '#ede9fe',
      nonVerifiedHoverBorder: null, nonVerifiedHoverBg: null,
      getTitle: (item) => item.inn.value,
      getSubtitle: (item) => item.inn.type,
      getCopyValue: (item) => item.inn.value,
      isVerified: (item) => !!item.inn.isVerified,
      highlight: (item) => highlightData(item.inn, 'inn', '#8b5cf6', 'linkradar-verification-highlight')
    },
    ogrn: {
      icon: '📋',
      verifiedBorder: '#ec4899', verifiedBg: '#fdf2f8',
      verifiedHoverBorder: '#db2777', verifiedHoverBg: '#fce7f3',
      nonVerifiedHoverBorder: null, nonVerifiedHoverBg: null,
      getTitle: (item) => item.ogrn.value,
      getSubtitle: (item) => item.ogrn.type,
      getCopyValue: (item) => item.ogrn.value,
      isVerified: (item) => !!item.ogrn.isVerified,
      highlight: (item) => highlightData(item.ogrn, 'ogrn', '#ec4899', 'linkradar-verification-highlight')
    },
    ogrnip: {
      icon: '👤',
      verifiedBorder: '#f59e0b', verifiedBg: '#fffbeb',
      verifiedHoverBorder: '#d97706', verifiedHoverBg: '#fef3c7',
      nonVerifiedHoverBorder: null, nonVerifiedHoverBg: null,
      getTitle: (item) => item.ogrn.value,
      getSubtitle: (item) => item.ogrn.type,
      getCopyValue: (item) => item.ogrn.value,
      isVerified: (item) => !!item.ogrn.isVerified,
      highlight: (item) => highlightData(item.ogrn, 'ogrnip', '#f59e0b', 'linkradar-verification-highlight')
    }
  };

  const FEEDBACK_EMAIL = 'v.cherednichenko@barnaul.2gis.ru';
  const FEEDBACK_SUBJECT = 'LinkRadar: обратная связь';

  const INTERNAL_DOMAIN_PATTERNS = [
    /(^|\.)2gis\./i, /\.local$/i, /\.corp$/i, /\.intranet$/i,
    /^localhost$/i, /^\d{1,3}(\.\d{1,3}){3}$/
  ];

  function isInternalDomain() {
    const host = window.location.hostname.toLowerCase();
    if (!host) return true;
    if (!host.includes('.')) return true;
    return INTERNAL_DOMAIN_PATTERNS.some(re => re.test(host));
  }

  const HIGHLIGHT_STATE_KEY = '__linkRadarHighlightState';

  let panel = null;
  let panelShadowRoot = null;
  let badgeEl = null;
  let windowEl = null;
  let linksContainerEl = null;
  let panelTitleEl = null;
  let feedbackLinkEl = null;

  let isPanelOpen = false;
  let observer = null;
  let observerDebounceTimer = null;
  let lastLinksHash = 0;
  let cachedResults = null;
  let cacheTimestamp = 0;

  const DEBUG = false;

  let isDraggingPanel = false;
  let cancelRender = false;
  let renderToken = 0;
  let isFeedbackClicking = false;

  function normalizePhone(phone, isTel) {
    if (!phone) return null;
    let cleaned = String(phone).replace(/[^0-9]/g, '');

    if (isTel) {
      if (cleaned.length === 0) return null;
      if (cleaned.length === 11 && cleaned.startsWith('8')) cleaned = '7' + cleaned.slice(1);
      if (cleaned.length === 10) return '7' + cleaned;
      if (cleaned.length === 11 && cleaned.startsWith('7')) return cleaned;
      return null;
    }

    if (String(phone).trim().startsWith('+8')) cleaned = '8' + cleaned.slice(1);

    if (cleaned.length === 11) {
      if (cleaned.startsWith('8')) cleaned = '7' + cleaned.slice(1);
      if (!cleaned.startsWith('7')) return null;

      const secondDigit = cleaned[1];
      const cityCode = cleaned.slice(1, 4);

      if (secondDigit === '9') {
        if (INVALID_9XX.has(cityCode)) return null;
      } else if (cityCode === '800') {
        // ok
      } else if (VALID_CITY_CODES.has(cityCode)) {
        // ok
      } else {
        return null;
      }

      const day = parseInt(cleaned.slice(2, 4), 10);
      const month = parseInt(cleaned.slice(4, 6), 10);
      const year = parseInt(cleaned.slice(6, 10), 10);
      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        if (year >= 2020 && year <= 2030) return null;
      }
      return cleaned;
    }

    if (cleaned.length === 10) {
      const withCode = '7' + cleaned;
      const secondDigit = withCode[1];
      const cityCode = withCode.slice(1, 4);

      if (secondDigit === '9') {
        if (INVALID_9XX.has(cityCode)) return null;
      } else if (cityCode === '800') {
        // ok
      } else if (VALID_CITY_CODES.has(cityCode)) {
        // ok
      } else {
        return null;
      }
      return withCode;
    }
    return null;
  }

  function toPunycodeHost(domain) {
    if (!domain) return '';
    try { return new URL('http://' + domain).hostname.toLowerCase(); }
    catch { return String(domain).toLowerCase(); }
  }

  function isOwnSiteEmailDomain(domain) {
    if (!domain) return false;
    const host = window.location.hostname.replace(/^www\./, '').toLowerCase();
    if (!host) return false;
    const punyDomain = toPunycodeHost(domain).replace(/^www\./, '');
    if (punyDomain === host) return true;
    if (punyDomain.endsWith('.' + host)) return true;
    if (host.endsWith('.' + punyDomain)) return true;

    const siteName = host.replace(/\..*$/, '');
    if (!siteName || siteName.length < 2) return false;
    const dot = punyDomain.indexOf('.');
    if (dot <= 0) return false;
    const local = punyDomain.slice(0, dot);
    const tld = punyDomain.slice(dot + 1);
    if (local === siteName && KNOWN_TLDS.has(tld)) return true;
    return false;
  }

  function normalizeEmail(email, isMailto) {
    if (!email) return null;
    let trimmed = String(email).trim().toLowerCase();
    let emailRegex = /^[\p{L}0-9._%+\-]+@[\p{L}\p{N}.\-]+\.[\p{L}]{2,}$/u;
    if (!emailRegex.test(trimmed)) return null;
    if (isMailto) return trimmed;

    let parts = trimmed.split('@');
    if (parts.length === 2) {
      let domain = parts[1];
      if (ALLOWED_EMAIL_DOMAINS.has(domain)) return trimmed;
      if (isOwnSiteEmailDomain(domain)) return trimmed;
    }
    return null;
  }

  function normalizeINN(inn) {
    if (!inn) return null;
    const trimmed = String(inn).trim();
    if (!/^\d+$/.test(trimmed)) return null;
    if (trimmed.length === 10 || trimmed.length === 12) return trimmed;
    return null;
  }

  function normalizeOGRN(ogrn) {
    if (!ogrn) return null;
    const trimmed = String(ogrn).trim();
    if (!/^\d+$/.test(trimmed)) return null;
    if (trimmed.length === 13 || trimmed.length === 15) return trimmed;
    return null;
  }

  function isValidINN(inn) {
    if (!inn || (inn.length !== 10 && inn.length !== 12)) return false;
    if (/^(\d)\1+$/.test(inn)) return false;

    if (inn.length === 10) {
      const weights = [2, 4, 10, 3, 5, 9, 4, 6, 8];
      let sum = 0;
      for (let i = 0; i < 9; i++) sum += parseInt(inn[i]) * weights[i];
      let control = sum % 11;
      if (control === 10) control = 0;
      return control === parseInt(inn[9]);
    }

    if (inn.length === 12) {
      const weights1 = [7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
      let sum1 = 0;
      for (let i = 0; i < 10; i++) sum1 += parseInt(inn[i]) * weights1[i];
      let control1 = sum1 % 11;
      if (control1 === 10) control1 = 0;
      if (control1 !== parseInt(inn[10])) return false;

      const weights2 = [3, 7, 2, 4, 10, 3, 5, 9, 4, 6, 8];
      let sum2 = 0;
      for (let i = 0; i < 11; i++) sum2 += parseInt(inn[i]) * weights2[i];
      let control2 = sum2 % 11;
      if (control2 === 10) control2 = 0;
      return control2 === parseInt(inn[11]);
    }
    return false;
  }

  function isValidOGRN(value) {
    if (!value) return false;
    if (/^(\d)\1+$/.test(value)) return false;
    if (value.length === 13) {
      const first12 = BigInt(value.slice(0, 12));
      let rest = Number(first12 % 11n);
      if (rest === 10) rest = 0;
      return rest === parseInt(value[12], 10);
    }
    if (value.length === 15) {
      const first14 = BigInt(value.slice(0, 14));
      let rest = Number(first14 % 13n);
      if (rest >= 10) rest = 0;
      return rest === parseInt(value[14], 10);
    }
    return false;
  }

  function getOGRNType(value) {
    if (!value) return null;
    const first = value[0];
    if (value.length === 13 && (first === '1' || first === '5')) return { type: 'ОГРН', network: 'ogrn' };
    if (value.length === 15 && first === '3') return { type: 'ОГРНИП', network: 'ogrnip' };
    return null;
  }

  function getINNType(value) {
    if (value.length === 12) return 'ИНН (физ.лицо)';
    if (value.length === 10 && value.startsWith('9909')) return 'ИНН (иностр. орг.)';
    return 'ИНН (юр.лицо)';
  }

  function formatPhoneForDisplay(phone, originalText) {
    if (!phone) return phone;

    if (originalText && phone.length === 11 && phone.startsWith('7')) {
      let m = originalText.match(/\((\d{5})\)/);
      if (m) {
        const code5 = m[1];
        if (phone.slice(1, 6) === code5) {
          const local = phone.slice(6);
          if (local.length === 5) return `+7 (${code5}) ${local.slice(0,1)}-${local.slice(1,3)}-${local.slice(3)}`;
        }
      }
      m = originalText.match(/\((\d{4})\)/);
      if (m) {
        const code4 = m[1];
        if (phone.slice(1, 5) === code4) {
          const local = phone.slice(5);
          if (local.length === 6) return `+7 (${code4}) ${local.slice(0,3)}-${local.slice(3)}`;
        }
      }
    }

    if (phone.length !== 11 && phone.length !== 10) return phone;
    if (phone.length === 11 && phone.startsWith('7')) {
      return `+7 (${phone.slice(1, 4)}) ${phone.slice(4, 7)}-${phone.slice(7, 9)}-${phone.slice(9, 11)}`;
    }
    if (phone.length === 10) {
      return `+7 (${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6, 8)}-${phone.slice(8, 10)}`;
    }
    return phone;
  }

  function findDeepestAncestorContaining(startEl, text) {
    let node = startEl;
    while (node) {
      let found = null;
      for (const child of node.children) {
        if ((child.textContent || '').includes(text)) { found = child; break; }
      }
      if (!found) return node;
      node = found;
    }
    return startEl;
  }

  function findNumbersNearLabel(startEl, labelLower, minLen, maxLen) {
    let node = startEl;
    let depth = 0;
    while (node && depth < 6) {
      const content = node.textContent || '';
      if (content.length > 0 && content.length < 5000) {
        if (content.toLowerCase().includes(labelLower)) {
          const re = new RegExp(`(?<!\\d)(\\d{${minLen},${maxLen}})(?!\\d)`, 'g');
          const nums = [...content.matchAll(re)].map(m => m[1]);
          if (nums.length > 0) return { ancestor: node, numbers: nums };
        }
      }
      if (node.tagName === 'TR' || node.tagName === 'LI' || node.tagName === 'DL' ||
          node.tagName === 'P' || node.tagName === 'TABLE') break;
      node = node.parentElement;
      depth++;
    }
    return null;
  }

  function isInGeoContext(el) {
    if (!el) return false;
    let node = el;
    let depth = 0;
    while (node && depth < 5) {
      try {
        if (node.tagName === 'A' && node.hasAttribute('href')) {
          const href = toUrlString(node.getAttribute('href')) || toUrlString(node.href);
          if (href) {
            if (/[?&](?:lat|lon|start-lat|start-lon|end-lat|end-lon|rtext)=/i.test(href)) return true;
            if (/(?:maps\.yandex|maps\.google|appmetrica\.yandex|google\.[a-z.]+\/maps|yandex\.[a-z.]+\/maps)/i.test(href)) return true;
          }
        }
        if (node.tagName === 'IFRAME' || node.tagName === 'EMBED') {
          const src = toUrlString(node.getAttribute('src'));
          if (src) {
            if (/[?&](?:lat|lon|start-lat|start-lon|end-lat|end-lon|rtext)=/i.test(src)) return true;
            if (/(?:maps\.yandex|maps\.google|appmetrica\.yandex)/i.test(src)) return true;
          }
        }
      } catch { /* ignore */ }
      node = node.parentElement;
      depth++;
    }
    return false;
  }

  function extractLocalPhones(text) {
    if (!text || text.length > 1000) return [];
    if (/[?&](?:lat|lon|start-lat|start-lon|end-lat|end-lon|rtext)=/i.test(text)) return [];
    if (/(?:maps\.yandex|maps\.google|appmetrica\.yandex)/i.test(text)) return [];
    const results = [];
    try {
      const matches = [...text.matchAll(LOCAL_PHONE_GROUPS_REGEX)];
      for (const match of matches) {
        const raw = match[1];
        if (!raw) continue;
        const groups = raw.split(/[\s.\u00A0\-\u2010\u2011\u2012\u2013\u2014\u2212]+/).filter(Boolean);
        if (groups.length < 2 || groups.length > 4) continue;
        if (!groups.every(g => /^\d+$/.test(g))) continue;
        if (groups.some(g => g.length > 4)) continue;
        const totalLen = groups.reduce((s, g) => s + g.length, 0);
        if (totalLen < 5 || totalLen > 7) continue;

        if (TIME_PATTERN.test(raw)) continue;

        const isTwoTriples = groups.length === 2 && groups[0].length === 3 && groups[1].length === 3;
        if (isTwoTriples) {
          const after = text.slice(match.index + match[0].length);
          const afterTrim = after.replace(/^\s+/, '');
          if (/^(?:р|руб|коп|₽|%|\$|€)/i.test(afterTrim)) continue;
          const before = text.slice(0, match.index);
          const beforeTrim = before.replace(/\s+$/, '');
          if (/от\s*$/i.test(beforeTrim) || /до\s*$/i.test(beforeTrim)) continue;
        }

        results.push({ raw, digits: groups.join(''), groups, display: groups.join('-') });
      }
    } catch { /* ignore */ }
    return results;
  }

  function hasLocalPhoneLabel(el) {
    if (!el) return false;
    let node = el;
    let depth = 0;
    while (node && depth < 4) {
      const t = node.textContent || '';
      if (t.length > 0 && t.length < 3000 && LOCAL_PHONE_LABEL_REGEX.test(t)) return true;

      try {
        if (node.classList && node.classList.length > 0) {
          for (let i = 0; i < node.classList.length; i++) {
            if (LOCAL_PHONE_CLASS_REGEX.test(node.classList[i])) return true;
          }
        }
        const id = String(node.id || '');
        if (id && LOCAL_PHONE_CLASS_REGEX.test(id)) return true;
      } catch { /* ignore */ }

      node = node.parentElement;
      depth++;
    }
    return false;
  }

  function forEachTextNode(filterFn, callback) {
    if (!document.body) return;
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;
          const tag = parent.tagName;
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
          if (parent.getRootNode() !== document) return NodeFilter.FILTER_REJECT;
          if (isInGeoContext(parent)) return NodeFilter.FILTER_REJECT;
          if (!filterFn(node.nodeValue || '')) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );
    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent) continue;
      callback(node.nodeValue || '', parent);
    }
  }

  function findProcessedTypes(el, sets) {
    const result = { tel: false, mailto: false, inn: false, ogrn: false };
    let node = el;
    while (node) {
      if (!result.tel && sets.tel.has(node)) result.tel = true;
      if (!result.mailto && sets.mailto.has(node)) result.mailto = true;
      if (!result.inn && sets.inn.has(node)) result.inn = true;
      if (!result.ogrn && sets.ogrn.has(node)) result.ogrn = true;
      if (result.tel && result.mailto && result.inn && result.ogrn) break;
      node = node.parentElement;
    }
    return result;
  }

  function looksLikeInnOgrnParent(startEl) {
    let node = startEl;
    let depth = 0;
    while (node && depth < 5) {
      const t = node.textContent || '';
      if (t.length > 0 && t.length < 500) {
        const hasInnOgrn = /(?:^|[^а-яё])(ИНН|ОГРНИП|ОГРН|КПП)(?:[^а-яё]|$)/i.test(t);
        if (hasInnOgrn) {
          const hasPhoneLabel = /(?:^|[^а-яё])(телефон|тел\.?|phone|tel)(?:[^а-яё]|$)/i.test(t);
          if (!hasPhoneLabel) return true;
        }
      }
      if (node.tagName === 'TR' || node.tagName === 'LI' || node.tagName === 'P' ||
          node.tagName === 'DL' || node.tagName === 'TABLE') break;
      node = node.parentElement;
      depth++;
    }
    return false;
  }

  function extractPhonesFromText(text) {
    if (!text) return [];
    if (/[?&](?:lat|lon|start-lat|start-lon|end-lat|end-lon|rtext)=/i.test(text)) return [];
    if (/(?:maps\.yandex|maps\.google|appmetrica\.yandex)/i.test(text)) return [];

    const allMatches = [];
    const strictMatches = text.match(PHONE_REGEX_STRICT);
    if (strictMatches) allMatches.push(...strictMatches);
    const city4Matches = text.match(PHONE_REGEX_CITY4);
    if (city4Matches) allMatches.push(...city4Matches);
    if (allMatches.length > 0) return allMatches;

    let digitCount = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c >= 48 && c <= 57) { digitCount++; if (digitCount >= 10) break; }
    }
    if (digitCount < 10) return [];
    return text.match(PHONE_REGEX_LOOSE) || [];
  }

  function collectAllData() {
    const phonesSeen = new Map();
    const emailsSeen = new Map();
    const innsSeen = new Map();
    const ogrnsSeen = new Map();

    const excludePhones = new Set();
    const processedTel = new Set();
    const processedMailto = new Set();
    const processedINN = new Set();
    const processedOGRN = new Set();

    function addPhone(phone, element, text, isTel, isVerified, matchedText) {
      let normalizedForDedup = phone;
      if (isTel && phone.startsWith('8') && phone.length === 11) normalizedForDedup = '7' + phone.slice(1);
      if (excludePhones.has(normalizedForDedup)) return;
      const key = normalizedForDedup;
      if (!phonesSeen.has(key)) {
        phonesSeen.set(key, {
          phone, element, text,
          matchedText: matchedText || text,
          isTel, isVerified: isVerified || false,
          isLocal: false,
          display: formatPhoneForDisplay(phone, matchedText || text)
        });
      } else {
        const existing = phonesSeen.get(key);
        if (isVerified && !existing.isVerified) {
          existing.element = element; existing.isTel = true; existing.isVerified = true;
          existing.matchedText = matchedText || text;
          existing.display = formatPhoneForDisplay(existing.phone, matchedText || text);
        }
        if (isTel && !existing.isTel) {
          existing.element = element; existing.isTel = true; existing.isVerified = true;
          existing.matchedText = matchedText || text;
          existing.display = formatPhoneForDisplay(existing.phone, matchedText || text);
        }
      }
    }

    function addLocalPhone(match, element, contextText) {
      if (!match || !match.digits) return;
      const key = 'local:' + match.digits;
      if (phonesSeen.has(key)) return;

      const digits = match.digits;
      const stripped = digits.replace(/^[78]/, '');
      for (const existing of phonesSeen.values()) {
        const full = existing.phone;
        if (!full || full.length < 10) continue;
        if (full.includes(digits)) return;
        if (stripped.length >= 5 && full.includes(stripped)) return;
      }

      phonesSeen.set(key, {
        phone: match.digits,
        element,
        text: contextText,
        matchedText: match.raw,
        isTel: false,
        isVerified: false,
        isLocal: true,
        display: match.display,
        localGroups: match.groups
      });
    }

    function addEmail(email, element, text, isMailto, isVerified, matchedText) {
      const key = email;
      if (!emailsSeen.has(key)) {
        emailsSeen.set(key, {
          email, element, text,
          matchedText: matchedText || text,
          isMailto, isVerified: isVerified || false
        });
      } else {
        const existing = emailsSeen.get(key);
        if (isVerified && !existing.isVerified) {
          existing.element = element; existing.isMailto = isMailto;
          existing.isVerified = true; existing.matchedText = matchedText || text;
        }
      }
    }

    function addINN(value, element, text, isVerified, matchedText) {
      const type = getINNType(value);
      const key = value + type;
      if (!innsSeen.has(key)) {
        innsSeen.set(key, { value, element, text, matchedText: matchedText || text, type, isVerified: isVerified || false });
      } else {
        const existing = innsSeen.get(key);
        if (isVerified && !existing.isVerified) {
          existing.isVerified = true; existing.element = element; existing.matchedText = matchedText || text;
        }
      }
    }

    function addOGRN(value, element, text, isVerified, matchedText) {
      const meta = getOGRNType(value);
      if (!meta) return;
      const key = value + meta.type;
      if (!ogrnsSeen.has(key)) {
        ogrnsSeen.set(key, { value, element, text, matchedText: matchedText || text, type: meta.type, network: meta.network, isVerified: isVerified || false });
      } else {
        const existing = ogrnsSeen.get(key);
        if (isVerified && !existing.isVerified) {
          existing.isVerified = true; existing.element = element; existing.matchedText = matchedText || text;
        }
      }
    }

    function parseHref(rawHref, scheme) {
      let decoded;
      try { decoded = decodeURIComponent(rawHref); } catch { decoded = rawHref; }
      return decoded.replace(new RegExp('^' + scheme + ':', 'i'), '').split('?')[0].split(';')[0].split(',')[0].trim();
    }

    try {
      document.querySelectorAll(SELECTORS.telLinks).forEach(el => {
        const rawHref = toUrlString(el.getAttribute('href')) || toUrlString(el.href);
        if (!rawHref) return;
        const phone = parseHref(rawHref, 'tel');
        const normalized = normalizePhone(phone, true);
        if (normalized) {
          const visible = (el.textContent || '').trim();
          const matchedText = visible || phone;
          addPhone(normalized, el, matchedText, true, true, matchedText);
        }
      });
    } catch { /* ignore */ }

    try {
      document.querySelectorAll(SELECTORS.mailtoLinks).forEach(el => {
        const rawHref = toUrlString(el.getAttribute('href')) || toUrlString(el.href);
        if (!rawHref) return;
        const email = parseHref(rawHref, 'mailto');
        const normalized = normalizeEmail(email, true);
        if (normalized) {
          const visible = (el.textContent || '').trim();
          const matchedText = visible || email;
          addEmail(normalized, el, matchedText, true, true, matchedText);
        }
      });
    } catch { /* ignore */ }

    try {
      document.querySelectorAll(SELECTORS.phoneDataAttrs).forEach(el => {
        processedTel.add(el);
        const dataAttrs = ['data-phone', 'data-tel', 'data-number', 'data-contact'];
        for (const attr of dataAttrs) {
          const val = el.getAttribute(attr);
          if (val) {
            const normalized = normalizePhone(val, false);
            if (normalized) addPhone(normalized, el, val, false, true, val);
          }
        }
      });
    } catch { /* ignore */ }

    try {
      document.querySelectorAll(SELECTORS.emailDataAttrs).forEach(el => {
        processedMailto.add(el);
        const attrs = ['data-email', 'data-mail', 'data-contact-email'];
        for (const attr of attrs) {
          const val = el.getAttribute(attr);
          if (val) {
            const normalized = normalizeEmail(val, false);
            if (normalized) addEmail(normalized, el, val, false, true, val);
          }
        }
      });
    } catch { /* ignore */ }

    try {
      document.querySelectorAll(SELECTORS.innDataAttrs).forEach(el => {
        processedINN.add(el);
        const dataAttrs = ['data-inn', 'data-innfl', 'data-innul'];
        for (const attr of dataAttrs) {
          const val = el.getAttribute(attr);
          if (val) {
            const normalized = normalizeINN(val);
            if (normalized && isValidINN(normalized)) addINN(normalized, el, val, true, val);
          }
        }
      });
    } catch { /* ignore */ }

    try {
      document.querySelectorAll(SELECTORS.ogrnDataAttrs).forEach(el => {
        processedOGRN.add(el);
        const dataAttrs = ['data-ogrn', 'data-ogrnip', 'data-ogrnul'];
        for (const attr of dataAttrs) {
          const val = el.getAttribute(attr);
          if (val) {
            const normalized = normalizeOGRN(val);
            if (normalized && isValidOGRN(normalized)) addOGRN(normalized, el, val, true, val);
          }
        }
      });
    } catch { /* ignore */ }

    try {
      document.querySelectorAll(SELECTORS.dataListAttrs).forEach(el => {
        const raw = el.getAttribute('data-list');
        if (!raw || raw.length < 8) return;
        const decoded = decodeBase64Utf8(raw);
        if (!decoded) return;
        let data = null;
        try { data = JSON.parse(decoded); } catch { data = null; }
        const strings = [];
        if (data != null) {
          const walk = (v) => {
            if (typeof v === 'string') strings.push(v);
            else if (Array.isArray(v)) v.forEach(walk);
            else if (v && typeof v === 'object') for (const k in v) if (Object.prototype.hasOwnProperty.call(v, k)) walk(v[k]);
          };
          walk(data);
        } else strings.push(decoded);

        for (const s of strings) {
          if (!s || s.length > 500) continue;
          if (s.indexOf('@') !== -1) {
            const emailMatches = s.match(EMAIL_REGEX);
            if (emailMatches) for (const m of emailMatches) {
              const normalized = normalizeEmail(m, false);
              if (normalized) addEmail(normalized, el, m.trim(), false, true, m.trim());
            }
          }
          if (/\d/.test(s)) {
            const phoneMatches = extractPhonesFromText(s);
            if (phoneMatches && phoneMatches.length > 0) for (const m of phoneMatches) {
              const normalized = normalizePhone(m, false);
              if (normalized) addPhone(normalized, el, m.trim(), false, true, m.trim());
            }
          }
        }
      });
    } catch { /* ignore */ }

    const sets = { tel: processedTel, mailto: processedMailto, inn: processedINN, ogrn: processedOGRN };

    try {
      forEachTextNode(
        text => TEXT_FILTER_REGEX.test(text),
        (text, parent) => {
          const inProcessed = findProcessedTypes(parent, sets);
          if (inProcessed.tel && inProcessed.mailto && inProcessed.inn && inProcessed.ogrn) return;

          if (!inProcessed.tel && /\d/.test(text)) {
            if (!looksLikeInnOgrnParent(parent)) {
              const fullMatches = extractPhonesFromText(text) || [];
              for (const m of fullMatches) {
                const normalized = normalizePhone(m, false);
                if (normalized) addPhone(normalized, parent, m.trim(), false, false, m.trim());
              }
            }
          }

          if (!inProcessed.tel && text.length < 500) {
            if (/\d/.test(text) && /[\s.\u00A0\-\u2010\u2011\u2012\u2013\u2014\u2212]/.test(text)) {
              const localMatches = extractLocalPhones(text);
              if (localMatches.length > 0 && hasLocalPhoneLabel(parent)) {
                for (const lm of localMatches) addLocalPhone(lm, parent, text.trim());
              }
            }
          }

          if (!inProcessed.mailto && text.indexOf('@') !== -1) {
            const matches = text.match(EMAIL_REGEX);
            if (matches) for (const m of matches) {
              const normalized = normalizeEmail(m, false);
              if (normalized) addEmail(normalized, parent, m.trim(), false, false, m.trim());
            }
          }

          if (!inProcessed.inn && /ИНН/i.test(text)) {
            let added = false;
            const directMatches = text.match(INN_LABEL_REGEX);
            if (directMatches) for (const m of directMatches) {
              const digits = m.replace(/[^0-9]/g, '');
              const normalized = normalizeINN(digits);
              if (normalized && isValidINN(normalized)) { addINN(normalized, parent, m.trim(), false, m.trim()); added = true; }
            }
            if (!added) {
              const found = findNumbersNearLabel(parent, 'инн', 10, 12);
              if (found) for (const num of found.numbers) {
                const normalized = normalizeINN(num);
                if (normalized && isValidINN(normalized)) {
                  const target = findDeepestAncestorContaining(found.ancestor, num) || found.ancestor;
                  addINN(normalized, target, num, false, num);
                }
              }
            }
          }

          if (!inProcessed.ogrn && /ОГРН/i.test(text)) {
            let added = false;
            const ogrnMatches = text.match(OGRN_LABEL_REGEX);
            if (ogrnMatches) for (const m of ogrnMatches) {
              const digits = m.replace(/[^0-9]/g, '');
              const normalized = normalizeOGRN(digits);
              if (normalized && isValidOGRN(normalized) && getOGRNType(normalized)) {
                addOGRN(normalized, parent, m.trim(), false, m.trim()); added = true;
              }
            }
            const ogrnipMatches = text.match(OGRNIP_LABEL_REGEX);
            if (ogrnipMatches) for (const m of ogrnipMatches) {
              const digits = m.replace(/[^0-9]/g, '');
              const normalized = normalizeOGRN(digits);
              if (normalized && isValidOGRN(normalized) && getOGRNType(normalized)) {
                addOGRN(normalized, parent, m.trim(), false, m.trim()); added = true;
              }
            }
            if (!added) {
              const found = findNumbersNearLabel(parent, 'огрн', 13, 15);
              if (found) for (const num of found.numbers) {
                const normalized = normalizeOGRN(num);
                if (normalized && isValidOGRN(normalized) && getOGRNType(normalized)) {
                  const target = findDeepestAncestorContaining(found.ancestor, num) || found.ancestor;
                  addOGRN(normalized, target, num, false, num);
                }
              }
            }
          }
        }
      );
    } catch { /* ignore */ }

    try {
      const fulls = [];
      for (const p of phonesSeen.values()) {
        if (!p.isLocal && p.phone && p.phone.length >= 10) fulls.push(p.phone);
      }
      if (fulls.length > 0) {
        for (const [key, item] of Array.from(phonesSeen.entries())) {
          if (!item.isLocal) continue;
          const digits = item.phone;
          const stripped = digits.replace(/^[78]/, '');
          for (const full of fulls) {
            if (full.includes(digits) || (stripped.length >= 5 && full.includes(stripped))) {
              phonesSeen.delete(key);
              break;
            }
          }
        }
      }
    } catch { /* ignore */ }

    return {
      phones: Array.from(phonesSeen.values()),
      emails: Array.from(emailsSeen.values()),
      inns: Array.from(innsSeen.values()),
      ogrns: Array.from(ogrnsSeen.values())
    };
  }

  function isElementVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.getClientRects().length === 0) return false;
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
    if (parseFloat(style.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    return true;
  }

  function findElementByTextInDOM(searchText) {
    if (!searchText || searchText.length < 3) return null;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentElement;
        if (!p) return NodeFilter.FILTER_REJECT;
        const tag = p.tagName;
        if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') return NodeFilter.FILTER_REJECT;
        if (p.getRootNode() !== document) return NodeFilter.FILTER_REJECT;
        const v = node.nodeValue;
        if (!v || v.indexOf(searchText) === -1) return NodeFilter.FILTER_REJECT;
        if (!isElementVisible(p)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const node = walker.nextNode();
    return node ? node.parentElement : null;
  }

  function generatePhoneVariants(phone) {
    if (!phone) return [];
    const variants = [phone];
    if (phone.length === 11 && phone.startsWith('7')) {
      const rest = phone.slice(1);
      const cc = rest.slice(0, 3);
      const p1 = rest.slice(3, 6);
      const p2 = rest.slice(6, 8);
      const p3 = rest.slice(8, 10);
      variants.push(
        '8' + rest, '+7' + rest,
        '8 (' + cc + ') ' + p1 + '-' + p2 + '-' + p3,
        '+7 (' + cc + ') ' + p1 + '-' + p2 + '-' + p3,
        '8(' + cc + ')' + p1 + '-' + p2 + '-' + p3,
        '+7(' + cc + ')' + p1 + '-' + p2 + '-' + p3,
        '8 ' + cc + ' ' + p1 + '-' + p2 + '-' + p3,
        '8-' + cc + '-' + p1 + '-' + p2 + '-' + p3,
        '8 ' + cc + ' ' + p1 + ' ' + p2 + ' ' + p3,
        '+7 ' + cc + ' ' + p1 + '-' + p2 + '-' + p3
      );
    }
    return variants;
  }

  function findElementByHref(phone) {
    if (!phone) return null;
    const rest = phone.startsWith('7') ? phone.slice(1) : phone;
    let candidates;
    try { candidates = document.querySelectorAll('a[href*="' + rest + '"], a[href*="+' + phone + '"], a[href*="' + phone + '"]'); }
    catch { return null; }
    for (const c of candidates) if (isElementVisible(c)) return c;
    return null;
  }

  function findTopmostHidden(el) {
    let topHidden = null;
    let node = el;
    while (node && node !== document.body && node !== document.documentElement) {
      if (isElementVisible(node)) break;
      topHidden = node;
      node = node.parentElement;
    }
    return topHidden;
  }

  function findOpenerForPanel(panel) {
    if (!panel) return null;
    if (panel.id) {
      const sels = ['[aria-controls="' + panel.id + '"]', '[data-bs-target="#' + panel.id + '"]', '[data-target="#' + panel.id + '"]', 'a[href="#' + panel.id + '"]'];
      for (const sel of sels) {
        try {
          const found = document.querySelector(sel);
          if (found && found !== panel && isElementVisible(found)) return found;
        } catch { /* invalid */ }
      }
    }
    const panelClass = String(panel.className || '');
    const classBases = [];
    panelClass.split(/\s+/).forEach(function(c) {
      const m = c.match(/^(.*?)(?:-menu|-panel|-popup|-dialog|-modal|-content|-wrap|-block|-inner|-body)$/);
      if (m && m[1] && m[1].length > 2) classBases.push(m[1]);
    });
    if (classBases.length > 0) {
      let scope = panel.parentElement;
      for (let i = 0; i < 5 && scope && scope !== document.body; i++) {
        const candidates = scope.querySelectorAll('button, [role="button"], [class*="btn"], [class*="button"], [data-bs-toggle], [data-toggle], [class*="open"], [class*="toggle"], [class*="trigger"]');
        for (const c of candidates) {
          if (c === panel || panel.contains(c)) continue;
          if (!isElementVisible(c)) continue;
          const cClass = String(c.className || '');
          for (const base of classBases) if (cClass.indexOf(base) !== -1) return c;
        }
        scope = scope.parentElement;
      }
    }
    const parent = panel.parentElement;
    if (parent) {
      for (const sib of Array.from(parent.children)) {
        if (sib === panel) continue;
        if (!isElementVisible(sib)) continue;
        if (sib.tagName === 'BUTTON' || sib.hasAttribute('data-bs-toggle') || sib.hasAttribute('data-toggle')) return sib;
      }
    }
    return null;
  }

  function resolveHighlightTarget(data, kind) {
    if (!data) return null;
    const originalEl = data.element;
    const originalText = data.matchedText || '';
    if (originalEl && isElementVisible(originalEl)) return { element: originalEl, text: originalText };
    if (originalText) {
      const found = findElementByTextInDOM(originalText);
      if (found) return { element: found, text: originalText };
    }
    if (kind === 'phone' && data.phone) {
      const variants = generatePhoneVariants(data.phone);
      for (const v of variants) {
        if (v === originalText) continue;
        const found = findElementByTextInDOM(v);
        if (found) return { element: found, text: v };
      }
      const byHref = findElementByHref(data.phone);
      if (byHref) return { element: byHref, text: null };
    }
    if (originalEl) {
      const panel = findTopmostHidden(originalEl);
      if (panel) {
        const opener = findOpenerForPanel(panel);
        if (opener) return { element: opener, text: null };
      }
    }
    if (originalEl) {
      let node = originalEl.parentElement;
      while (node && node !== document.body) {
        if (isElementVisible(node)) return { element: node, text: null };
        node = node.parentElement;
      }
    }
    return null;
  }

  function clearHighlights(className) {
    document.querySelectorAll('.' + className).forEach(el => {
      const state = el[HIGHLIGHT_STATE_KEY] || {};
      if (state.timerId) clearTimeout(state.timerId);
      el.classList.remove(className);
      el.style.background = state.background || '';
      el.style.border = state.border || '';
      el.style.borderRadius = state.borderRadius || '';
      el.style.boxShadow = state.boxShadow || '';
      el.style.transition = state.transition || '';
      delete el[HIGHLIGHT_STATE_KEY];
    });
  }

  function selectTextInElement(element, searchText) {
    if (!element || !searchText) return null;
    try {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT, null);
      let textNode;
      while ((textNode = walker.nextNode())) {
        const nodeText = textNode.nodeValue || '';
        const idx = nodeText.indexOf(searchText);
        if (idx !== -1) {
          const range = document.createRange();
          range.setStart(textNode, idx);
          range.setEnd(textNode, idx + searchText.length);
          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);
          const rect = range.getBoundingClientRect();
          if (rect) window.scrollTo({ top: rect.top + window.scrollY - window.innerHeight / 2, behavior: 'smooth' });
          setTimeout(() => {
            try {
              const sel = window.getSelection();
              if (sel && sel.rangeCount > 0) sel.removeAllRanges();
            } catch { /* ignore */ }
          }, TIMINGS.highlightDuration);
          return range;
        }
      }
    } catch { /* ignore */ }
    return null;
  }

  function applyHighlight(el, color, className, searchText) {
    if (!el) return;
    if (!el[HIGHLIGHT_STATE_KEY]) {
      el[HIGHLIGHT_STATE_KEY] = {
        background: el.style.background, border: el.style.border,
        borderRadius: el.style.borderRadius, boxShadow: el.style.boxShadow,
        transition: el.style.transition, timerId: null
      };
    }
    el.classList.add(className);
    el.style.transition = 'background 0.3s, border 0.3s, box-shadow 0.3s';
    el.style.background = `${color}20`;
    el.style.border = `2px solid ${color}`;
    el.style.borderRadius = '4px';
    el.style.boxShadow = `0 0 0 4px ${color}33`;
    const range = searchText ? selectTextInElement(el, searchText) : null;
    if (!range) { try { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); } catch { /* ignore */ } }
    if (el[HIGHLIGHT_STATE_KEY].timerId) clearTimeout(el[HIGHLIGHT_STATE_KEY].timerId);
    el[HIGHLIGHT_STATE_KEY].timerId = setTimeout(() => {
      const state = el[HIGHLIGHT_STATE_KEY];
      if (!state) return;
      el.classList.remove(className);
      el.style.background = state.background || '';
      el.style.border = state.border || '';
      el.style.borderRadius = state.borderRadius || '';
      el.style.boxShadow = state.boxShadow || '';
      el.style.transition = state.transition || '';
      delete el[HIGHLIGHT_STATE_KEY];
    }, TIMINGS.highlightDuration);
  }

  function highlightData(data, kind, color, className) {
    if (!data) return;
    clearHighlights(className);
    const target = resolveHighlightTarget(data, kind);
    if (!target) return;
    applyHighlight(target.element, color, className, target.text);
  }

  async function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      try { await navigator.clipboard.writeText(text); return true; } catch { /* fallback */ }
    }
    return fallbackCopy(text);
  }

  function fallbackCopy(text) {
    if (!panelShadowRoot) return false;
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0';
    textarea.setAttribute('readonly', '');
    panelShadowRoot.appendChild(textarea);
    let ok;
    try {
      textarea.select();
      textarea.setSelectionRange(0, text.length);
      ok = document.execCommand('copy');
    } catch { ok = false; }
    textarea.value = '';
    panelShadowRoot.removeChild(textarea);
    return ok;
  }

  function isMainDomain(domain) {
    const parts = domain.split('.');
    if (parts.length === 3 && parts[1] === '2gis') return false;
    return parts.length <= 2;
  }

  function normalizeUrl(url) {
    try {
      let u = new URL(url);
      URL_PARAMS_TO_REMOVE.forEach(p => u.searchParams.delete(p));
      u.hash = '';
      return u.href;
    } catch { return url; }
  }

  function canonicalizeSocialUrl(url, network) {
    const target = SOCIAL_CANONICAL_HOST[network];
    if (!target) return url;
    try {
      const u = new URL(url);
      const host = u.hostname.replace(/^www\./, '').toLowerCase();
      if (network === 'youtube' && host === 'youtu.be') return url;
      if (network === 'vk' && host === 'vk.me') return url;
      const domains = SOCIAL_DOMAINS[network] || [];
      const isMirror = domains.some(d => host === d || host.endsWith('.' + d));
      if (!isMirror) return url;
      u.hostname = target;
      u.protocol = 'https:';
      return u.href;
    } catch { return url; }
  }

  function getCopyPath(url) {
    try {
      const u = new URL(url);
      if (u.hostname.includes('whatsapp.com') || u.hostname.includes('wa.me')) {
        let phone = u.searchParams.get('phone');
        if (phone) return phone;
        let pathPhone = u.pathname.replace(/[^0-9]/g, '');
        if (pathPhone) return pathPhone;
      }
      let path = u.pathname;
      if (path.startsWith('/')) path = path.slice(1);
      if (path.endsWith('/')) path = path.slice(0, -1);
      return path || url;
    } catch { return url; }
  }

  function decodeRedirect(url) {
    try {
      let u = new URL(url, window.location.href);
      const host = u.hostname.replace(/^www\./, '').toLowerCase();
      const params = u.searchParams;
      if (REDIRECT_HOST_PATTERN.test(host)) {
        const stLink = params.get('st.link');
        if (stLink) { try { return decodeURIComponent(stLink); } catch { return stLink; } }
        const to = params.get('to');
        if (to && (u.pathname.includes('/away') || u.pathname.includes('/dk'))) { try { return decodeURIComponent(to); } catch { return to; } }
      }
      if (u.pathname.includes('/away.php') && params.has('to')) {
        const to = params.get('to');
        if (to) { try { return decodeURIComponent(to); } catch { return to; } }
      }
      if (/(^|\.)google\.[a-z.]+$/.test(host) && u.pathname.includes('/url') && params.has('q')) {
        const q = params.get('q');
        if (q) { try { return decodeURIComponent(q); } catch { return q; } }
      }
      if (/(^|\.)yandex\.[a-z.]+$/.test(host) && u.pathname.includes('/redirect') && params.has('url')) {
        const urlParam = params.get('url');
        if (urlParam) { try { return decodeURIComponent(urlParam); } catch { return urlParam; } }
      }
      return url;
    } catch { return url; }
  }

  function getCurrentDomain() { return window.location.hostname.replace(/^www\./, '').toLowerCase(); }
  function getDomainFromUrl(url) {
    try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; }
  }
  function getPathFromUrl(url) {
    try { return new URL(url).pathname.toLowerCase(); } catch { return ''; }
  }

  function getSocialNetworkByDomain(domain) {
    for (let [network, domains] of Object.entries(SOCIAL_DOMAINS)) {
      for (let d of domains) if (domain === d || domain.endsWith('.' + d)) return network;
    }
    return null;
  }

  function getBookingServiceByDomain(domain) {
    for (let [service, domains] of Object.entries(BOOKING_DOMAINS)) {
      for (let d of domains) if (domain === d || domain.endsWith('.' + d)) return service;
    }
    return null;
  }

  function convertDeepLink(url) {
    const str = toUrlString(url);
    if (!str) return '';
    if (str.startsWith('tg://resolve?domain=')) return 'https://t.me/' + str.replace('tg://resolve?domain=', '').split('&')[0];
    if (str.startsWith('whatsapp://send?phone=')) return 'https://wa.me/' + str.replace('whatsapp://send?phone=', '').split('&')[0];
    return str;
  }

  function extractLinksFromElement(el) {
    let results = [];
    function safePush(raw) {
      const s = convertDeepLink(raw);
      if (s && typeof s === 'string') results.push(s);
    }
    try { if (el.href != null) safePush(el.href); } catch { /* ignore */ }
    try { if (el.src != null) safePush(el.src); } catch { /* ignore */ }
    try { if (el.data != null) safePush(el.data); } catch { /* ignore */ }
    const relStr = toUrlString(el.rel);
    if (relStr && (relStr.startsWith('http') || relStr.includes('://'))) safePush(relStr);
    const actionStr = toUrlString(el.action);
    if (actionStr && (actionStr.startsWith('http') || actionStr.includes('://'))) safePush(actionStr);
    let dataAttrs = ['data-url', 'data-to', 'data-link', 'data-href'];
    for (let attr of dataAttrs) {
      let val = el.getAttribute && el.getAttribute(attr);
      if (typeof val === 'string' && val && (val.startsWith('http') || val.startsWith('/') || val.includes('://') || /^(tg|whatsapp|viber|skype):/.test(val))) safePush(val);
    }
    const tag = el.tagName;
    if (tag === 'IFRAME' || tag === 'EMBED' || tag === 'OBJECT') return results;
    if (el.childElementCount > 5) return results;
    const rawText = el.textContent;
    if (!rawText || rawText.length > 500) return results;
    const text = String(rawText).trim();
    if (text && text.length < 300) {
      const matches = text.match(TEXT_URL_REGEX);
      if (matches) for (const m of matches) {
        if (m.startsWith('http')) results.push(m);
        else results.push('https://' + m);
      }
    }
    return results;
  }

  function getAllLinks() {
    let links = new Set();
    let nodes;
    try { nodes = document.querySelectorAll(SELECTORS.links.join(',')); } catch { return []; }
    nodes.forEach(el => {
      try {
        if (!isElementVisible(el)) return;
        let extracted = extractLinksFromElement(el);
        extracted.forEach(raw => {
          if (!raw || typeof raw !== 'string' || raw.trim() === '') return;
          try {
            let decoded = decodeRedirect(raw);
            let absolute = new URL(decoded, window.location.href).href;
            const u = new URL(absolute);
            if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
            links.add(absolute);
          } catch { /* skip */ }
        });
      } catch { /* ignore */ }
    });
    return Array.from(links);
  }

  function isRootUrl(url) {
    try { let u = new URL(url); let path = u.pathname; if (path === '' || path === '/') return true; } catch { /* ignore */ }
    return false;
  }

  function isJunkLink(url, network) {
    if (isRootUrl(url)) return true;
    let patterns = JUNK_PATTERNS[network] || [];
    let path = getPathFromUrl(url);
    for (let pattern of patterns) if (path.includes(pattern)) return true;
    try {
      let u = new URL(url);
      for (let i = 0; i < OAUTH_HOST_PREFIXES.length; i++) if (u.hostname.startsWith(OAUTH_HOST_PREFIXES[i])) return true;
      if (u.hostname.startsWith('connect.')) return true;
      if (network === 'vk' && VK_OBJECT_PATH_REGEX.test(u.pathname)) return true;
      if (network === 'ok' && OK_OBJECT_PATH_REGEX.test(u.pathname)) return true;
      let sp = u.searchParams;
      if (sp.has('redirect_uri') || sp.has('response_type')) return true;
      // FIX: WhatsApp-ссылки с phone — контактные, не шаринг.
      if (network === 'vk' || network === 'ok') {
        if (sp.has('text') || sp.has('url') || sp.has('share') || sp.has('st.cmd') || sp.has('st.shareUrl')) return true;
      } else if (network === 'whatsapp') {
        if (sp.has('phone') || /^\/\d{10,15}\/?$/.test(u.pathname)) return false;
        if (sp.has('url') || sp.has('share') || sp.has('text')) return true;
      } else {
        if (sp.has('url') || sp.has('share') || sp.has('text')) return true;
      }
    } catch { /* ignore */ }
    return false;
  }

  function isLinkBelongsToSite(url, siteName) {
    try {
      let u = new URL(url);
      let path = u.pathname.toLowerCase();
      let username = path.split('/').filter(Boolean)[0] || '';
      if (!username) return false;
      let cu = username.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
      let cs = siteName.replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
      if (!cs) return false;
      if (cu === cs) return true;
      const suffixLen = cu.length - cs.length;
      if (suffixLen < 1 || suffixLen > 4) return false;
      if (!cu.startsWith(cs)) return false;
      const suffix = cu.slice(cs.length);
      for (let i = 0; i < suffix.length; i++) { const c = suffix.charCodeAt(i); if (c < 48 || c > 57) return false; }
      return true;
    } catch { return false; }
  }

  function getTextBeforeElement(el, maxDepth) {
    if (!el) return '';
    if (maxDepth === undefined) maxDepth = 3;
    let parts = [];
    let node = el;
    let depth = 0;
    while (node && depth <= maxDepth) {
      let sib = node.previousSibling;
      while (sib) {
        if (sib.nodeType === 3) parts.unshift(sib.nodeValue || '');
        else if (sib.nodeType === 1) {
          const t = sib.textContent || '';
          if (t.length <= 200) parts.unshift(t); else parts.unshift(' ');
        }
        sib = sib.previousSibling;
      }
      node = node.parentElement;
      depth++;
    }
    return parts.join('');
  }

  function collectSiteUrls() {
    const results = [];
    const seen = new Set();
    const currentHost = getCurrentDomain();
    function tryAdd(rawHref, sourceEl) {
      if (!rawHref || typeof rawHref !== 'string') return;
      try {
        const decoded = decodeRedirect(rawHref);
        const absolute = new URL(decoded, window.location.href).href;
        const u = new URL(absolute);
        if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
        const domain = u.hostname.replace(/^www\./, '').toLowerCase();
        if (!domain) return;
        if (getSocialNetworkByDomain(domain)) return;
        if (getBookingServiceByDomain(domain)) return;
        if (domain === currentHost) return;
        if (SERVICE_DOMAINS.has(domain)) return;
        if (sourceEl && !isElementVisible(sourceEl)) return;
        const normalized = normalizeUrl(absolute);
        if (seen.has(normalized)) return;
        seen.add(normalized);
        results.push({ url: normalized, element: sourceEl });
      } catch { /* ignore */ }
    }

    for (let i = 0; i < SITE_BLOCK_SELECTORS.length; i++) {
      const sel = SITE_BLOCK_SELECTORS[i];
      try {
        document.querySelectorAll(sel).forEach(block => {
          try {
            if (block.tagName === 'A' && block.hasAttribute('href')) {
              tryAdd(toUrlString(block.getAttribute('href')) || toUrlString(block.href), block);
              return;
            }
            block.querySelectorAll('a[href]').forEach(a => {
              if (!isElementVisible(a)) return;
              tryAdd(toUrlString(a.getAttribute('href')) || toUrlString(a.href), a);
            });
          } catch { /* ignore */ }
        });
      } catch { /* ignore */ }
    }

    try {
      document.querySelectorAll('[aria-label]').forEach(el => {
        try {
          const label = (el.getAttribute('aria-label') || '').trim().toLowerCase();
          if (!/^(сайт|website|site)\s*:?\s*$/.test(label)) return;
          const a = el.querySelector('a[href]') || (el.parentElement && el.parentElement.querySelector('a[href]'));
          if (!a || !isElementVisible(a)) return;
          tryAdd(toUrlString(a.getAttribute('href')) || toUrlString(a.href), a);
        } catch { /* ignore */ }
      });
    } catch { /* ignore */ }

    try {
      document.querySelectorAll('a[href]').forEach(a => {
        try {
          if (!isElementVisible(a)) return;
          const rawHref = toUrlString(a.getAttribute('href')) || toUrlString(a.href);
          if (!rawHref || !/^(https?:|\/away|\/dk|.*:\/\/)/i.test(rawHref)) return;
          const before = getTextBeforeElement(a, 3);
          if (!before) return;
          const tail = before.length > 200 ? before.slice(-200) : before;
          if (!SITE_LABEL_REGEX.test(tail)) return;
          const afterLabel = tail.replace(SITE_LABEL_REGEX, '').replace(/[\s\u00A0:]+/g, '');
          if (afterLabel.length > 0) return;
          tryAdd(rawHref, a);
        } catch { /* ignore */ }
      });
    } catch { /* ignore */ }

    return results;
  }

  function computeHash(items) {
    let hash = 0;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      let key = item.network;
      if (item.url) key += item.url;
      else if (item.phone) key += item.phone.phone;
      else if (item.email) key += item.email.email;
      else if (item.inn) key += item.inn.value;
      else if (item.ogrn) key += item.ogrn.value;
      for (let j = 0; j < key.length; j++) hash = ((hash << 5) - hash + key.charCodeAt(j)) | 0;
    }
    return hash;
  }

  async function detectSocialNetworks(forceRefresh) {
    const now = Date.now();
    if (!forceRefresh && cachedResults && (now - cacheTimestamp) < CACHE_CONFIG.ttl) return cachedResults;

    let results = [];
    try {
      let currentDomain = getCurrentDomain();
      let siteName = currentDomain.replace(/^www\./, '').replace(/\..*$/, '');
      let isMain = isMainDomain(currentDomain);
      let currentNetwork = getSocialNetworkByDomain(currentDomain);
      let currentBooking = getBookingServiceByDomain(currentDomain);

      let links = getAllLinks();
      let seenUrls = new Map();
      let socialUrls = [];

      links.forEach(link => {
        try {
          let domain = getDomainFromUrl(link);
          let network = getSocialNetworkByDomain(domain);
          let bookingService = getBookingServiceByDomain(domain);
          if (network && currentNetwork && network === currentNetwork) return;
          if (network) {
            if (isJunkLink(link, network)) return;
            let isSiteSocial = false;
            if (isMain) isSiteSocial = isLinkBelongsToSite(link, siteName);
            let normalized = normalizeUrl(link);
            const canonical = canonicalizeSocialUrl(normalized, network);
            if (!seenUrls.has(canonical)) {
              seenUrls.set(canonical, link);
              socialUrls.push(link);
              results.push({ url: normalized, network: network, isDirect: isSiteSocial });
            }
            return;
          }
          if (bookingService) {
            if (currentBooking && bookingService === currentBooking) return;
            let normalized = normalizeUrl(link);
            if (!seenUrls.has(normalized)) {
              seenUrls.set(normalized, link);
              results.push({ url: normalized, network: bookingService, isDirect: false, isBooking: true });
            }
          }
        } catch { /* ignore */ }
      });

      try {
        const siteItems = collectSiteUrls();
        for (let i = 0; i < siteItems.length; i++) {
          const s = siteItems[i];
          const normalized = normalizeUrl(s.url);
          const canonical = 'website:' + normalized;
          if (seenUrls.has(canonical)) continue;
          seenUrls.set(canonical, s.url);
          results.push({ url: normalized, network: 'website', isDirect: false, element: s.element });
        }
      } catch { /* ignore */ }

      let collected = { phones: [], emails: [], inns: [], ogrns: [] };
      try { collected = collectAllData(); } catch { /* ignore */ }

      collected.phones.forEach(phone => results.push({ url: null, phone, network: 'phone', isDirect: false }));
      collected.emails.forEach(email => results.push({ url: null, email, network: 'email', isDirect: false }));
      collected.inns.forEach(inn => results.push({ url: null, inn, network: 'inn', isDirect: false }));
      collected.ogrns.forEach(ogrn => results.push({ url: null, ogrn, network: ogrn.network, isDirect: false }));

      results.sort((a, b) => {
        if (a.isDirect === b.isDirect) return 0;
        return a.isDirect ? -1 : 1;
      });
    } catch { /* ignore */ }

    cachedResults = results;
    cacheTimestamp = now;
    return results;
  }

  async function updateBadge(items) {
    if (!badgeEl) return;
    if (!items) { try { items = await detectSocialNetworks(); } catch { items = []; } }
    const count = items ? items.length : 0;
    badgeEl.textContent = count > 0 ? String(count) : '0';
    if (typeof chrome === 'undefined' || !chrome.runtime?.id) return;
    try { chrome.runtime.sendMessage({ action: "updateBadge", count }); } catch { /* invalidated */ }
  }

  function openFeedbackEmail() {
    isFeedbackClicking = true;
    const host = window.location.hostname;
    const body = ['Привет!', '', '📌 Сайт: ' + host, '', '📝 Опишите, что не работает или что можно улучшить:', '', '---', 'Отправлено через расширение LinkRadar'].join('\n');
    const href = 'mailto:' + FEEDBACK_EMAIL + '?subject=' + encodeURIComponent(FEEDBACK_SUBJECT) + '&body=' + encodeURIComponent(body);
    const a = document.createElement('a');
    a.href = href; a.style.display = 'none';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    setTimeout(() => { isFeedbackClicking = false; }, 2000);
  }

  const SHADOW_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .lr-root { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; display: flex; flex-direction: column; align-items: flex-end; pointer-events: none; }
    .lr-badge { display: flex; align-items: center; justify-content: center; font-weight: 700; color: #fff; cursor: pointer; border: 2px solid rgba(255, 255, 255, 0.2); transition: transform 0.15s, box-shadow 0.15s; user-select: none; text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2); pointer-events: auto; position: relative; z-index: 10; }
    .lr-window { background: #fff; overflow: hidden; box-shadow: 0 8px 28px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05); transition: max-height 0.25s ease, opacity 0.2s ease, margin-top 0.25s ease; opacity: 0; display: flex; flex-direction: column; color: #1f2937; pointer-events: auto; margin-top: 0; align-self: flex-end; max-height: 0; }
    .lr-header { padding: 14px 16px; background: #f5f5f5; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid #e5e7eb; }
    .lr-header-left { display: flex; align-items: center; gap: 12px; }
    .lr-title { font-size: 14px; color: #00a550; font-weight: 700; }
    .lr-feedback { font-size: 11px; color: #6b7280; text-decoration: none; transition: color 0.2s; cursor: pointer; }
    .lr-feedback:hover { color: #00a550; }
    .lr-links { overflow-y: auto; max-height: 400px; padding: 12px; background: #fff; }
    .lr-empty { text-align: center; padding: 40px 20px; color: #9ca3af; font-size: 13px; }
    .lr-more { text-align: center; padding: 12px; margin-top: 4px; background: #f3f4f6; border-radius: 12px; cursor: pointer; font-size: 13px; color: #3b82f6; font-weight: 500; transition: 0.15s; border: 1px solid #e5e7eb; }
    .lr-more:hover { background: #e5e7eb; }
    .lr-card { margin-bottom: 8px; border-radius: 12px; display: flex; justify-content: space-between; align-items: stretch; overflow: hidden; border: 2px solid #e5e7eb; transition: all 0.12s; }
    .lr-card-left { display: flex; align-items: center; gap: 10px; flex: 1; padding: 10px 12px; cursor: pointer; min-width: 140px; }
    .lr-card-right { display: flex; align-items: center; justify-content: center; padding: 10px 14px; background: #f9fafb; border-left: 1px solid #e5e7eb; flex-shrink: 0; }
    .lr-icon { width: 32px; height: 32px; border-radius: 10px; display: flex; align-items: center; justify-content: center; font-size: 16px; flex-shrink: 0; color: #fff; }
    .lr-card-text { overflow: hidden; flex: 1; }
    .lr-card-title { font-size: 12px; font-weight: 600; color: #1f2937; }
    .lr-card-sub { font-size: 9px; color: #6b7280; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .lr-copy { display: inline-block; background: #00a550; border: none; padding: 6px 14px; border-radius: 20px; color: #fff; font-size: 10px; font-family: inherit; font-weight: 600; cursor: pointer; white-space: nowrap; min-height: 28px; user-select: none; transition: background 0.15s, transform 0.08s; }
    .lr-copy:active { transform: scale(0.95); }
    ::-webkit-scrollbar { width: 6px; height: 6px; }
    ::-webkit-scrollbar-track { background: #f0f0f0; border-radius: 10px; }
    ::-webkit-scrollbar-thumb { background: #00a550; border-radius: 10px; }
    ::-webkit-scrollbar-thumb:hover { background: #008844; }
  `;

  function el(tag, cssText, text) {
    const node = document.createElement(tag);
    if (cssText) node.style.cssText = cssText;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function makeCopyButton(value) {
    const btn = el('button', '', 'Копировать');
    btn.className = 'lr-copy';
    let isClicked = false;
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      if (isClicked) return;
      isClicked = true;
      if (btn._copyTimer) { clearTimeout(btn._copyTimer); btn._copyTimer = null; }
      const old = btn.textContent;
      btn.textContent = 'Копировать';
      const ok = await copyToClipboard(value);
      if (ok) { btn.textContent = '✓'; btn.style.background = '#059669'; }
      else { btn.textContent = '✗'; btn.style.background = '#dc2626'; }
      btn._copyTimer = setTimeout(() => {
        btn.textContent = old;
        btn.style.background = '#00a550';
        btn._copyTimer = null;
        isClicked = false;
      }, TIMINGS.copyButtonFeedback);
    });
    return btn;
  }

  function createDataCard(item) {
    const meta = CARD_META[item.network];
    if (!meta) return null;
    const isVerified = meta.isVerified(item);
    const borderColor = isVerified ? meta.verifiedBorder : '#e5e7eb';
    const bgColor = isVerified ? meta.verifiedBg : '#f9fafb';
    const starIcon = isVerified ? '⭐ ' : '';
    const title = starIcon + meta.getTitle(item);
    const subtitle = meta.getSubtitle ? meta.getSubtitle(item) : null;
    const copyValue = meta.getCopyValue(item);

    const card = el('div', `background:${bgColor};border-color:${borderColor};`);
    card.className = 'lr-card';
    const left = el('div', '');
    left.className = 'lr-card-left';
    left.addEventListener('click', () => meta.highlight(item));

    if (isVerified) {
      left.addEventListener('mouseenter', () => { card.style.borderColor = meta.verifiedHoverBorder; card.style.background = meta.verifiedHoverBg; });
      left.addEventListener('mouseleave', () => { card.style.borderColor = meta.verifiedBorder; card.style.background = meta.verifiedBg; });
    } else if (meta.nonVerifiedHoverBorder) {
      left.addEventListener('mouseenter', () => { card.style.borderColor = meta.nonVerifiedHoverBorder; card.style.background = meta.nonVerifiedHoverBg; });
      left.addEventListener('mouseleave', () => { card.style.borderColor = '#e5e7eb'; card.style.background = '#f9fafb'; });
    }

    let iconColor = '#00a550';
    if (item.network === 'email') iconColor = '#f59e0b';
    if (item.network === 'phone') iconColor = '#3b82f6';
    if (item.network === 'inn') iconColor = '#8b5cf6';
    if (item.network === 'ogrn') iconColor = '#ec4899';
    if (item.network === 'ogrnip') iconColor = '#f59e0b';

    const icon = el('div', `background:${iconColor};`, meta.icon);
    icon.className = 'lr-icon';
    const textBox = el('div', '');
    textBox.className = 'lr-card-text';
    const titleEl = el('div', '', title);
    titleEl.className = 'lr-card-title';
    textBox.appendChild(titleEl);
    if (subtitle) {
      const subEl = el('div', '', subtitle);
      subEl.className = 'lr-card-sub';
      textBox.appendChild(subEl);
    }
    left.appendChild(icon); left.appendChild(textBox);

    const right = el('div', '');
    right.className = 'lr-card-right';
    right.appendChild(makeCopyButton(copyValue));
    card.appendChild(left); card.appendChild(right);
    return card;
  }

  function createSocialCard(item) {
    const icon = SOCIAL_ICONS[item.network] || '🌐';
    const color = SOCIAL_COLORS[item.network] || '#00a550';
    const isDirect = item.isDirect;
    const borderColor = isDirect ? '#00a550' : '#e5e7eb';
    const bgColor = isDirect ? '#f0fdf4' : '#f9fafb';
    const starIcon = isDirect ? '⭐ ' : '';

    const card = el('div', `background:${bgColor};border-color:${borderColor};`);
    card.className = 'lr-card';
    const left = el('div', '');
    left.className = 'lr-card-left';
    left.addEventListener('click', () => window.open(item.url, '_blank', 'noopener,noreferrer'));
    if (!isDirect) {
      left.addEventListener('mouseenter', () => { card.style.borderColor = '#00a550'; card.style.background = '#f0fdf4'; });
      left.addEventListener('mouseleave', () => { card.style.borderColor = '#e5e7eb'; card.style.background = '#f9fafb'; });
    }
    const iconBox = el('div', `background:${color};`, icon);
    iconBox.className = 'lr-icon';
    const textBox = el('div', '');
    textBox.className = 'lr-card-text';
    const title = el('div', '', starIcon + item.network);
    title.className = 'lr-card-title';
    title.style.textTransform = 'capitalize';
    const urlLine = el('div', '', item.url.length > 65 ? item.url.slice(0, 65) + '…' : item.url);
    urlLine.className = 'lr-card-sub';
    urlLine.title = item.url;
    textBox.appendChild(title); textBox.appendChild(urlLine);
    left.appendChild(iconBox); left.appendChild(textBox);
    const right = el('div', '');
    right.className = 'lr-card-right';
    right.appendChild(makeCopyButton(getCopyPath(item.url)));
    card.appendChild(left); card.appendChild(right);
    return card;
  }

  function createBookingCard(item) {
    const icon = BOOKING_ICONS[item.network] || '🗓️';
    const color = BOOKING_COLORS[item.network] || '#00a550';
    const name = BOOKING_NAMES[item.network] || item.network;
    const card = el('div', 'background:#f9fafb;border-color:#e5e7eb;');
    card.className = 'lr-card';
    const left = el('div', '');
    left.className = 'lr-card-left';
    left.addEventListener('click', () => window.open(item.url, '_blank', 'noopener,noreferrer'));
    left.addEventListener('mouseenter', () => { card.style.borderColor = '#00a550'; card.style.background = '#f0fdf4'; });
    left.addEventListener('mouseleave', () => { card.style.borderColor = '#e5e7eb'; card.style.background = '#f9fafb'; });
    const iconBox = el('div', `background:${color};`, icon);
    iconBox.className = 'lr-icon';
    const textBox = el('div', '');
    textBox.className = 'lr-card-text';
    const title = el('div', '', name);
    title.className = 'lr-card-title';
    const urlLine = el('div', '', item.url.length > 65 ? item.url.slice(0, 65) + '…' : item.url);
    urlLine.className = 'lr-card-sub';
    urlLine.title = item.url;
    textBox.appendChild(title); textBox.appendChild(urlLine);
    left.appendChild(iconBox); left.appendChild(textBox);
    const right = el('div', '');
    right.className = 'lr-card-right';
    right.appendChild(makeCopyButton(item.url));
    card.appendChild(left); card.appendChild(right);
    return card;
  }

  function createWebsiteCard(item) {
    let domain = '';
    try { domain = new URL(item.url).hostname.replace(/^www\./, ''); } catch { domain = item.url; }
    const card = el('div', 'background:#f0fdf4;border-color:#00a550;');
    card.className = 'lr-card';
    const left = el('div', '');
    left.className = 'lr-card-left';
    left.addEventListener('click', () => window.open(item.url, '_blank', 'noopener,noreferrer'));
    left.addEventListener('mouseenter', () => { card.style.borderColor = '#008844'; card.style.background = '#e6f7e6'; });
    left.addEventListener('mouseleave', () => { card.style.borderColor = '#00a550'; card.style.background = '#f0fdf4'; });
    const iconBox = el('div', 'background:#0ea5e9;', '🌐');
    iconBox.className = 'lr-icon';
    const textBox = el('div', '');
    textBox.className = 'lr-card-text';
    const title = el('div', '', 'Сайт: ' + domain);
    title.className = 'lr-card-title';
    const sub = el('div', '', item.url.length > 65 ? item.url.slice(0, 65) + '…' : item.url);
    sub.className = 'lr-card-sub';
    sub.title = item.url;
    textBox.appendChild(title); textBox.appendChild(sub);
    left.appendChild(iconBox); left.appendChild(textBox);
    const right = el('div', '');
    right.className = 'lr-card-right';
    right.appendChild(makeCopyButton(item.url));
    card.appendChild(left); card.appendChild(right);
    return card;
  }

  function createCard(item) {
    if (CARD_META[item.network]) return createDataCard(item);
    if (item.network === 'website') return createWebsiteCard(item);
    if (item.isBooking) return createBookingCard(item);
    return createSocialCard(item);
  }

  function removeOrphanPanel() {
    const orphan = document.getElementById('linkRadarPanel');
    if (orphan && orphan !== panel) { orphan.remove(); return true; }
    return false;
  }

  function createPanel() {
    removeOrphanPanel();
    if (panel) return;

    panel = document.createElement('div');
    panel.id = 'linkRadarPanel';
    panel.style.cssText = `position: fixed; z-index: 2147483647; top: 80px; right: 20px; pointer-events: none;`;

    const shadow = panel.attachShadow({ mode: 'closed' });
    panelShadowRoot = shadow;

    const style = document.createElement('style');
    style.textContent = SHADOW_CSS;
    shadow.appendChild(style);

    const root = document.createElement('div');
    root.className = 'lr-root';
    shadow.appendChild(root);

    const badgeSize = PANEL_CONFIG.badgeSize;
    const badgeSizeNum = parseInt(badgeSize);
    const badgeFont = badgeSizeNum >= 48 ? '16px' : '14px';

    badgeEl = document.createElement('div');
    badgeEl.className = 'lr-badge';
    badgeEl.style.cssText = `
      width: ${badgeSize}; height: ${badgeSize};
      background: ${PANEL_CONFIG.badgeColor}; border-radius: 50%;
      font-size: ${badgeFont};
      box-shadow: 0 4px 16px rgba(0, 165, 80, 0.3);
      margin-bottom: ${-badgeSizeNum / 2}px;
    `;
    badgeEl.textContent = '0';

    badgeEl.addEventListener('mouseenter', () => {
      badgeEl.style.transform = 'scale(1.05)';
      badgeEl.style.boxShadow = '0 6px 24px rgba(0, 165, 80, 0.5)';
    });
    badgeEl.addEventListener('mouseleave', () => {
      badgeEl.style.transform = 'scale(1)';
      badgeEl.style.boxShadow = '0 4px 16px rgba(0, 165, 80, 0.3)';
    });

    badgeEl.addEventListener('click', (e) => {
      if (isDraggingPanel) { isDraggingPanel = false; return; }
      e.stopPropagation();
      toggleWindow();
    });

    let dragStartX = 0, dragStartY = 0, dragStartLeft = 0, dragStartTop = 0;
    badgeEl.addEventListener('mousedown', (e) => {
      isDraggingPanel = false;
      const rect = panel.getBoundingClientRect();
      dragStartX = e.clientX; dragStartY = e.clientY;
      dragStartLeft = rect.left; dragStartTop = rect.top;
      e.preventDefault();

      const onMove = (ev) => {
        const dx = ev.clientX - dragStartX;
        const dy = ev.clientY - dragStartY;
        if (Math.abs(dx) > TIMINGS.dragThreshold || Math.abs(dy) > TIMINGS.dragThreshold) {
          isDraggingPanel = true;
          panel.style.left = (dragStartLeft + dx) + 'px';
          panel.style.top = (dragStartTop + dy) + 'px';
          panel.style.right = 'auto';
        }
      };

      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    root.appendChild(badgeEl);

    windowEl = document.createElement('div');
    windowEl.className = 'lr-window';
    windowEl.style.width = PANEL_CONFIG.windowWidth;
    windowEl.style.borderRadius = PANEL_CONFIG.borderRadius;

    const header = document.createElement('div');
    header.className = 'lr-header';
    header.style.borderRadius = `${PANEL_CONFIG.borderRadius} ${PANEL_CONFIG.borderRadius} 0 0`;

    const headerLeft = document.createElement('div');
    headerLeft.className = 'lr-header-left';

    panelTitleEl = document.createElement('strong');
    panelTitleEl.className = 'lr-title';
    panelTitleEl.textContent = 'LinkRadar';

    feedbackLinkEl = document.createElement('a');
    feedbackLinkEl.className = 'lr-feedback';
    feedbackLinkEl.href = '#';
    feedbackLinkEl.textContent = 'Нашли ошибку?';
    feedbackLinkEl.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      openFeedbackEmail();
    });

    headerLeft.appendChild(panelTitleEl);
    headerLeft.appendChild(feedbackLinkEl);
    header.appendChild(headerLeft);

    linksContainerEl = document.createElement('div');
    linksContainerEl.className = 'lr-links';
    linksContainerEl.style.borderRadius = `0 0 ${PANEL_CONFIG.borderRadius} ${PANEL_CONFIG.borderRadius}`;

    windowEl.appendChild(header);
    windowEl.appendChild(linksContainerEl);
    root.appendChild(windowEl);
    document.body.appendChild(panel);

    isPanelOpen = true;
    windowEl.style.maxHeight = PANEL_CONFIG.windowMaxHeight;
    windowEl.style.opacity = '1';
    windowEl.style.marginTop = '8px';

    cachedResults = null;
    cacheTimestamp = 0;

    (async () => {
      let items;
      try { items = await detectSocialNetworks(true); } catch { items = []; }
      updateBadge(items);
      renderLinks(false, items);
    })();
    startObserver();
  }

  function toggleWindow() {
    if (!windowEl) return;
    if (!isPanelOpen) {
      windowEl.style.maxHeight = PANEL_CONFIG.windowMaxHeight;
      windowEl.style.opacity = '1';
      windowEl.style.marginTop = '8px';
      isPanelOpen = true;
      cancelRender = false;

      cachedResults = null;
      cacheTimestamp = 0;

      (async () => {
        let items;
        try { items = await detectSocialNetworks(true); } catch { items = []; }
        updateBadge(items);
        renderLinks(false, items);
      })();
      startObserver();
    } else {
      windowEl.style.maxHeight = '0';
      windowEl.style.opacity = '0';
      windowEl.style.marginTop = '0';
      isPanelOpen = false;
      cancelRender = true;
      renderToken++;
      stopObserver();
    }
  }

  async function renderLinks(forceRefresh, items) {
    if (!linksContainerEl) return;

    const myToken = ++renderToken;
    cancelRender = true;

    await new Promise(resolve => setTimeout(resolve, TIMINGS.renderStartDelay));
    if (myToken !== renderToken) return;
    cancelRender = false;

    if (!items) {
      try { items = await detectSocialNetworks(forceRefresh); } catch { items = []; }
    }
    if (myToken !== renderToken || cancelRender) return;
    if (!linksContainerEl) return;
    if (!items) items = [];

    linksContainerEl.textContent = '';

    if (items.length === 0) {
      const empty = el('div', '', '🔍 Ничего не найдено');
      empty.className = 'lr-empty';
      linksContainerEl.appendChild(empty);
      return;
    }

    const totalItems = items.length;
    const showItems = Math.min(totalItems, CACHE_CONFIG.maxItems);
    const hasMore = totalItems > CACHE_CONFIG.maxItems;

    const fragment = document.createDocumentFragment();
    let currentIndex = 0;

    function renderChunk() {
      if (myToken !== renderToken) return;
      if (cancelRender) return;
      if (!linksContainerEl) return;

      const end = Math.min(currentIndex + CACHE_CONFIG.chunkSize, showItems);
      for (let i = currentIndex; i < end; i++) {
        const card = createCard(items[i]);
        if (card) fragment.appendChild(card);
      }
      currentIndex = end;

      if (currentIndex < showItems) {
        requestAnimationFrame(renderChunk);
      } else {
        if (myToken !== renderToken || cancelRender) return;
        if (!linksContainerEl) return;
        linksContainerEl.appendChild(fragment);

        if (hasMore && !cancelRender) {
          const moreBtn = el('div', '', `Показать ещё ${totalItems - CACHE_CONFIG.maxItems} →`);
          moreBtn.className = 'lr-more';
          moreBtn.addEventListener('click', () => {
            const btnToken = ++renderToken;
            cancelRender = true;
            setTimeout(() => {
              if (btnToken !== renderToken) return;
              if (!linksContainerEl) return;
              cancelRender = false;
              linksContainerEl.textContent = '';
              const allFragment = document.createDocumentFragment();
              let idx = 0;

              function renderAllChunk() {
                if (btnToken !== renderToken) return;
                if (cancelRender) return;
                if (!linksContainerEl) return;

                const end = Math.min(idx + CACHE_CONFIG.chunkSize, totalItems);
                for (let i = idx; i < end; i++) {
                  const card = createCard(items[i]);
                  if (card) allFragment.appendChild(card);
                }
                idx = end;

                if (idx < totalItems) {
                  requestAnimationFrame(renderAllChunk);
                } else {
                  if (btnToken !== renderToken || cancelRender) return;
                  if (linksContainerEl) linksContainerEl.appendChild(allFragment);
                }
              }
              requestAnimationFrame(renderAllChunk);
            }, TIMINGS.moreButtonDelay);
          });
          linksContainerEl.appendChild(moreBtn);
        }
      }
    }

    requestAnimationFrame(renderChunk);
  }

  function isOurMutation(mutation) {
    const target = mutation.target;
    if (target === panel) return true;
    if (mutation.type === 'childList') {
      const added = mutation.addedNodes;
      for (let i = 0; i < added.length; i++) {
        if (added[i] === panel) return true;
      }
      const removed = mutation.removedNodes;
      for (let i = 0; i < removed.length; i++) {
        if (removed[i] === panel) return true;
      }
    }
    return false;
  }

  // FIX: добавлены селекторы соцсетевых ссылок — на SPA (Vue/React) кнопки
  // WhatsApp/Telegram/VK дорисовываются после открытия панели, и раньше
  // observer не понимал, что появились новые данные.
  function mutationsCouldAddData(mutations) {
    for (let i = 0; i < mutations.length; i++) {
      const m = mutations[i];
      if (m.type !== 'childList') continue;
      const added = m.addedNodes;
      for (let j = 0; j < added.length; j++) {
        const node = added[j];
        if (node.nodeType !== 1) continue;
        try {
          if (node.matches && node.matches(
            'a[href^="tel:"], a[href^="mailto:"], ' +
            'a[href*="wa.me"], a[href*="api.whatsapp.com"], a[href*="whatsapp.com"], ' +
            'a[href*="t.me"], a[href*="telegram.me"], a[href*="telegram.org"], ' +
            'a[href*="vk.com"], a[href*="vk.ru"], a[href*="vkontakte.ru"], ' +
            'a[href*="ok.ru"], a[href*="odnoklassniki.ru"], ' +
            'a[href*="youtube.com"], a[href*="youtu.be"], ' +
            'a[href*="instagram.com"], a[href*="tiktok.com"], ' +
            'a[href*="dzen.ru"], a[href*="zen.yandex"], ' +
            'a[href*="rutube.ru"], a[href*="max.ru"], ' +
            'a[href*="viber.com"], a[href*="skype.com"], ' +
            '[data-phone], [data-tel], [data-number], [data-contact], ' +
            '[data-email], [data-mail], [data-contact-email], ' +
            '[data-inn], [data-innfl], [data-innul], ' +
            '[data-ogrn], [data-ogrnip], [data-ogrnul], [data-list]'
          )) return true;

          if (node.querySelector && node.querySelector(
            'a[href^="tel:"], a[href^="mailto:"], ' +
            'a[href*="wa.me"], a[href*="api.whatsapp.com"], a[href*="whatsapp.com"], ' +
            'a[href*="t.me"], a[href*="telegram.me"], ' +
            'a[href*="vk.com"], a[href*="vk.ru"], a[href*="ok.ru"], ' +
            'a[href*="youtube.com"], a[href*="youtu.be"], ' +
            'a[href*="instagram.com"], a[href*="tiktok.com"], ' +
            'a[href*="dzen.ru"], a[href*="zen.yandex"], ' +
            '[data-phone], [data-email], [data-inn], [data-ogrn], [data-list]'
          )) return true;

          const siteSel = SITE_BLOCK_SELECTORS.join(', ');
          if (node.matches && siteSel && node.matches(siteSel)) return true;
          if (node.querySelector && siteSel && node.querySelector(siteSel)) return true;

          if (node.matches && node.matches('[aria-label]')) {
            const label = (node.getAttribute('aria-label') || '').trim().toLowerCase();
            if (/^(сайт|website|site)\s*:?\s*$/.test(label)) return true;
          }
          if (node.querySelector) {
            const labeled = node.querySelector('[aria-label]');
            if (labeled) {
              const label = (labeled.getAttribute('aria-label') || '').trim().toLowerCase();
              if (/^(сайт|website|site)\s*:?\s*$/.test(label)) return true;
            }
          }

          if (node.querySelectorAll && node.querySelectorAll('a[href]').length > 0) {
            const links = node.querySelectorAll('a[href]');
            for (let k = 0; k < links.length && k < 10; k++) {
              const a = links[k];
              const before = getTextBeforeElement(a, 3);
              if (!before) continue;
              const tail = before.length > 200 ? before.slice(-200) : before;
              if (SITE_LABEL_REGEX.test(tail)) {
                const afterLabel = tail.replace(SITE_LABEL_REGEX, '').replace(/[\s\u00A0:]+/g, '');
                if (afterLabel.length === 0) return true;
              }
            }
          }

          if (isInGeoContext(node)) continue;

          const t = node.textContent || '';
          if (t.length > 0 && t.length < 5000) {
            if (t.indexOf('@') !== -1) return true;
            let digits = 0;
            for (let k = 0; k < t.length && digits < 7; k++) {
              const c = t.charCodeAt(k);
              if (c >= 48 && c <= 57) digits++;
            }
            if (digits >= 7) return true;

            if (t.length < 3000 && LOCAL_PHONE_LABEL_REGEX.test(t)) return true;

            try {
              if (node.classList && node.classList.length > 0) {
                for (let k = 0; k < node.classList.length; k++) {
                  if (LOCAL_PHONE_CLASS_REGEX.test(node.classList[k])) return true;
                }
              }
              const id = String(node.id || '');
              if (id && LOCAL_PHONE_CLASS_REGEX.test(id)) return true;
            } catch { /* ignore */ }
          }
        } catch { /* ignore */ }
      }
    }
    return false;
  }

  function startObserver() {
    if (observer) observer.disconnect();
    if (observerDebounceTimer) {
      clearTimeout(observerDebounceTimer);
      observerDebounceTimer = null;
    }

    observer = new MutationObserver((mutations) => {
      let hasRelevant = false;
      let couldAddData = false;

      for (let i = 0; i < mutations.length; i++) {
        if (isOurMutation(mutations[i])) continue;
        hasRelevant = true;
        if (!couldAddData && mutationsCouldAddData([mutations[i]])) couldAddData = true;
      }

      if (!hasRelevant) return;

      if (couldAddData) {
        cachedResults = null;
        cacheTimestamp = 0;
      }

      clearTimeout(observerDebounceTimer);
      observerDebounceTimer = setTimeout(async () => {
        let items;
        try { items = await detectSocialNetworks(); } catch { items = []; }
        const newHash = computeHash(items);
        if (newHash !== lastLinksHash) {
          lastLinksHash = newHash;
          await updateBadge(items);
          if (isPanelOpen) renderLinks(false, items);
        }
      }, TIMINGS.observerDebounce);
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  function stopObserver() {
    if (observer) { observer.disconnect(); observer = null; }
    if (observerDebounceTimer) {
      clearTimeout(observerDebounceTimer);
      observerDebounceTimer = null;
    }
  }

  function cleanupResources() {
    if (isFeedbackClicking) return;
    stopObserver();

    cachedResults = null;
    cacheTimestamp = 0;
    lastLinksHash = 0;
    cancelRender = true;
    renderToken++;

    if (panel) { panel.remove(); panel = null; }
    panelShadowRoot = null;
    badgeEl = null;
    windowEl = null;
    linksContainerEl = null;
    panelTitleEl = null;
    feedbackLinkEl = null;
    isPanelOpen = false;

    clearHighlights('linkradar-phone-highlight');
    clearHighlights('linkradar-email-highlight');
    clearHighlights('linkradar-verification-highlight');
  }

  function setupCleanup() {
    window.addEventListener('pagehide', () => cleanupResources());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopObserver();
      } else {
        if (!observer && panel && isPanelOpen) startObserver();
      }
    });
  }

  try {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === "ping") {
        sendResponse({ status: "alive" });
        return false;
      }
      if (message.action === "togglePanel") {
        if (isInternalDomain()) {
          sendResponse({ status: "blocked" });
          return false;
        }
        if (!panel) createPanel();
        else toggleWindow();
        sendResponse({ status: "ok" });
        return false;
      }
      sendResponse({ status: "unknown" });
      return false;
    });
  } catch { /* invalidated context */ }

  function init() {
    if (isInternalDomain()) {
      if (DEBUG) console.log('LinkRadar: внутренний домен');
      return;
    }
    removeOrphanPanel();
    setupCleanup();
    if (DEBUG) console.log('LinkRadar готов');
  }

  init();

})();
