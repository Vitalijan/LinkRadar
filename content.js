// content.js - LinkRadar beta 0.1.0
// Работает только по клику на иконку (инъекция через background.js).
// Без innerHTML, UI в Shadow DOM (closed), блокировка на внутренних доменах.
// Защита от повторной инициализации + удаление панели-сироты.
// Все ответы на onMessage — синхронные (return false).
// Защита от параллельного рендера через renderToken.
// MutationObserver фильтрует собственные мутации (isOurMutation).
// Кэш хеша результатов + isPanelOpen вместо style.maxHeight.
// TIMINGS для всех задержек. Feedback через <a>+click.
// TreeWalker для обхода DOM. Сохранение inline-стилей при подсветке.
// isLinkBelongsToSite — без includes (точное совпадение + 1-4 цифры).
// chrome.runtime?.id перед sendMessage. Копирование с фолбэком и ✗.
// getRootNode() !== document в forEachTextNode — O(1) вместо O(глубина).
// Панель создаётся сразу открытой. Observer стартует/стопает по isPanelOpen.
// updateBadge/renderLinks принимают готовый items (переиспользование результата).
// Явный сброс cancelRender в ветке открытия toggleWindow.
// addListener обёрнут в try/catch (invalidated context).
// STRICT+LOOSE regex для телефонов, processedElements Set вместо closest+findDeepest.
// ОДИН обход DOM для всех категорий через collectAllData().
// computeHash — инкрементальный hashCode. isOurMutation без panel.contains.
// MutationObserver без characterData.
// Единая фабрика createDataCard + CARD_META.
// COMMON_JUNK + Set для ALLOWED_EMAIL_DOMAINS.
// Комментарий к защите от дат. isLinkBelongsToSite без new RegExp.
// TEXT_URL_REGEX в константе. extractLinksFromElement без лишних аллокаций.
// clearHighlights без дублирования. applyHighlight сохраняет transition.
// Удалён мёртвый код: EXCLUDE_PATTERNS, PROFILE_PATTERNS, isDirectSocialLink.
// JUNK_PATTERNS — единый фильтр, расширен спецификой.
// getAllLinks: сужен SELECTORS.links, ранние выходы в extractLinksFromElement.
// getCopyPath — копирование соцсетей без доменной части (только путь).
// ВАЖНО (ИБ): расширение только ЗАПИСЫВАЕТ в буфер по клику пользователя.
//             navigator.clipboard.readText / execCommand('paste') не используются.
//             Никакой персистенции (chrome.storage, localStorage, IndexedDB) нет.
//             Кэш результатов — только in-memory, TTL 5 сек.
//             Shadow DOM — closed, страница не имеет доступа к shadowRoot.
//             fallbackCopy использует textarea внутри shadow root, не в document.body.

(function () {
  'use strict';

  // ============================================
  // 0. ЗАЩИТА ОТ ПОВТОРНОЙ ИНИЦИАЛИЗАЦИИ
  // ============================================

  if (window.__linkRadarInitialized) {
    return;
  }
  window.__linkRadarInitialized = true;

  // ============================================
  // 1. КОНФИГИ
  // ============================================

  const SOCIAL_ICONS = {
    vk: '🎧',
    ok: '👥',
    instagram: '📸',
    telegram: '✈️',
    youtube: '📺',
    rutube: '🎬',
    max: '🎬',
    tiktok: '🎵',
    twitter: '🐦',
    facebook: '📘',
    whatsapp: '💬',
    pinterest: '📌',
    linkedin: '🔗',
    viber: '📞',
    skype: '☎️'
  };

  const SOCIAL_COLORS = {
    vk: '#4680ff',
    ok: '#f58220',
    instagram: '#d62976',
    telegram: '#26A5E4',
    youtube: '#FF0000',
    rutube: '#0088cc',
    max: '#ff6b35',
    tiktok: '#010101',
    twitter: '#1DA1F2',
    facebook: '#1877F2',
    whatsapp: '#25D366',
    pinterest: '#E60023',
    linkedin: '#0A66C2',
    viber: '#7360F2',
    skype: '#00AFF0'
  };

  const SOCIAL_DOMAINS = {
    vk: ['vk.com', 'vk.ru', 'vkontakte.ru', 'vk.cc', 'vk.me'],
    ok: ['ok.ru', 'odnoklassniki.ru'],
    instagram: ['instagram.com', 'instagr.am', 'ig.me'],
    telegram: ['t.me', 'telegram.me', 'tg.me', 'telegram.org'],
    youtube: ['youtube.com', 'youtu.be'],
    rutube: ['rutube.ru'],
    max: ['max.ru'],
    tiktok: ['tiktok.com'],
    twitter: ['twitter.com', 'x.com'],
    facebook: ['facebook.com', 'fb.com', 'fb.me'],
    whatsapp: ['wa.me', 'whatsapp.com'],
    pinterest: ['pinterest.com'],
    linkedin: ['linkedin.com'],
    viber: ['viber.com'],
    skype: ['skype.com']
  };

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

  const COMMON_JUNK = [
    '/share', '/widget', '/like/', '/follow/',
    '/oauth/', '/login/', '/signup/', '/embed/',
    '/dev/', '/api/', '/stats/', '/analytics/',
    '/promo/', '/ads/', '/app/',
    '/support/', '/help/', '/about/', '/team/', '/jobs/', '/careers/', '/press/',
    '/blog/', '/news/', '/feed/', '/search/', '/explore/', '/trending/',
    '/settings/', '/privacy/', '/terms/'
  ];

  const JUNK_PATTERNS = {
    rutube: [...COMMON_JUNK, '/shorts/', '/video/', '/playlist/', '/catalog/', '/podcasts/'],
    youtube: [...COMMON_JUNK, '/shorts/', '/watch', '/playlist', '/results', '/music', '/gaming', '/sports'],
    vk: [...COMMON_JUNK, '/sticker/', '/stickers/', '/wall/', '/video', '/audio', '/photo', '/album/', '/clips/', '/images/'],
    ok: [...COMMON_JUNK, '/video', '/photo', '/album', '/games'],
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
    max: [...COMMON_JUNK, '/watch', '/tv', '/movies', '/series', '/sports']
  };

  const URL_PARAMS_TO_REMOVE = [
    'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
    'utm_id', 'utm_source_platform', 'utm_creative_format', 'utm_marketing_tactic',
    'fbclid', 'gclid', 'yclid', 'dclid', 'msclkid'
  ];

  const PHONE_REGEX_STRICT = /(?:\+7|8)[\s-]?\(?\d{3}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}/g;
  const PHONE_REGEX_LOOSE = /(?:\+?\d[\d\s-()]{7,20}\d)/g;

  const EMAIL_REGEX = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
  const INN_LABEL_REGEX = /ИНН\s*[:.]?\s*(\d{10}|\d{12})/gi;
  const OGRN_LABEL_REGEX = /ОГРН\s*[:.]?\s*(\d{13})/gi;
  const OGRNIP_LABEL_REGEX = /ОГРНИП\s*[:.]?\s*(\d{15})/gi;

  const TEXT_FILTER_REGEX = /[0-9@]|ИНН|ОГРН|инн|огрн/;
  const TEXT_URL_REGEX = /(https?:\/\/[^\s]+|(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s]*)?)/gi;

  const PANEL_CONFIG = {
    badgeSize: '48px',
    badgeColor: 'linear-gradient(135deg, #00a550, #008844)',
    windowWidth: '380px',
    windowMaxHeight: '520px',
    borderRadius: '16px',
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
  };

  const CACHE_CONFIG = {
    ttl: 5000,
    maxItems: 25,
    chunkSize: 5
  };

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
    links: [
      'a[href]',
      'iframe[src]',
      'embed[src]',
      'object[data]',
      '[data-url]',
      '[data-to]',
      '[data-link]',
      '[data-href]'
    ]
  };

  // ============================================
  // ДЕСКРИПТОР КАРТОЧЕК DATA-ТИПОВ
  // ============================================

  const CARD_META = {
    email: {
      icon: '✉️',
      baseColor: '#f59e0b',
      successColor: '#d97706',
      verifiedBaseColor: '#00a550',
      verifiedSuccessColor: '#059669',
      verifiedBorder: '#00a550',
      verifiedBg: '#f0fdf4',
      verifiedHoverBorder: '#008844',
      verifiedHoverBg: '#e6f7e6',
      nonVerifiedHoverBorder: '#00a550',
      nonVerifiedHoverBg: '#f0fdf4',
      getTitle: (item) => item.email.email,
      getSubtitle: () => null,
      getCopyValue: (item) => item.email.email,
      isVerified: (item) => !!item.email.isVerified,
      highlight: (item) => highlightEmailContainer(item.email)
    },
    phone: {
      icon: '📞',
      baseColor: '#3b82f6',
      successColor: '#2563eb',
      verifiedBaseColor: '#00a550',
      verifiedSuccessColor: '#059669',
      verifiedBorder: '#00a550',
      verifiedBg: '#f0fdf4',
      verifiedHoverBorder: '#008844',
      verifiedHoverBg: '#e6f7e6',
      nonVerifiedHoverBorder: '#00a550',
      nonVerifiedHoverBg: '#f0fdf4',
      getTitle: (item) => item.phone.display || item.phone.phone,
      getSubtitle: () => null,
      getCopyValue: (item) => item.phone.phone,
      isVerified: (item) => !!item.phone.isVerified,
      highlight: (item) => highlightPhoneContainer(item.phone)
    },
    inn: {
      icon: '🆔',
      baseColor: '#8b5cf6',
      successColor: '#7c3aed',
      verifiedBaseColor: '#8b5cf6',
      verifiedSuccessColor: '#7c3aed',
      verifiedBorder: '#8b5cf6',
      verifiedBg: '#f5f3ff',
      verifiedHoverBorder: '#7c3aed',
      verifiedHoverBg: '#ede9fe',
      nonVerifiedHoverBorder: null,
      nonVerifiedHoverBg: null,
      getTitle: (item) => item.inn.value,
      getSubtitle: (item) => item.inn.type,
      getCopyValue: (item) => item.inn.value,
      isVerified: (item) => !!item.inn.isVerified,
      highlight: (item) => {
        if (item.inn.element) highlightElement(item.inn.element, '#8b5cf6', item.inn.matchedText || item.inn.value);
      }
    },
    ogrn: {
      icon: '📋',
      baseColor: '#ec4899',
      successColor: '#db2777',
      verifiedBaseColor: '#ec4899',
      verifiedSuccessColor: '#db2777',
      verifiedBorder: '#ec4899',
      verifiedBg: '#fdf2f8',
      verifiedHoverBorder: '#db2777',
      verifiedHoverBg: '#fce7f3',
      nonVerifiedHoverBorder: null,
      nonVerifiedHoverBg: null,
      getTitle: (item) => item.ogrn.value,
      getSubtitle: (item) => item.ogrn.type,
      getCopyValue: (item) => item.ogrn.value,
      isVerified: (item) => !!item.ogrn.isVerified,
      highlight: (item) => {
        if (item.ogrn.element) highlightElement(item.ogrn.element, '#ec4899', item.ogrn.matchedText || item.ogrn.value);
      }
    },
    ogrnip: {
      icon: '👤',
      baseColor: '#f59e0b',
      successColor: '#d97706',
      verifiedBaseColor: '#f59e0b',
      verifiedSuccessColor: '#d97706',
      verifiedBorder: '#f59e0b',
      verifiedBg: '#fffbeb',
      verifiedHoverBorder: '#d97706',
      verifiedHoverBg: '#fef3c7',
      nonVerifiedHoverBorder: null,
      nonVerifiedHoverBg: null,
      getTitle: (item) => item.ogrn.value,
      getSubtitle: (item) => item.ogrn.type,
      getCopyValue: (item) => item.ogrn.value,
      isVerified: (item) => !!item.ogrn.isVerified,
      highlight: (item) => {
        if (item.ogrn.element) highlightElement(item.ogrn.element, '#f59e0b', item.ogrn.matchedText || item.ogrn.value);
      }
    }
  };

  // ============================================
  // КОНФИГ ОБРАТНОЙ СВЯЗИ И БЕЗОПАСНОСТИ
  // ============================================

  const FEEDBACK_EMAIL = 'v.cherednichenko@barnaul.2gis.ru';
  const FEEDBACK_SUBJECT = 'LinkRadar: обратная связь';

  const INTERNAL_DOMAIN_PATTERNS = [
    /(^|\.)2gis\./i,
    /\.local$/i,
    /\.corp$/i,
    /\.intranet$/i,
    /^localhost$/i,
    /^\d{1,3}(\.\d{1,3}){3}$/
  ];

  function isInternalDomain() {
    const host = window.location.hostname.toLowerCase();
    if (!host) return true;
    if (!host.includes('.')) return true;
    return INTERNAL_DOMAIN_PATTERNS.some(re => re.test(host));
  }

  // ============================================
  // 2. СОСТОЯНИЕ
  // ============================================

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

  // ============================================
  // 3. НОРМАЛИЗАЦИЯ
  // ============================================

  function normalizePhone(phone, isTel) {
    if (!phone) return null;
    let cleaned = phone.replace(/[^0-9]/g, '');

    if (isTel) {
      if (cleaned.length > 0) return cleaned;
      return null;
    }

    if (cleaned.length === 11) {
      if (cleaned.startsWith('8')) {
        cleaned = '7' + cleaned.slice(1);
      }
      if (!cleaned.startsWith('7')) return null;

      let secondDigit = cleaned[1];
      if (!['9', '3', '4', '8'].includes(secondDigit)) return null;
      if (['2', '6', '7'].includes(secondDigit)) return null;

      let cityCode = cleaned.slice(1, 4);
      let codeNum = parseInt(cityCode);

      if (secondDigit === '9') {
        // все 9XX валидны
      } else if (secondDigit === '3' || secondDigit === '4') {
        if (codeNum < 301 || codeNum > 499) return null;
      } else if (secondDigit === '8') {
        if (codeNum < 801 || codeNum > 899) return null;
      }

      const day = parseInt(cleaned.slice(2, 4));
      const month = parseInt(cleaned.slice(4, 6));
      const year = parseInt(cleaned.slice(6, 10));

      if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
        if (year >= 2020 && year <= 2030) return null;
      }

      return cleaned;
    }

    if (cleaned.length === 10) {
      let withCode = '7' + cleaned;
      let secondDigit = withCode[1];
      if (!['9', '3', '4', '8'].includes(secondDigit)) return null;
      if (['2', '6', '7'].includes(secondDigit)) return null;

      let cityCode = withCode.slice(1, 4);
      let codeNum = parseInt(cityCode);
      if (secondDigit === '3' || secondDigit === '4') {
        if (codeNum < 301 || codeNum > 499) return null;
      } else if (secondDigit === '8') {
        if (codeNum < 801 || codeNum > 899) return null;
      }

      return withCode;
    }

    return null;
  }

  function normalizeEmail(email, isMailto) {
    if (!email) return null;
    let trimmed = email.trim().toLowerCase();
    let emailRegex = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
    if (!emailRegex.test(trimmed)) return null;
    if (isMailto) return trimmed;

    let parts = trimmed.split('@');
    if (parts.length === 2) {
      let domain = parts[1];
      if (ALLOWED_EMAIL_DOMAINS.has(domain)) return trimmed;
    }
    return null;
  }

  function normalizeINN(inn) {
    if (!inn) return null;
    let cleaned = inn.replace(/[^0-9]/g, '');
    if (cleaned.length === 10 || cleaned.length === 12) return cleaned;
    return null;
  }

  function normalizeOGRN(ogrn) {
    if (!ogrn) return null;
    let cleaned = ogrn.replace(/[^0-9]/g, '');
    if (cleaned.length === 13 || cleaned.length === 15) return cleaned;
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

  function formatPhoneForDisplay(phone) {
    if (!phone) return phone;
    if (phone.length !== 11 && phone.length !== 10) return phone;
    if (phone.length === 11 && phone.startsWith('7')) {
      return `+7 (${phone.slice(1, 4)}) ${phone.slice(4, 7)}-${phone.slice(7, 9)}-${phone.slice(9, 11)}`;
    }
    if (phone.length === 10) {
      return `+7 (${phone.slice(0, 3)}) ${phone.slice(3, 6)}-${phone.slice(6, 8)}-${phone.slice(8, 10)}`;
    }
    return phone;
  }

  // ============================================
  // 4. TREE WALKER
  // ============================================

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
          if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT') {
            return NodeFilter.FILTER_REJECT;
          }

          if (parent.getRootNode() !== document) {
            return NodeFilter.FILTER_REJECT;
          }

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

  // ============================================
  // 5. ИЗВЛЕЧЕНИЕ ДАННЫХ ИЗ ТЕКСТА
  // ============================================

  function extractPhonesFromText(text) {
    const strictMatches = text.match(PHONE_REGEX_STRICT);
    if (strictMatches && strictMatches.length > 0) {
      return strictMatches;
    }

    let digitCount = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (c >= 48 && c <= 57) {
        digitCount++;
        if (digitCount >= 10) break;
      }
    }
    if (digitCount < 10) return [];

    return text.match(PHONE_REGEX_LOOSE) || [];
  }

  // ============================================
  // 6. СБОР ВСЕХ ДАННЫХ ЗА ОДИН ПРОХОД
  // ============================================

  function collectAllData(socialUrls) {
    const phonesSeen = new Map();
    const emailsSeen = new Map();
    const innsSeen = new Map();
    const ogrnsSeen = new Map();

    const excludePhones = new Set();

    const processedTel = new Set();
    const processedMailto = new Set();
    const processedINN = new Set();
    const processedOGRN = new Set();

    if (socialUrls) {
      socialUrls.forEach(url => {
        // 1. Извлекаем номер из параметра phone для api.whatsapp.com
        try {
          const u = new URL(url);
          const waPhone = u.searchParams.get('phone');
          if (waPhone) {
            const phone = normalizePhone(waPhone, false);
            if (phone) {
              addPhone(phone, null, waPhone, true, true);
            }
          }
        } catch { /* ignore */ }

        // 2. Извлекаем номер из пути wa.me/79991234567 и t.me/+79991234567
        const match = url.match(/(?:t\.me\/\+|wa\.me\/)(\d+)/);
        if (match) {
          const phone = normalizePhone(match[1], false);
          if (phone) {
            addPhone(phone, null, match[1], true, true);
          }
        }
      });
    }

    function addPhone(phone, element, text, isTel, isVerified, matchedText) {
      let normalizedForDedup = phone;
      if (isTel && phone.startsWith('8') && phone.length === 11) {
        normalizedForDedup = '7' + phone.slice(1);
      }
      if (excludePhones.has(normalizedForDedup)) return;

      const key = normalizedForDedup;
      if (!phonesSeen.has(key)) {
        phonesSeen.set(key, {
          phone: phone,
          element: element,
          text: text,
          matchedText: matchedText || text, // <-- сохраняем точный текст
          isTel: isTel,
          isVerified: isVerified || false,
          display: formatPhoneForDisplay(phone)
        });
      } else {
        const existing = phonesSeen.get(key);
        if (isVerified && !existing.isVerified) {
          existing.element = element;
          existing.isTel = true;
          existing.isVerified = true;
          existing.matchedText = matchedText || text;
        }
        if (isTel && !existing.isTel) {
          existing.element = element;
          existing.isTel = true;
          existing.isVerified = true;
          existing.matchedText = matchedText || text;
        }
      }
    }

    function addEmail(email, element, text, isMailto, isVerified, matchedText) {
      const key = email;
      if (!emailsSeen.has(key)) {
        emailsSeen.set(key, {
          email: email,
          element: element,
          text: text,
          matchedText: matchedText || text, // <-- сохраняем точный текст
          isMailto: isMailto,
          isVerified: isVerified || false
        });
      } else {
        const existing = emailsSeen.get(key);
        if (isVerified && !existing.isVerified) {
          existing.element = element;
          existing.isMailto = isMailto;
          existing.isVerified = true;
          existing.matchedText = matchedText || text;
        }
      }
    }

    function addINN(value, element, text, isVerified, type, matchedText) {
      const key = value + type;
      if (!innsSeen.has(key)) {
        innsSeen.set(key, {
          value: value,
          element: element,
          text: text,
          matchedText: matchedText || text, // <-- сохраняем точный текст
          type: type,
          isVerified: isVerified || false
        });
      } else {
        const existing = innsSeen.get(key);
        if (isVerified && !existing.isVerified) {
          existing.isVerified = true;
          existing.element = element;
          existing.matchedText = matchedText || text;
        }
      }
    }

    function addOGRN(value, element, text, isVerified, type, network, matchedText) {
      const key = value + type;
      if (!ogrnsSeen.has(key)) {
        ogrnsSeen.set(key, {
          value: value,
          element: element,
          text: text,
          matchedText: matchedText || text, // <-- сохраняем точный текст
          type: type,
          network: network,
          isVerified: isVerified || false
        });
      } else {
        const existing = ogrnsSeen.get(key);
        if (isVerified && !existing.isVerified) {
          existing.isVerified = true;
          existing.element = element;
          existing.matchedText = matchedText || text;
        }
      }
    }

    // 1. tel: ссылки
    document.querySelectorAll(SELECTORS.telLinks).forEach(el => {
      // Убираем все возможные префиксы tel: (бывает tel:tel:)
      const phone = el.href.replace(/^tel:/i, '').replace(/^tel:/i, '').trim();
      const normalized = normalizePhone(phone, true);
      if (normalized) addPhone(normalized, el, phone, true, true, phone);
    });

    // 2. mailto: ссылки
    document.querySelectorAll(SELECTORS.mailtoLinks).forEach(el => {
      // Убираем все возможные префиксы mailto: (бывает mailto:mailto:)
      const email = el.href.replace(/^mailto:/i, '').replace(/^mailto:/i, '').trim();
      const normalized = normalizeEmail(email, true);
      if (normalized) addEmail(normalized, el, email, true, true, email);
    });

    // 3. data-phone
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

    // 4. data-email
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

    // 5. data-inn
    document.querySelectorAll(SELECTORS.innDataAttrs).forEach(el => {
      processedINN.add(el);
      const dataAttrs = ['data-inn', 'data-innfl', 'data-innul'];
      for (const attr of dataAttrs) {
        const val = el.getAttribute(attr);
        if (val) {
          const normalized = normalizeINN(val);
          if (normalized && isValidINN(normalized)) {
            const type = normalized.length === 12 ? 'ИНН (физ.лицо)' : 'ИНН (юр.лицо)';
            addINN(normalized, el, val, true, type, val);
          }
        }
      }
    });

    // 6. data-ogrn
    document.querySelectorAll(SELECTORS.ogrnDataAttrs).forEach(el => {
      processedOGRN.add(el);
      const dataAttrs = ['data-ogrn', 'data-ogrnip', 'data-ogrnul'];
      for (const attr of dataAttrs) {
        const val = el.getAttribute(attr);
        if (val) {
          const normalized = normalizeOGRN(val);
          if (normalized) {
            const type = normalized.length === 15 ? 'ОГРНИП' : 'ОГРН';
            const network = normalized.length === 15 ? 'ogrnip' : 'ogrn';
            addOGRN(normalized, el, val, true, type, network, val);
          }
        }
      }
    });

    // 7. ОДИН TreeWalker для всего текстового контента
    const sets = {
      tel: processedTel,
      mailto: processedMailto,
      inn: processedINN,
      ogrn: processedOGRN
    };

    forEachTextNode(
      text => TEXT_FILTER_REGEX.test(text),
      (text, parent) => {
        const inProcessed = findProcessedTypes(parent, sets);
        if (inProcessed.tel && inProcessed.mailto && inProcessed.inn && inProcessed.ogrn) return;

        if (!inProcessed.tel && /\d/.test(text)) {
          const matches = extractPhonesFromText(text);
          if (matches && matches.length > 0) {
            for (const m of matches) {
              const normalized = normalizePhone(m, false);
              if (normalized) addPhone(normalized, parent, m.trim(), false, false, m.trim());
            }
          }
        }

        if (!inProcessed.mailto && text.indexOf('@') !== -1) {
          const matches = text.match(EMAIL_REGEX);
          if (matches) {
            for (const m of matches) {
              const normalized = normalizeEmail(m, false);
              if (normalized) addEmail(normalized, parent, m.trim(), false, false, m.trim());
            }
          }
        }

        if (!inProcessed.inn && /ИНН/i.test(text)) {
          const matches = text.match(INN_LABEL_REGEX);
          if (matches) {
            for (const m of matches) {
              const digits = m.replace(/[^0-9]/g, '');
              const normalized = normalizeINN(digits);
              if (normalized && isValidINN(normalized)) {
                const type = normalized.length === 12 ? 'ИНН (физ.лицо)' : 'ИНН (юр.лицо)';
                addINN(normalized, parent, m.trim(), false, type, m.trim());
              }
            }
          }
        }

        if (!inProcessed.ogrn && /ОГРН/i.test(text)) {
          const ogrnMatches = text.match(OGRN_LABEL_REGEX);
          if (ogrnMatches) {
            for (const m of ogrnMatches) {
              const digits = m.replace(/[^0-9]/g, '');
              const normalized = normalizeOGRN(digits);
              if (normalized) addOGRN(normalized, parent, m.trim(), false, 'ОГРН', 'ogrn', m.trim());
            }
          }

          const ogrnipMatches = text.match(OGRNIP_LABEL_REGEX);
          if (ogrnipMatches) {
            for (const m of ogrnipMatches) {
              const digits = m.replace(/[^0-9]/g, '');
              const normalized = normalizeOGRN(digits);
              if (normalized) addOGRN(normalized, parent, m.trim(), false, 'ОГРНИП', 'ogrnip', m.trim());
            }
          }
        }
      }
    );

    return {
      phones: Array.from(phonesSeen.values()),
      emails: Array.from(emailsSeen.values()),
      inns: Array.from(innsSeen.values()),
      ogrns: Array.from(ogrnsSeen.values())
    };
  }

  // ============================================
  // 7. ПОДСВЕТКА И ВЫДЕЛЕНИЕ ТЕКСТА
  // ============================================

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
      // Проходимся по всем текстовым узлам внутри элемента
      const walker = document.createTreeWalker(
        element,
        NodeFilter.SHOW_TEXT,
        null
      );

      let textNode;
      while ((textNode = walker.nextNode())) {
        const nodeText = textNode.nodeValue || '';
        const idx = nodeText.indexOf(searchText);
        if (idx !== -1) {
          // Нашли текст! Создаём Range
          const range = document.createRange();
          range.setStart(textNode, idx);
          range.setEnd(textNode, idx + searchText.length);

          const selection = window.getSelection();
          selection.removeAllRanges();
          selection.addRange(range);

          // Скроллим к выделению
          const rect = range.getBoundingClientRect();
          if (rect) {
            const y = rect.top + window.scrollY - window.innerHeight / 2;
            window.scrollTo({ top: y, behavior: 'smooth' });
          }

          // Снимаем выделение через 3 секунды
          setTimeout(() => {
            try {
              const sel = window.getSelection();
              if (sel && sel.rangeCount > 0) {
                sel.removeAllRanges();
              }
            } catch { /* ignore */ }
          }, TIMINGS.highlightDuration);

          return range;
        }
      }
    } catch { /* ignore */ }

    // Если не удалось найти точный текст — fallback: подсветить блок
    return null;
  }

  function applyHighlight(el, color, className, searchText) {
    if (!el) return;

    if (!el[HIGHLIGHT_STATE_KEY]) {
      el[HIGHLIGHT_STATE_KEY] = {
        background: el.style.background,
        border: el.style.border,
        borderRadius: el.style.borderRadius,
        boxShadow: el.style.boxShadow,
        transition: el.style.transition,
        timerId: null
      };
    }

    el.classList.add(className);
    el.style.transition = 'background 0.3s, border 0.3s, box-shadow 0.3s';
    el.style.background = `${color}20`;
    el.style.border = `2px solid ${color}`;
    el.style.borderRadius = '4px';
    el.style.boxShadow = `0 0 0 4px ${color}33`;

    // Пытаемся выделить точный текст через Range
    const range = searchText ? selectTextInElement(el, searchText) : null;

    // Если Range не сработал (текст разбит на куски), скроллим к блоку
    if (!range) {
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch { /* ignore */ }
    }

    if (el[HIGHLIGHT_STATE_KEY].timerId) {
      clearTimeout(el[HIGHLIGHT_STATE_KEY].timerId);
    }

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

  function highlightPhoneContainer(phoneData) {
    if (!phoneData || !phoneData.element) return;
    clearHighlights('linkradar-phone-highlight');
    applyHighlight(phoneData.element, '#3b82f6', 'linkradar-phone-highlight', phoneData.matchedText);
  }

  function highlightEmailContainer(emailData) {
    if (!emailData || !emailData.element) return;
    clearHighlights('linkradar-email-highlight');
    applyHighlight(emailData.element, '#f59e0b', 'linkradar-email-highlight', emailData.matchedText);
  }

  function highlightElement(el, color, searchText) {
    if (!el) return;
    clearHighlights('linkradar-verification-highlight');
    applyHighlight(el, color || '#00a550', 'linkradar-verification-highlight', searchText);
  }

  // ============================================
  // 8. БУФЕР ОБМЕНА
  // ============================================

  async function copyToClipboard(text) {
    if (navigator.clipboard && navigator.clipboard.writeText && window.isSecureContext) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch {
        // Падаем в fallback
      }
    }
    return fallbackCopy(text);
  }

  function fallbackCopy(text) {
    if (!panelShadowRoot) return false;

    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.top = '-9999px';
    textarea.style.left = '-9999px';
    textarea.style.opacity = '0';
    textarea.setAttribute('readonly', '');

    panelShadowRoot.appendChild(textarea);

    let ok;
    try {
      textarea.select();
      textarea.setSelectionRange(0, text.length);
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }

    textarea.value = '';
    panelShadowRoot.removeChild(textarea);
    return ok;
  }

  // ============================================
  // 9. ХЕЛПЕРЫ URL
  // ============================================

  function isMainDomain(domain) {
    let parts = domain.split('.');
    if (parts.length <= 2) return true;
    if (parts.length === 3 && parts[1] === '2gis') return false;
    return parts.length <= 2;
  }

  function normalizeUrl(url) {
    try {
      let u = new URL(url);
      URL_PARAMS_TO_REMOVE.forEach(p => u.searchParams.delete(p));
      u.hash = '';
      return u.href;
    } catch {
      return url;
    }
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
    } catch {
      return url;
    }
  }

  function decodeRedirect(url) {
    try {
      let u = new URL(url, window.location.href);
      
      if (u.hostname.includes("vk.com") && u.pathname.includes("/away.php")) {
        let to = u.searchParams.get("to");
        if (to) return decodeURIComponent(to);
      }
      if (u.hostname.includes("ok.ru") && u.pathname.includes("/away")) {
        let to = u.searchParams.get("to");
        if (to) return decodeURIComponent(to);
      }
      
      if (u.hostname.includes("google.") && u.pathname.includes("/url")) {
        let q = u.searchParams.get("q");
        if (q) return decodeURIComponent(q);
      }
      
      if (u.hostname.includes("yandex.") && u.pathname.includes("/redirect")) {
        let urlParam = u.searchParams.get("url");
        if (urlParam) return decodeURIComponent(urlParam);
      }

      return url;
    } catch {
      return url;
    }
  }

  function getCurrentDomain() {
    return window.location.hostname.replace(/^www\./, '').toLowerCase();
  }

  function getDomainFromUrl(url) {
    try {
      let hostname = new URL(url).hostname;
      return hostname.replace(/^www\./, '').toLowerCase();
    } catch {
      return '';
    }
  }

  function getPathFromUrl(url) {
    try {
      return new URL(url).pathname.toLowerCase();
    } catch {
      return '';
    }
  }

  function getSocialNetworkByDomain(domain) {
    for (let [network, domains] of Object.entries(SOCIAL_DOMAINS)) {
      for (let d of domains) {
        if (domain === d || domain.endsWith('.' + d)) {
          return network;
        }
      }
    }
    return null;
  }

  function extractLinksFromElement(el) {
    let results = [];

    function convertDeepLink(url) {
      if (!url) return url;
      
      if (url.startsWith('tg://resolve?domain=')) {
        return 'https://t.me/' + url.replace('tg://resolve?domain=', '').split('&')[0];
      }
      if (url.startsWith('whatsapp://send?phone=')) {
        return 'https://wa.me/' + url.replace('whatsapp://send?phone=', '').split('&')[0];
      }
      if (url.startsWith('viber://chat?number=')) {
        return 'https://viber.me/' + url.replace('viber://chat?number=', '').split('&')[0];
      }
      if (url.startsWith('skype:')) {
        let clean = url.replace('skype:', '').split('?')[0];
        return 'https://skype.com/' + clean;
      }
      
      return url;
    }

    if (el.href) results.push(convertDeepLink(el.href));
    if (el.src) results.push(convertDeepLink(el.src));
    if (el.data) results.push(convertDeepLink(el.data));

    if (el.rel && (el.rel.startsWith('http') || el.rel.includes('://'))) {
      results.push(convertDeepLink(el.rel));
    }

    if (el.action && (el.action.startsWith('http') || el.action.includes('://'))) {
      results.push(convertDeepLink(el.action));
    }

    let dataAttrs = ['data-url', 'data-to', 'data-link', 'data-href'];
    for (let attr of dataAttrs) {
      let val = el.getAttribute(attr);
      if (val && (val.startsWith('http') || val.startsWith('/') || val.includes('://') || /^(tg|whatsapp|viber|skype):/.test(val))) {
        results.push(convertDeepLink(val));
      }
    }

    const tag = el.tagName;
    if (tag === 'IFRAME' || tag === 'EMBED' || tag === 'OBJECT') {
      return results;
    }

    if (el.childElementCount > 5) {
      return results;
    }

    const rawText = el.textContent;
    if (!rawText || rawText.length > 500) return results;

    const text = rawText.trim();
    if (text && text.length < 300) {
      const matches = text.match(TEXT_URL_REGEX);
      if (matches) {
        for (const m of matches) {
          if (m.startsWith('http')) {
            results.push(m);
          } else {
            results.push('https://' + m);
          }
        }
      }
    }

    return results;
  }

  function getAllLinks() {
    let links = new Set();

    document.querySelectorAll(SELECTORS.links.join(',')).forEach(el => {
      let extracted = extractLinksFromElement(el);
      extracted.forEach(raw => {
        if (raw && raw.trim() !== "") {
          try {
            let decoded = decodeRedirect(raw);
            let absolute = new URL(decoded, window.location.href).href;
            const u = new URL(absolute);
            if (u.protocol !== 'http:' && u.protocol !== 'https:') return;
            links.add(absolute);
          } catch { /* невалидный URL — пропускаем */ }
        }
      });
    });

    return Array.from(links);
  }

  function isRootUrl(url) {
    try {
      let u = new URL(url);
      let path = u.pathname;
      if (path === '' || path === '/') return true;
    } catch { /* невалидный URL — не корень */ }
    return false;
  }

  function isJunkLink(url, network) {
    if (isRootUrl(url)) return true;

    let patterns = JUNK_PATTERNS[network] || [];
    let path = getPathFromUrl(url);
    for (let pattern of patterns) {
      if (path.includes(pattern)) return true;
    }

    try {
      let u = new URL(url);
      let searchParams = u.searchParams;

      if (network === 'vk' || network === 'ok') {
        if (searchParams.has('text') || searchParams.has('url') || searchParams.has('share')) {
          return true;
        }
      } else {
        if (searchParams.has('url') || searchParams.has('share')) {
          return true;
        }
      }
    } catch { /* невалидный URL — не мусор */ }

    return false;
  }

  function isLinkBelongsToSite(url, siteName) {
    try {
      let u = new URL(url);
      let path = u.pathname.toLowerCase();
      let username = path.split('/').filter(Boolean)[0] || '';
      if (!username) return false;

      let cleanUsername = username.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      let cleanSiteName = siteName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();

      if (!cleanSiteName) return false;

      if (cleanUsername === cleanSiteName) return true;

      const suffixLen = cleanUsername.length - cleanSiteName.length;
      if (suffixLen < 1 || suffixLen > 4) return false;
      if (!cleanUsername.startsWith(cleanSiteName)) return false;

      const suffix = cleanUsername.slice(cleanSiteName.length);
      for (let i = 0; i < suffix.length; i++) {
        const c = suffix.charCodeAt(i);
        if (c < 48 || c > 57) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  // ============================================
  // 10. ОСНОВНОЙ ПОИСК
  // ============================================

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

      for (let j = 0; j < key.length; j++) {
        hash = ((hash << 5) - hash + key.charCodeAt(j)) | 0;
      }
    }
    return hash;
  }

  async function detectSocialNetworks(forceRefresh) {
    const now = Date.now();
    if (!forceRefresh && cachedResults && (now - cacheTimestamp) < CACHE_CONFIG.ttl) {
      return cachedResults;
    }

    let currentDomain = getCurrentDomain();
    let siteName = currentDomain.replace(/^www\./, '').replace(/\..*$/, '');
    let isMain = isMainDomain(currentDomain);

    let currentNetwork = getSocialNetworkByDomain(currentDomain);

    let links = getAllLinks();
    let results = [];
    let seenUrls = new Map();
    let socialUrls = [];

    links.forEach(link => {
      let domain = getDomainFromUrl(link);
      let network = getSocialNetworkByDomain(domain);

      if (network && currentNetwork && network === currentNetwork) return;

      if (network) {
        if (isJunkLink(link, network)) return;
        let isSiteSocial = false;
        if (isMain) isSiteSocial = isLinkBelongsToSite(link, siteName);
        let normalized = normalizeUrl(link);
        if (!seenUrls.has(normalized)) {
          seenUrls.set(normalized, link);
          socialUrls.push(link);
          results.push({
            url: normalized,
            network: network,
            isDirect: isSiteSocial
          });
        }
      }
    });

    const collected = collectAllData(socialUrls);

    collected.phones.forEach(phone => {
      results.push({ url: null, phone: phone, network: 'phone', isDirect: false });
    });

    collected.emails.forEach(email => {
      results.push({ url: null, email: email, network: 'email', isDirect: false });
    });

    collected.inns.forEach(inn => {
      results.push({ url: null, inn: inn, network: 'inn', isDirect: false });
    });

    collected.ogrns.forEach(ogrn => {
      results.push({ url: null, ogrn: ogrn, network: ogrn.network, isDirect: false });
    });

    results.sort((a, b) => {
      if (a.isDirect === b.isDirect) return 0;
      return a.isDirect ? -1 : 1;
    });

    cachedResults = results;
    cacheTimestamp = now;
    return results;
  }

  async function updateBadge(items) {
    if (!badgeEl) return;

    if (!items) {
      items = await detectSocialNetworks();
    }

    const count = items.length;
    badgeEl.textContent = count > 0 ? String(count) : '0';

    if (!chrome.runtime?.id) return;

    try {
      chrome.runtime.sendMessage({ action: "updateBadge", count: count });
    } catch { /* context invalidated */ }
  }

  // ============================================
  // 11. ОБРАТНАЯ СВЯЗЬ
  // ============================================

  function openFeedbackEmail() {
    isFeedbackClicking = true; // Защита от закрытия панели

    const host = window.location.hostname;
    const body = [
      'Привет!',
      '',
      '📌 Сайт: ' + host,
      '',
      '📝 Опишите, что не работает или что можно улучшить:',
      '',
      '---',
      'Отправлено через расширение LinkRadar'
    ].join('\n');

    const href = 'mailto:' + FEEDBACK_EMAIL
      + '?subject=' + encodeURIComponent(FEEDBACK_SUBJECT)
      + '&body=' + encodeURIComponent(body);

    const a = document.createElement('a');
    a.href = href;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    setTimeout(() => {
      isFeedbackClicking = false;
    }, 2000);
  }

  // ============================================
  // 12. UI (Shadow DOM, closed)
  // ============================================

  const SHADOW_CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .lr-root {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      pointer-events: none;
    }
    .lr-badge {
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      color: #fff;
      cursor: pointer;
      border: 2px solid rgba(255, 255, 255, 0.2);
      transition: transform 0.15s, box-shadow 0.15s;
      user-select: none;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
      pointer-events: auto;
      position: relative;
      z-index: 10;
    }
    .lr-window {
      background: #fff;
      overflow: hidden;
      box-shadow: 0 8px 28px rgba(0, 0, 0, 0.15), 0 0 0 1px rgba(0, 0, 0, 0.05);
      transition: max-height 0.25s ease, opacity 0.2s ease, margin-top 0.25s ease;
      opacity: 0;
      display: flex;
      flex-direction: column;
      color: #1f2937;
      pointer-events: auto;
      margin-top: 0;
      align-self: flex-end;
      max-height: 0;
    }
    .lr-header {
      padding: 14px 16px;
      background: #f5f5f5;
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid #e5e7eb;
    }
    .lr-header-left { display: flex; align-items: center; gap: 12px; }
    .lr-title { font-size: 14px; color: #00a550; font-weight: 700; }
    .lr-feedback {
      font-size: 11px;
      color: #6b7280;
      text-decoration: none;
      transition: color 0.2s;
      cursor: pointer;
    }
    .lr-feedback:hover { color: #00a550; }
    .lr-links {
      overflow-y: auto;
      max-height: 400px;
      padding: 12px;
      background: #fff;
    }
    .lr-empty {
      text-align: center;
      padding: 40px 20px;
      color: #9ca3af;
      font-size: 13px;
    }
    .lr-more {
      text-align: center;
      padding: 12px;
      margin-top: 4px;
      background: #f3f4f6;
      border-radius: 12px;
      cursor: pointer;
      font-size: 13px;
      color: #3b82f6;
      font-weight: 500;
      transition: 0.15s;
      border: 1px solid #e5e7eb;
    }
    .lr-more:hover { background: #e5e7eb; }
    .lr-card {
      margin-bottom: 8px;
      border-radius: 12px;
      display: flex;
      justify-content: space-between;
      align-items: stretch;
      overflow: hidden;
      border: 2px solid #e5e7eb;
      transition: all 0.12s;
    }
    .lr-card-left {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: 1;
      padding: 10px 12px;
      cursor: pointer;
      min-width: 140px;
    }
    .lr-card-right {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 10px 14px;
      background: #f9fafb;
      border-left: 1px solid #e5e7eb;
      flex-shrink: 0;
    }
    .lr-icon {
      width: 32px;
      height: 32px;
      border-radius: 10px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 16px;
      flex-shrink: 0;
      color: #fff;
    }
    .lr-card-text { overflow: hidden; flex: 1; }
    .lr-card-title {
      font-size: 12px;
      font-weight: 600;
      color: #1f2937;
    }
    .lr-card-sub {
      font-size: 9px;
      color: #6b7280;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .lr-copy {
      display: inline-block;
      background: #00a550;
      border: none;
      padding: 6px 14px;
      border-radius: 20px;
      color: #fff;
      font-size: 10px;
      font-family: inherit;
      font-weight: 600;
      cursor: pointer;
      white-space: nowrap;
      min-height: 28px;
      user-select: none;
      transition: background 0.15s, transform 0.08s;
    }
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

    function makeCopyButton(value, baseColor, successColor) {
    const btn = el('button', '', 'Копировать');
    btn.className = 'lr-copy';
    btn.style.background = baseColor;
    
    let isClicked = false; // Защита от быстрых повторных кликов

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      
      // Если уже идёт процесс копирования и показа галочки — игнорируем новые клики
      if (isClicked) return;
      isClicked = true;

      // Отменяем старый таймер, если он был (защита от гонки)
      if (btn._copyTimer) {
        clearTimeout(btn._copyTimer);
        btn._copyTimer = null;
      }

      const old = btn.textContent;
      
      // Временно ставим "Копировать" (на случай, если застряло в галочке)
      btn.textContent = 'Копировать'; 

      const ok = await copyToClipboard(value);

      if (ok) {
        btn.textContent = '✓';
        btn.style.background = successColor || '#059669';
      } else {
        btn.textContent = '✗';
        btn.style.background = '#dc2626';
      }

      // Запускаем один единственный таймер на возврат
      btn._copyTimer = setTimeout(() => {
        btn.textContent = old;
        btn.style.background = baseColor;
        btn._copyTimer = null;
        isClicked = false; // Разрешаем новые клики
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
      left.addEventListener('mouseenter', () => {
        card.style.borderColor = meta.verifiedHoverBorder;
        card.style.background = meta.verifiedHoverBg;
      });
      left.addEventListener('mouseleave', () => {
        card.style.borderColor = meta.verifiedBorder;
        card.style.background = meta.verifiedBg;
      });
    } else if (meta.nonVerifiedHoverBorder) {
      left.addEventListener('mouseenter', () => {
        card.style.borderColor = meta.nonVerifiedHoverBorder;
        card.style.background = meta.nonVerifiedHoverBg;
      });
      left.addEventListener('mouseleave', () => {
        card.style.borderColor = '#e5e7eb';
        card.style.background = '#f9fafb';
      });
    }

    const icon = el('div', `background:${meta.baseColor};`, meta.icon);
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

    left.appendChild(icon);
    left.appendChild(textBox);

    const copyBaseColor = isVerified ? meta.verifiedBaseColor : meta.baseColor;
    const copySuccessColor = isVerified ? meta.verifiedSuccessColor : meta.successColor;

    const right = el('div', '');
    right.className = 'lr-card-right';
    right.appendChild(makeCopyButton(copyValue, copyBaseColor, copySuccessColor));

    card.appendChild(left);
    card.appendChild(right);
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
    left.addEventListener('click', () => {
      window.open(item.url, '_blank', 'noopener,noreferrer');
    });
    if (!isDirect) {
      left.addEventListener('mouseenter', () => {
        card.style.borderColor = '#00a550';
        card.style.background = '#f0fdf4';
      });
      left.addEventListener('mouseleave', () => {
        card.style.borderColor = '#e5e7eb';
        card.style.background = '#f9fafb';
      });
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
    textBox.appendChild(title);
    textBox.appendChild(urlLine);

    left.appendChild(iconBox);
    left.appendChild(textBox);

    const right = el('div', '');
    right.className = 'lr-card-right';
    right.appendChild(makeCopyButton(getCopyPath(item.url), '#00a550', '#059669'));

    card.appendChild(left);
    card.appendChild(right);
    return card;
  }

  function createCard(item) {
    if (CARD_META[item.network]) return createDataCard(item);
    return createSocialCard(item);
  }

  // ============================================
  // 13. СОЗДАНИЕ ПАНЕЛИ
  // ============================================

  function removeOrphanPanel() {
    const orphan = document.getElementById('linkRadarPanel');
    if (orphan && orphan !== panel) {
      orphan.remove();
      return true;
    }
    return false;
  }

  function createPanel() {
    removeOrphanPanel();

    if (panel) return;

    panel = document.createElement('div');
    panel.id = 'linkRadarPanel';
    panel.style.cssText = `
      position: fixed;
      z-index: 2147483647;
      top: 80px;
      right: 20px;
      pointer-events: none;
    `;

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
      width: ${badgeSize};
      height: ${badgeSize};
      background: ${PANEL_CONFIG.badgeColor};
      border-radius: 50%;
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
      if (isDraggingPanel) {
        isDraggingPanel = false;
        return;
      }
      e.stopPropagation();
      toggleWindow();
    });

    let dragStartX = 0, dragStartY = 0, dragStartLeft = 0, dragStartTop = 0;
    badgeEl.addEventListener('mousedown', (e) => {
      isDraggingPanel = false;
      const rect = panel.getBoundingClientRect();
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragStartLeft = rect.left;
      dragStartTop = rect.top;
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

    updateBadge();
    renderLinks();
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

      updateBadge();
      startObserver();
      renderLinks(false);
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

  // ============================================
  // 14. РЕНДЕРИНГ
  // ============================================

  async function renderLinks(forceRefresh, items) {
    if (!linksContainerEl) return;

    const myToken = ++renderToken;
    cancelRender = true;

    await new Promise(resolve => setTimeout(resolve, TIMINGS.renderStartDelay));

    if (myToken !== renderToken) return;

    cancelRender = false;

    if (!items) {
      items = await detectSocialNetworks(forceRefresh);
    }

    if (myToken !== renderToken || cancelRender) return;
    if (!linksContainerEl) return;

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

  // ============================================
  // 15. НАБЛЮДЕНИЕ ЗА DOM
  // ============================================

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

  function startObserver() {
    if (observer) observer.disconnect();
    if (observerDebounceTimer) {
      clearTimeout(observerDebounceTimer);
      observerDebounceTimer = null;
    }

    observer = new MutationObserver((mutations) => {
      const hasRelevant = mutations.some(m => !isOurMutation(m));
      if (!hasRelevant) return;

      clearTimeout(observerDebounceTimer);
      observerDebounceTimer = setTimeout(async () => {
        const items = await detectSocialNetworks();
        const newHash = computeHash(items);
        if (newHash !== lastLinksHash) {
          lastLinksHash = newHash;
          await updateBadge(items);
          if (isPanelOpen) {
            renderLinks(false, items);
          }
        }
      }, TIMINGS.observerDebounce);
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  function stopObserver() {
    if (observer) {
      observer.disconnect();
      observer = null;
    }
    if (observerDebounceTimer) {
      clearTimeout(observerDebounceTimer);
      observerDebounceTimer = null;
    }
  }

  // ============================================
  // 16. ОЧИСТКА И ЖИЗНЕННЫЙ ЦИКЛ
  // ============================================

  function cleanupResources() {
    if (isFeedbackClicking) return;

    stopObserver();

    cachedResults = null;
    cacheTimestamp = 0;
    lastLinksHash = 0;
    cancelRender = true;
    renderToken++;

    if (panel) {
      panel.remove();
      panel = null;
    }
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
    window.addEventListener('pagehide', () => {
      cleanupResources();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopObserver();
      } else {
        if (!observer && panel && isPanelOpen) {
          startObserver();
        }
      }
    });
  }

  // ============================================
  // 17. СООБЩЕНИЯ ОТ BACKGROUND
  // ============================================

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
        if (!panel) {
          createPanel();
        } else {
          toggleWindow();
        }
        sendResponse({ status: "ok" });
        return false;
      }

      sendResponse({ status: "unknown" });
      return false;
    });
  } catch {
    // Extension context invalidated — расширение обновлено на лету.
  }

  // ============================================
  // 18. ИНИЦИАЛИЗАЦИЯ
  // ============================================

  function init() {
    if (isInternalDomain()) {
      if (DEBUG) console.log('LinkRadar: внутренний домен, работа отключена');
      return;
    }

    removeOrphanPanel();
    setupCleanup();

    if (DEBUG) console.log('LinkRadar готов к запуску по клику');
  }

  init();

})();