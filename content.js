// content.js - LinkRadar beta 0.3.1
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
// NEW: поиск графика работы (метки, диапазоны времени, круглосуточно).
// NEW: фильтрация placeholder-email (text@mail.ru из подсказок и ошибок форм).
// NEW: дедупликация графика по DOM-вложенности (без дублей td/tr/p).
// NEW: поиск организаций по ООО/ИП/МБУ и т.п. (карточка "Организация").
// NEW: селекторы VK *_site в SITE_BLOCK_SELECTORS.
// NEW: полные формы организаций (Общество с ограниченной ответственностью, ...).
// NEW: поиск адресов организаций (индекс, регион, город, улица, дом).
// NEW: вкладки в выдаче (Название/ИНН / Адрес / Контакты / График).
// NEW: пустые вкладки скрываются, но возвращаются при появлении данных.
// NEW: телефон в скобках без префикса (3852) 557270; формат 4-значного кода 2-2-2.
// NEW: телефон в скобках с дефисами (7-385-2) 59-44-66; корректный код 3852.
// NEW: приоритет видимого номера над tel:-href (заглушки 8-800-...-...).
// NEW: отбрасываем placeholder-телефоны (800-888-88-88, 000-00-00 и т.п.).
// NEW: не откатываемся на tel:-href, если видимый текст выглядит телефоном, но невалиден.
// NEW: tel:-ссылки в processedTel, чтобы текстовый walker не дублировал их содержимое.
// NEW: findNumbersNearLabel не break-ает на <p> (метка в <p>, число в соседнем блоке).
// NEW: OGRN_LABEL_REGEX принимает 13-15 цифр (ОГРН/ОГРНИП), тип определяет getOGRNType.
// NEW: PHONE_REGEX_PAREN_CODE принимает префикс 8/+7/7 перед скобкой (8(395 53) 5-25-48).
// NEW: ИНН/ОГРН/ОГРНИП с пробелами/дефисами внутри цифр (720 300 904 584).
// NEW: ИП:/ООО:/... с двоеточием после аббревиатуры.
// NEW: стоп-символы ИНН/ОГРН/... через lookahead (кириллица + <br> без пробелов).
// FIX: getAllLinks обходит голые URL в тексте (https://vk.com/... в <p>).
// FIX: mutationsCouldAddData реагирует на голый URL соцсети/букинга в тексте.
// NEW: карточка Яндекс.Карты в выдаче (вкладка Адрес). Клик → подсветка iframe на странице.
// NEW: поиск yandex map iframe/ссылок, извлечение адреса из title/aria-label/param/sosedey.
// FIX: isJunkYandexMap пропускает ?um= (Tilda Constructor-карты).
// FIX: isYandexMapUrl отсекает tech.yandex.ru и /maps/mapsapi/ (доки).
// NEW: поддержка JS-карт ymaps (Mosaic/Megagroup) через [data-init-params].
// NEW: клик по JS-карте подсвечивает контейнер ymaps, а не водяной знак «Создать свою карту».
// NEW: убраны кнопки «Копировать» в карточках вкладок Адрес и График.
// NEW: для Дзена и Рутуба копируется полный URL (а не только путь).

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
    '[data-testid="groups_detailed_info_site"]',
    '.group-info_row.__site',
    '.profile-info_row.__site',
    '.group-info__site',
    '.profile-info__site',
    '.portal__site',
    '.user-info__site',
    '.group-info-site',
    '[data-testid$="-site"]',
    '[data-testid$="_site"]'
  ];

  const SERVICE_DOMAINS = new Set(['knd.gov.ru', 'gosuslugi.ru', 'roscomnadzor.gov.ru', 'rkn.gov.ru']);
  const REDIRECT_HOST_PATTERN = /(^|\.)(vk\.com|vk\.ru|ok\.ru|odnoklassniki\.ru|mail\.ru)$/i;
  const SITE_LABEL_REGEX = /^\s*(сайт|website|site)\s*:\s*/i;

  const YANDEX_MAP_HOSTS = ['yandex.ru', 'yandex.com', 'yandex.by', 'yandex.kz', 'yandex.ua', 'yandex.com.tr', 'yandex.uz'];
  const YANDEX_MAP_PATH_PATTERNS = [/\/map-widget/, /\/maps\//, /\/maps$/, /\/map\//];

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
  const PHONE_REGEX_PAREN_CODE = /(?<!\d)(?:\+?[78][\s\-\u2010\u2011\u2012\u2013\u2014\u2212]*)?\((?:\+?[78][\s\-\u2010\u2011\u2012\u2013\u2014\u2212]*)?[3-8][\d\s\-\u2010\u2011\u2012\u2013\u2014\u2212]{1,6}\)[\s\-\u2010\u2011\u2012\u2013\u2014\u2212]*\d[\d\s\-\u2010\u2011\u2012\u2013\u2014\u2212]{4,10}\d(?!\d)/g;
  const PHONE_REGEX_LOOSE = /(?:\+?\d[\d\-()\u2010\u2011\u2012\u2013\u2014\u2212]{8,18}\d)/g;

  const EMAIL_REGEX = /[\p{L}0-9._%+\-]+@[\p{L}\p{N}.\-]+\.[\p{L}]{2,}/gu;

  const INN_LABEL_REGEX = /ИНН\s*[:.]?\s*((?:\d[\s\u00A0\-\u2010\u2011\u2012\u2013\u2014\u2212]*){10,12})(?!\d)/gi;
  const OGRN_LABEL_REGEX = /ОГРН\s*[:.]?\s*((?:\d[\s\u00A0\-\u2010\u2011\u2012\u2013\u2014\u2212]*){13,15})(?!\d)/gi;
  const OGRNIP_LABEL_REGEX = /ОГРНИП\s*[:.]?\s*((?:\d[\s\u00A0\-\u2010\u2011\u2012\u2013\u2014\u2212]*){15})(?!\d)/gi;

  const EMAIL_PLACEHOLDER_CONTEXT_RE =
    /(?:в\s+формате|формат[аеыу]?\s|формат\s*[:.]|пример[аеыу]?\s|пример\s*[:.]|например|образец|шаблон|e\.g\.|eg\.|example|sample|format\s*[:.]|placeholder)/i;

  const EMAIL_PLACEHOLDER_CLASS_RE =
    /form[-_]?error|form[-_]?hint|form[-_]?note|form[-_]?help|field[-_]?error|field[-_]?hint|input[-_]?error|input[-_]?hint|error[-_]?message|help[-_]?text|hint[-_]?text|placeholder|example|sample|dummy/i;

  const DUMMY_EMAIL_LOCAL_PARTS = new Set([
    'example', 'sample', 'test', 'testtest', 'qwerty',
    'text', 'your', 'yourname', 'username', 'name',
    'email', 'emailaddress', 'username123', 'user123', 'test123'
  ]);

  const SCHEDULE_TIME_RANGE_RE =
    /(?<!\d)([01]?\d|2[0-3])[:.](\d{2})\s*[\-\u2010\u2011\u2012\u2013\u2014\u2212]\s*([01]?\d|2[0-3])[:.](\d{2})(?!\d)/;
  const SCHEDULE_TIME_RANGE_RE_G =
    /(?<!\d)([01]?\d|2[0-3])[:.](\d{2})\s*[\-\u2010\u2011\u2012\u2013\u2014\u2212]\s*([01]?\d|2[0-3])[:.](\d{2})(?!\d)/g;
  const SCHEDULE_FROM_TO_RE =
    /(?<!\d)с\s+([01]?\d|2[0-3])[:.](\d{2})\s+до\s+([01]?\d|2[0-3])[:.](\d{2})(?!\d)/i;
  const SCHEDULE_FROM_TO_RE_G =
    /(?<!\d)с\s+([01]?\d|2[0-3])[:.](\d{2})\s+до\s+([01]?\d|2[0-3])[:.](\d{2})(?!\d)/gi;
  const SCHEDULE_STRONG_LABEL_RE =
    /(?:^|[^\p{L}])(время\s+работы|график\s+работы|часы\s+работы|режим\s+работы)(?:[^\p{L}]|$)/iu;
  const SCHEDULE_SEMANTIC_LABEL_RE =
    /(?:^|[^\p{L}])(работаем|ежедневно|без\s+выходных)(?:[^\p{L}]|$)/iu;
  const SCHEDULE_ROUND_CLOCK_RE =
    /(?:^|[^\p{L}])(круглосуточно|24\s*\/\s*7|24\s+на\s+7)(?:[^\p{L}]|$)/iu;
  const SCHEDULE_DAYS_RE =
    /(?:^|[^\p{L}])(пн|вт|ср|чт|пт|сб|вс|понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)(?:[^\p{L}]|$)/iu;

  const SCHEDULE_SELECTORS = [
    '[class*="schedule" i]',
    '[class*="work-time" i]',
    '[class*="worktime" i]',
    '[class*="working-hours" i]',
    '[class*="workinghours" i]',
    '[class*="opening-hours" i]',
    '[class*="openinghours" i]',
    '[class*="business-hours" i]',
    '[class*="businesshours" i]',
    '[itemprop="openingHours"]',
    '[itemprop="openingHoursSpecification"]',
    '[data-schedule]',
    '[data-working-hours]',
    '[data-work-time]'
  ];

  const ADDRESS_LABEL_RE =
    /(?<![а-яё])(?:(?:юридическ|фактическ|почтов)\p{L}*\s+адрес|адрес(?:\s+(?:объекта|места(?:\s+осуществления(?:\s+образовательной\s+деятельности)?)?))?|место\s+нахождения|место\s+осуществления(?:\s+образовательной\s+деятельности)?)(?![а-яё])/iu;

  const ADDRESS_POSTAL_RE = /(?<!\d)\d{6}(?!\d)/;

  const ADDRESS_STREET_RE =
    /(?<![а-яё])(?:ул\.?|улица|пр(?:-?т)?\.?|просп\.?|проспект|пер\.?|переулок|пл\.?|площадь|шоссе|б-р\.?|бульвар|наб\.?|набережная|туп\.?|тупик|мкр\.?|микрорайон|проезд|аллея|тракт)(?![а-яё])/iu;

  const ADDRESS_HOUSE_RE =
    /(?:^|[\s,.])(?:д\.?|дом)\s*\d+[А-ЯЁа-яёA-Za-z0-9/\-]*/iu;

  const ADDRESS_REGION_RE =
    /(?<![а-яё])(?:обл\.?|область|край|респ\.?|республика|автономн\p{L}*\s+округ)(?![а-яё])/iu;

  const ADDRESS_CITY_RE =
    /(?<![а-яё])(?:г\.?|город|гор\.?)\s*[А-ЯЁA-Z]/u;

  const ADDRESS_SETTLEMENT_RE =
    /(?<![а-яё])(?:с\.|село|п\.|посёлок|поселок|пгт|д\.|деревня|ст\.|станица|х\.|хутор|аул|рп|рабочий\s+посёлок)\s*[А-ЯЁA-Z]/u;

  const ADDRESS_SELECTORS = [
    '[itemprop="address"]',
    '[itemtype*="PostalAddress"]',
    '[data-address]',
    '[data-addr]',
    '[class*="address" i]',
    '[class*="addr" i]',
    '[id*="address" i]',
    '[id*="addr" i]',
    'address'
  ];

  const ADDRESS_STOP_RE =
    /(?:[!?;|]|\n|\r|\s{2,}|(?=(?:ИНН|ОГРН|ОГРНИП|КПП|БИК|Телефон|Тел\.|Факс|Сайт|Email|Почта|Директор|Руководитель|ФИО|Режим|График|Вид\s+места)(?![\p{L}])))/iu;

  const ORG_ABBREV_RE =
    /(?<![\p{L}])(ООО|ОАО|ЗАО|ПАО|АО|ИП|НКО|АНО|МБУ|МБОУ|МАОУ|МКОУ|МБДОУ|МАДОУ|МКДОУ|МУП|ГУП|ФГУП|ФГБУ|ФГБОУ|ФГАОУ|ФГБНУ|ГБУ|ГБОУ|ГАУ|ГКУ|КГБУ|КГБОУ|МКУ|МБУК|ГБУК|ФКУ|ТСЖ|ЖСК|СНТ|ДНП|КФХ|НОУ|ЧОУ|ГБПОУ|ОГБУ|ОГАУ|ОГКУ)(?![\p{L}])/gu;

  const ORG_FULL_RE = new RegExp(
    '(?<![\\p{L}])(' +
      [
        'Обществ\\p{L}*\\s+с\\s+ограниченной\\s+ответственностью',
        'Индивидуальн\\p{L}*\\s+предпринимател\\p{L}*',
        '(?:Публичн|Непубличн|Закрыт|Открыт|Акционерн)\\p{L}*\\s+обществ\\p{L}*',
        'Муниципальн\\p{L}*\\s+(?:бюджетн|казенн|автономн)\\p{L}*\\s+(?:общеобразовательн\\p{L}*\\s+|дошкольн\\p{L}*\\s+образовательн\\p{L}*\\s+)?учреждени\\p{L}*',
        'Государственн\\p{L}*\\s+(?:бюджетн|казенн|автономн)\\p{L}*\\s+(?:общеобразовательн\\p{L}*\\s+)?учреждени\\p{L}*',
        'Федеральн\\p{L}*\\s+государственн\\p{L}*\\s+(?:бюджетн|казенн|автономн)\\p{L}*\\s+(?:общеобразовательн\\p{L}*\\s+)?учреждени\\p{L}*',
        '(?:Федеральн\\p{L}*\\s+)?(?:государственн\\p{L}*\\s+|муниципальн\\p{L}*\\s+)?унитарн\\p{L}*\\s+предприяти\\p{L}*',
        '(?:Автономн\\p{L}*\\s+)?некоммерческ\\p{L}*\\s+организаци\\p{L}*',
        'Некоммерческ\\p{L}*\\s+партнерств\\p{L}*',
        'Общественн\\p{L}*\\s+организаци\\p{L}*',
        'Религиозн\\p{L}*\\s+организаци\\p{L}*',
        'Потребительск\\p{L}*\\s+(?:обществ\\p{L}*|кооператив\\p{L}*)',
        'Производственн\\p{L}*\\s+кооператив\\p{L}*',
        'Крестьянск\\p{L}*\\s+(?:фермерск\\p{L}*\\s+)?хозяйств\\p{L}*',
        'Товариществ\\p{L}*\\s+собственников\\s+(?:жилья|недвижимости)',
        'Садоводческ\\p{L}*\\s+некоммерческ\\p{L}*\\s+товариществ\\p{L}*'
      ].join('|') +
    ')(?![\\p{L}])',
    'gu'
  );

  const ORG_STOP_RE =
    /(?:[!?;]|\n|\r|\s{2,}|(?=(?:ИНН|ОГРН|ОГРНИП|КПП|БИК|Адрес|Телефон|Тел\.|Факс|Сайт|Email|Почта|Директор|Руководитель|ФИО)(?![\p{L}])))/iu;

  const TEXT_FILTER_REGEX = /[0-9@]|ИНН|ОГРН/i;
  const TEXT_URL_REGEX = /(https?:\/\/[^\s]+|(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}(?:\/[^\s]*)?)/gi;

  const TAB_CONFIG = [
    { id: 'org', label: 'Название/ИНН' },
    { id: 'address', label: 'Адрес' },
    { id: 'contacts', label: 'Контакты' },
    { id: 'schedule', label: 'График' }
  ];

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
  let tabsEl = null;
  let linksContainerEl = null;
  let panelTitleEl = null;
  let feedbackLinkEl = null;

  let isPanelOpen = false;
  let observer = null;
  let observerDebounceTimer = null;
  let lastLinksHash = 0;
  let cachedResults = null;
  let cacheTimestamp = 0;

  let currentItems = null;
  let activeTabId = 'org';

  const DEBUG = false;

  let isDraggingPanel = false;
  let cancelRender = false;
  let renderToken = 0;
  let isFeedbackClicking = false;

  function getTabForItem(item) {
    const n = item.network;
    if (n === 'org' || n === 'inn' || n === 'ogrn' || n === 'ogrnip') return 'org';
    if (n === 'address' || n === 'yandexmap') return 'address';
    if (n === 'schedule') return 'schedule';
    return 'contacts';
  }

  function countByTab(items) {
    const counts = { org: 0, address: 0, contacts: 0, schedule: 0 };
    if (!items) return counts;
    for (const item of items) counts[getTabForItem(item)]++;
    return counts;
  }

  function filterByTab(items, tabId) {
    if (!items) return [];
    return items.filter(it => getTabForItem(it) === tabId);
  }

  function getEmptyMessage(tabId) {
    switch (tabId) {
      case 'org': return '🏢 Организаций и реквизитов не найдено';
      case 'address': return '📍 Адресов не найдено';
      case 'contacts': return '📞 Контактов не найдено';
      case 'schedule': return '🕒 График работы не найден';
      default: return '🔍 Ничего не найдено';
    }
  }

  function updateTabs(items) {
    if (!tabsEl) return;
    const counts = countByTab(items);
    tabsEl.querySelectorAll('.lr-tab').forEach(tabEl => {
      const id = tabEl.dataset.tabId;
      const countEl = tabEl.querySelector('.lr-tab-count');
      const c = counts[id] || 0;
      if (countEl) countEl.textContent = String(c);
      tabEl.classList.toggle('hidden', c === 0);
    });
    updateTabsActive();
  }

  function updateTabsActive() {
    if (!tabsEl) return;
    tabsEl.querySelectorAll('.lr-tab').forEach(tabEl => {
      tabEl.classList.toggle('active', tabEl.dataset.tabId === activeTabId);
    });
  }

  function switchTab(tabId) {
    if (activeTabId === tabId) return;
    activeTabId = tabId;
    updateTabsActive();
    if (currentItems) renderLinks(false, currentItems);
  }

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

  function looksLikePlaceholderPhone(phone) {
    if (!phone) return true;
    const cleaned = String(phone).replace(/[^0-9]/g, '');
    if (cleaned.length < 10) return false;
    const local = cleaned.slice(-7);
    if (/^(\d)\1{6}$/.test(local)) return true;
    const uniqueDigits = new Set(local).size;
    if (uniqueDigits <= 1) return true;
    return false;
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

  function looksLikePlaceholderEmail(email, element) {
    if (!email) return false;
    const atIdx = email.indexOf('@');
    if (atIdx <= 0) return false;
    const local = email.slice(0, atIdx).toLowerCase();

    if (DUMMY_EMAIL_LOCAL_PARTS.has(local)) return true;

    let node = element;
    let depth = 0;
    while (node && depth < 6) {
      try {
        if (typeof node.className === 'string' && node.className) {
          if (EMAIL_PLACEHOLDER_CLASS_RE.test(node.className)) return true;
        }
        const id = typeof node.id === 'string' ? node.id : '';
        if (id && EMAIL_PLACEHOLDER_CLASS_RE.test(id)) return true;

        const t = node.textContent || '';
        if (t.length > 0 && t.length < 800) {
          if (EMAIL_PLACEHOLDER_CONTEXT_RE.test(t)) return true;
        }
      } catch { /* ignore */ }
      if (node.tagName === 'FORM' || node.tagName === 'BODY') break;
      node = node.parentElement;
      depth++;
    }

    return false;
  }

  function normalizeINN(inn) {
    if (!inn) return null;
    const cleaned = String(inn).replace(/[^0-9]/g, '');
    if (!cleaned) return null;
    if (cleaned.length === 10 || cleaned.length === 12) return cleaned;
    return null;
  }

  function normalizeOGRN(ogrn) {
    if (!ogrn) return null;
    const cleaned = String(ogrn).replace(/[^0-9]/g, '');
    if (!cleaned) return null;
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
      const parenMatch = originalText.match(/\(([^()]+)\)/);
      if (parenMatch) {
        let codeDigits = parenMatch[1].replace(/[^\d]/g, '');
        if (codeDigits.length === 5 && (codeDigits[0] === '7' || codeDigits[0] === '8')) {
          codeDigits = codeDigits.slice(1);
        }
        if (codeDigits.length === 5 && phone.slice(1, 6) === codeDigits) {
          const local = phone.slice(6);
          if (local.length === 5) return `+7 (${codeDigits}) ${local.slice(0,1)}-${local.slice(1,3)}-${local.slice(3)}`;
        }
        if (codeDigits.length === 4 && phone.slice(1, 5) === codeDigits) {
          const local = phone.slice(5);
          if (local.length === 6) return `+7 (${codeDigits}) ${local.slice(0,2)}-${local.slice(2,4)}-${local.slice(4)}`;
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
          const re = new RegExp(`(?<!\\d)((?:\\d[\\s.\\u00A0\\-\\u2010\\u2011\\u2012\\u2013\\u2014\\u2212]*){${minLen},${maxLen}})(?!\\d)`, 'g');
          const nums = [...content.matchAll(re)].map(m => m[1]);
          if (nums.length > 0) return { ancestor: node, numbers: nums };
        }
      }
      if (node.tagName === 'TR' || node.tagName === 'LI' || node.tagName === 'DL' ||
          node.tagName === 'TABLE' || node.tagName === 'FORM') break;
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
    const parenCodeMatches = text.match(PHONE_REGEX_PAREN_CODE);
    if (parenCodeMatches) allMatches.push(...parenCodeMatches);
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
      if (looksLikePlaceholderPhone(phone)) return;
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
      if (/^(\d)\1+$/.test(match.digits)) return;
      if (new Set(match.digits).size <= 1) return;
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
      if (!isVerified && looksLikePlaceholderEmail(email, element)) return;

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
        processedTel.add(el);

        const rawHref = toUrlString(el.getAttribute('href')) || toUrlString(el.href);
        if (!rawHref) return;
        const phoneFromHref = parseHref(rawHref, 'tel');
        const normalizedHref = normalizePhone(phoneFromHref, true);
        const visible = (el.textContent || '').trim();

        let usePhone = null;
        let matchedText = '';

        if (visible) {
          const visibleMatches = extractPhonesFromText(visible);
          if (visibleMatches && visibleMatches.length > 0) {
            for (const vm of visibleMatches) {
              const vNorm = normalizePhone(vm, false);
              if (vNorm) {
                usePhone = vNorm;
                matchedText = vm.trim();
                break;
              }
            }
          } else {
            usePhone = normalizedHref;
            matchedText = phoneFromHref;
          }
        } else {
          usePhone = normalizedHref;
          matchedText = phoneFromHref;
        }

        if (usePhone) {
          addPhone(usePhone, el, matchedText, true, true, matchedText);
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

  function analyzeAddress(text) {
    if (!text || text.length < 10 || text.length > 500) return null;
    const hasLabel = ADDRESS_LABEL_RE.test(text);
    const hasPostal = ADDRESS_POSTAL_RE.test(text);
    const hasStreet = ADDRESS_STREET_RE.test(text);
    const hasHouse = ADDRESS_HOUSE_RE.test(text);
    const hasRegion = ADDRESS_REGION_RE.test(text);
    const hasCity = ADDRESS_CITY_RE.test(text);
    const hasSettlement = ADDRESS_SETTLEMENT_RE.test(text);

    const componentCount = [hasPostal, hasStreet, hasHouse, hasRegion, hasCity, hasSettlement].filter(Boolean).length;

    const accepted =
      (hasLabel && componentCount >= 1) ||
      (hasPostal && componentCount >= 2) ||
      (hasStreet && (hasHouse || hasRegion || hasCity || hasSettlement)) ||
      (hasRegion && (hasCity || hasSettlement)) ||
      (hasCity && (hasSettlement || hasStreet || hasHouse)) ||
      componentCount >= 3;

    if (!accepted) return null;

    let score = 0;
    if (hasLabel) score += 5;
    if (hasStreet) score += 3;
    if (hasHouse) score += 2;
    if (hasPostal) score += 2;
    if (hasRegion) score += 1;
    if (hasCity) score += 1;
    if (hasSettlement) score += 1;

    return { score, hasLabel };
  }

  function extractAddress(text) {
    if (!text || text.length < 10) return null;
    let trimmed = text.replace(/\s+/g, ' ').trim();
    if (trimmed.length > 300) trimmed = trimmed.slice(0, 300);

    const a = analyzeAddress(trimmed);
    if (!a) return null;

    let startIdx = 0;
    const labelInHead = trimmed.slice(0, 40).match(ADDRESS_LABEL_RE);
    if (labelInHead && labelInHead.index !== undefined) {
      startIdx = labelInHead.index + labelInHead[0].length;
      while (startIdx < trimmed.length && /[\s:]/.test(trimmed[startIdx])) startIdx++;
    }

    const tail = trimmed.slice(startIdx);
    if (!tail) return null;

    const stop = tail.match(ADDRESS_STOP_RE);
    let endIdx = stop ? stop.index : tail.length;
    let address = tail.slice(0, endIdx).replace(/\s+/g, ' ').trim();
    address = address.replace(/[,;:.\-\s]+$/g, '').trim();

    if (address.length < 10) return null;

    const a2 = analyzeAddress(address);
    const stillAddressy = a2 || ADDRESS_STREET_RE.test(address) || ADDRESS_HOUSE_RE.test(address) || ADDRESS_POSTAL_RE.test(address);
    if (!stillAddressy) return null;

    return { text: address, score: a.score };
  }

  function collectAddresses() {
    const results = [];
    const seenElements = new Set();
    const seenText = new Set();
    const candidates = [];

    try {
      const sel = ADDRESS_SELECTORS.join(', ');
      document.querySelectorAll(sel).forEach(el => {
        try {
          if (!isElementVisible(el)) return;
          const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
          if (t.length < 10 || t.length > 500) return;
          const a = analyzeAddress(t);
          if (!a) return;
          if (seenElements.has(el)) return;
          seenElements.add(el);
          const extracted = extractAddress(t);
          if (!extracted) return;
          candidates.push({ element: el, text: extracted.text, score: extracted.score });
        } catch { /* ignore */ }
      });
    } catch { /* ignore */ }

    if (document.body) {
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
            const v = node.nodeValue;
            if (!v || v.length < 5 || v.length > 1000) return NodeFilter.FILTER_REJECT;
            if (ADDRESS_LABEL_RE.test(v) ||
                ADDRESS_POSTAL_RE.test(v) ||
                ADDRESS_STREET_RE.test(v) ||
                ADDRESS_REGION_RE.test(v) ||
                ADDRESS_CITY_RE.test(v) ||
                ADDRESS_SETTLEMENT_RE.test(v)) {
              return NodeFilter.FILTER_ACCEPT;
            }
            return NodeFilter.FILTER_REJECT;
          }
        }
      );

      let node;
      while ((node = walker.nextNode())) {
        let block = node.parentElement;
        let depth = 0;
        let found = null;

        while (block && depth < 8) {
          const t = (block.textContent || '').replace(/\s+/g, ' ').trim();
          if (t.length > 500) break;
          if (t.length >= 10) {
            const a = analyzeAddress(t);
            if (a) { found = block; break; }
          }
          block = block.parentElement;
          depth++;
        }

        if (!found) continue;
        if (seenElements.has(found)) continue;
        seenElements.add(found);

        const t = (found.textContent || '').replace(/\s+/g, ' ').trim();
        const extracted = extractAddress(t);
        if (!extracted) continue;
        candidates.push({ element: found, text: extracted.text, score: extracted.score });
      }
    }

    const drop = new Set();
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        if (drop.has(i) || drop.has(j)) continue;
        const ci = candidates[i], cj = candidates[j];
        const a = ci.element, b = cj.element;
        if (!a || !b || a === b) continue;
        let ancIdx, descIdx, ancScore, descScore;
        if (a.contains(b)) {
          ancIdx = i; descIdx = j; ancScore = ci.score; descScore = cj.score;
        } else if (b.contains(a)) {
          ancIdx = j; descIdx = i; ancScore = cj.score; descScore = ci.score;
        } else {
          continue;
        }
        if (ancScore >= descScore) drop.add(descIdx);
        else drop.add(ancIdx);
      }
    }
    const deduped = candidates.filter((_, i) => !drop.has(i));

    deduped.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.text.length - b.text.length;
    });

    for (const c of deduped) {
      const key = c.text.toLowerCase();
      if (seenText.has(key)) continue;
      seenText.add(key);
      results.push({ element: c.element, text: c.text });
      if (results.length >= 3) break;
    }

    return results;
  }

  function isYandexMapUrl(url) {
    if (!url || typeof url !== 'string') return false;
    try {
      const u = new URL(url, window.location.href);
      const host = u.hostname.replace(/^www\./, '').toLowerCase();
      if (host === 'tech.yandex.ru' || host === 'tech.yandex.com') return false;
      if (/^\/(?:legal|support|help|maps\/mapsapi)(?:\/|$)/i.test(u.pathname)) return false;
      const isYandexHost = YANDEX_MAP_HOSTS.some(h => host === h || host.endsWith('.' + h));
      if (!isYandexHost) return false;
      return YANDEX_MAP_PATH_PATTERNS.some(p => p.test(u.pathname));
    } catch { return false; }
  }

  function isJunkYandexMap(url) {
    try {
      const u = new URL(url);
      const path = u.pathname.replace(/\/+$/, '');
      const isRoot = /^\/(?:maps|map-widget)(?:\/v\d+)?$/.test(path) || path === '';
      if (isRoot) {
        const meaningful = ['um', 'oid', 'll', 'pt', 'text', 'what'];
        return !meaningful.some(p => u.searchParams.has(p));
      }
      return false;
    } catch { return true; }
  }

  function extractYandexMapAddress(url, el) {
    try {
      const u = new URL(url);
      const textParam = u.searchParams.get('text') || u.searchParams.get('what');
      if (textParam && textParam.length > 3 && textParam.length <= 300) {
        return decodeURIComponent(textParam.replace(/\+/g, ' ')).trim();
      }
    } catch { /* ignore */ }

    if (!el) return null;

    try {
      const title = (el.getAttribute('title') || '').trim();
      if (title.length > 5 && title.length <= 300) return title;
      const ariaLabel = (el.getAttribute('aria-label') || '').trim();
      if (ariaLabel.length > 5 && ariaLabel.length <= 300) return ariaLabel;
    } catch { /* ignore */ }

    try {
      let scope = el.parentElement;
      let depth = 0;
      while (scope && depth < 5) {
        let sib = scope.previousElementSibling;
        while (sib) {
          const text = (sib.textContent || '').replace(/\s+/g, ' ').trim();
          if (text.length >= 10 && text.length <= 500) {
            const extracted = extractAddress(text);
            if (extracted) return extracted.text;
          }
          sib = sib.previousElementSibling;
        }
        sib = scope.nextElementSibling;
        while (sib) {
          const text = (sib.textContent || '').replace(/\s+/g, ' ').trim();
          if (text.length >= 10 && text.length <= 500) {
            const extracted = extractAddress(text);
            if (extracted) return extracted.text;
          }
          sib = sib.nextElementSibling;
        }
        scope = scope.parentElement;
        depth++;
      }
    } catch { /* ignore */ }

    return null;
  }

  function isYandexMapWatermark(el) {
    if (!el) return false;
    try {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (/ymaps-[0-9-]+-gototech\b/.test(cls)) return true;
      if (/ymaps-[0-9-]+-gototaxi\b/.test(cls)) return true;
      if (/ymaps-[0-9-]+-gotoymaps\b/.test(cls)) return true;
      if (/ymaps-[0-9-]+-copyright\b/.test(cls)) return true;
    } catch { /* ignore */ }
    return false;
  }

  function findYmapsContainer(el) {
    if (!el) return null;
    let node = el;
    let depth = 0;
    while (node && depth < 20) {
      try {
        const tag = (node.tagName || '').toLowerCase();
        if (tag === 'ymaps') return node;
        if (node.classList && node.classList.length > 0) {
          const cls = typeof node.className === 'string' ? node.className : '';
          if (cls.split(/\s+/).some(c => /^ymaps-[0-9-]+-map$/.test(c))) return node;
        }
      } catch { /* ignore */ }
      node = node.parentElement;
      depth++;
    }
    return null;
  }

  function collectYandexMaps() {
    const results = [];
    const seen = new Set();
    const seenEls = new Set();

    function tryAdd(rawUrl, sourceEl, forcedAddress) {
      if (!rawUrl || typeof rawUrl !== 'string') return;
      try {
        const absolute = new URL(rawUrl, window.location.href).href;
        if (!isYandexMapUrl(absolute)) return;
        if (isJunkYandexMap(absolute)) return;
        if (sourceEl && !isElementVisible(sourceEl)) return;

        let targetEl = sourceEl;
        if (sourceEl) {
          if (isYandexMapWatermark(sourceEl)) {
            targetEl = findYmapsContainer(sourceEl) || sourceEl;
          } else {
            const yc = findYmapsContainer(sourceEl);
            if (yc && yc !== sourceEl) targetEl = yc;
          }
        }

        if (targetEl && seenEls.has(targetEl)) return;
        const normalized = normalizeUrl(absolute);
        if (seen.has(normalized)) return;
        seen.add(normalized);
        if (targetEl) seenEls.add(targetEl);
        const mapAddress = forcedAddress !== undefined
          ? forcedAddress
          : extractYandexMapAddress(absolute, targetEl);
        results.push({ url: absolute, element: targetEl, mapAddress });
      } catch { /* ignore */ }
    }

    try {
      document.querySelectorAll('iframe[src]').forEach(iframe => {
        const src = toUrlString(iframe.getAttribute('src')) || toUrlString(iframe.src);
        if (!src) return;
        tryAdd(src, iframe);
      });
    } catch { /* ignore */ }

    try {
      document.querySelectorAll('a[href]').forEach(a => {
        const href = toUrlString(a.getAttribute('href')) || toUrlString(a.href);
        if (!href) return;
        tryAdd(href, a);
      });
    } catch { /* ignore */ }

    try {
      document.querySelectorAll('embed[src], object[data]').forEach(em => {
        const src = toUrlString(em.getAttribute('src')) || toUrlString(em.getAttribute('data'));
        if (!src) return;
        tryAdd(src, em);
      });
    } catch { /* ignore */ }

    try {
      document.querySelectorAll('[data-init-params]').forEach(el => {
        const params = el.getAttribute('data-init-params') || '';
        if (!/"type"\s*:\s*"yandex"/i.test(params)) return;
        if (!isElementVisible(el)) return;
        if (seenEls.has(el)) return;

        let data = null;
        try { data = JSON.parse(params); } catch { return; }
        if (!data) return;

        let url = '';
        if (data.center) {
          const parts = String(data.center).split(',');
          if (parts.length === 2) {
            const lat = parts[0].trim();
            const lon = parts[1].trim();
            url = 'https://yandex.ru/maps/?ll=' + lon + ',' + lat + '&pt=' + lon + ',' + lat;
            if (data.zoom) url += '&z=' + String(data.zoom);
          }
        }
        if (!url) url = 'https://yandex.ru/maps/';

        let mapAddress = null;
        const points = Array.isArray(data.data) ? data.data : [];
        if (points.length > 0 && points[0]) {
          mapAddress = points[0].desc || points[0].name || null;
        }

        if (seen.has(url)) return;
        seen.add(url);
        seenEls.add(el);
        results.push({ url, element: el, mapAddress });
      });
    } catch { /* ignore */ }

    return results;
  }

  function findYandexMapElement(originalUrl) {
    if (!originalUrl) return null;
    let target = null;
    try { target = new URL(originalUrl, window.location.href); } catch { return null; }
    const targetOid = target.searchParams.get('oid');
    const targetLl = target.searchParams.get('ll');
    const targetPt = target.searchParams.get('pt');

    let candidates;
    try { candidates = document.querySelectorAll('iframe[src], embed[src], object[data]'); }
    catch { return null; }

    for (const el of candidates) {
      const src = toUrlString(el.getAttribute('src')) ||
                  toUrlString(el.getAttribute('data')) ||
                  toUrlString(el.src) ||
                  toUrlString(el.data);
      if (!src) continue;
      try {
        const u = new URL(src, window.location.href);
        if (u.href === target.href) return el;
        if (targetOid && u.searchParams.get('oid') === targetOid) return el;
        if (targetLl && targetPt &&
            u.searchParams.get('ll') === targetLl &&
            u.searchParams.get('pt') === targetPt) return el;
      } catch { /* ignore */ }
    }
    return null;
  }

  function resolveYandexMapTarget(item) {
    if (!item) return null;

    const toContainer = (el) => {
      if (!el) return null;
      if (isYandexMapWatermark(el)) {
        return findYmapsContainer(el) || el;
      }
      const yc = findYmapsContainer(el);
      if (yc && yc !== el) return yc;
      return el;
    };

    if (item.element && item.element.isConnected && isElementVisible(item.element)) {
      return toContainer(item.element);
    }

    const found = findYandexMapElement(item.url);
    if (found && isElementVisible(found)) return toContainer(found);

    const hiddenSource = found || (item.element && item.element.isConnected ? item.element : null);
    if (hiddenSource) {
      const hidden = findTopmostHidden(hiddenSource);
      if (hidden) {
        const opener = findOpenerForPanel(hidden);
        if (opener && isElementVisible(opener)) return opener;
      }
    }

    if (item.element && item.element.isConnected) {
      let node = item.element.parentElement;
      while (node && node !== document.body) {
        if (isElementVisible(node)) return node;
        node = node.parentElement;
      }
    }

    return null;
  }

  function extractOrganizationNames(text) {
    if (!text || text.length < 5 || text.length > 3000) return [];
    const matches = [];

    for (const m of text.matchAll(ORG_ABBREV_RE)) {
      matches.push({ idx: m.index, len: m[0].length });
    }
    for (const m of text.matchAll(ORG_FULL_RE)) {
      matches.push({ idx: m.index, len: m[0].length });
    }

    matches.sort((a, b) => a.idx - b.idx);

    const filtered = [];
    let lastEnd = -1;
    for (const m of matches) {
      if (m.idx < lastEnd) continue;
      filtered.push(m);
      lastEnd = m.idx + m.len;
    }

    const results = [];
    for (const m of filtered) {
      const startIdx = m.idx;
      const afterIdx = startIdx + m.len;
      const after = text.slice(afterIdx, afterIdx + 15);

      if (!/^[\s\-\u2010\u2011\u2012\u2013\u2014\u2212:.,]*[«"„"'А-ЯЁA-Zа-яё]/.test(after)) continue;
      if (/^[\s\-\u2010\u2011\u2012\u2013\u2014\u2212:.,]*\d/.test(after)) continue;

      const tail = text.slice(afterIdx, afterIdx + 200);
      const stop = tail.match(ORG_STOP_RE);
      const endIdx = stop ? afterIdx + stop.index : Math.min(afterIdx + 200, text.length);

      let name = text.slice(startIdx, endIdx).replace(/\s+/g, ' ').trim();
      name = name.replace(/[,;:.!?\-\u2010\u2011\u2012\u2013\u2014\u2212\s]+$/g, '').trim();

      if (name.length <= m.len) continue;
      if (name.length > 200) name = name.slice(0, 200).trim() + '…';
      results.push(name);
    }
    return results;
  }

  function collectOrganizations() {
    const results = [];
    const seen = new Set();
    const seenElements = new Set();

    if (!document.body) return results;

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
          const v = node.nodeValue || '';
          if (v.length < 5 || v.length > 1000) return NodeFilter.FILTER_REJECT;
          if (!v.match(ORG_ABBREV_RE) && !v.match(ORG_FULL_RE)) return NodeFilter.FILTER_REJECT;
          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const BLOCK_TAGS = new Set([
      'P', 'DIV', 'LI', 'TD', 'TR', 'TH', 'ARTICLE', 'SECTION', 'HEADER',
      'FOOTER', 'MAIN', 'ASIDE', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
      'ADDRESS', 'BLOCKQUOTE', 'TABLE', 'UL', 'OL', 'DL', 'FIGURE'
    ]);

    let node;
    while ((node = walker.nextNode())) {
      const parent = node.parentElement;
      if (!parent) continue;
      if (seenElements.has(parent)) continue;
      seenElements.add(parent);

      let container = parent;
      let cur = parent;
      let depth = 0;
      while (cur && depth < 6) {
        if (BLOCK_TAGS.has(cur.tagName)) { container = cur; break; }
        cur = cur.parentElement;
        depth++;
      }
      if (!container) container = parent;
      if (!isElementVisible(container)) {
        if (!isElementVisible(parent)) continue;
        container = parent;
      }

      let text = parent.textContent || '';
      let up = parent.parentElement;
      let upDepth = 0;
      while (up && upDepth < 2 && text.length < 300) {
        const upText = up.textContent || '';
        if (upText.length > 2000) break;
        text = upText;
        up = up.parentElement;
        upDepth++;
      }
      if (!text) continue;

      const orgs = extractOrganizationNames(text);
      for (const orgName of orgs) {
        const key = orgName.toLowerCase().replace(/\s+/g, ' ');
        if (seen.has(key)) continue;
        seen.add(key);
        results.push({ element: container, text: orgName });
        if (results.length >= 3) return results;
      }
    }

    return results;
  }

  function collectSchedule() {
    const results = [];
    const seenElements = new Set();
    const seenText = new Set();
    const candidates = [];

    function cleanText(t) {
      return (t || '').replace(/\s+/g, ' ').trim();
    }

    function countMatches(text, reG) {
      const m = text.match(reG);
      return m ? m.length : 0;
    }

    function analyze(text) {
      if (!text || text.length < 3 || text.length > 500) return null;
      const rangeCount =
        countMatches(text, SCHEDULE_TIME_RANGE_RE_G) +
        countMatches(text, SCHEDULE_FROM_TO_RE_G);
      const hasStrong = SCHEDULE_STRONG_LABEL_RE.test(text);
      const hasSemantic = SCHEDULE_SEMANTIC_LABEL_RE.test(text);
      const hasDays = SCHEDULE_DAYS_RE.test(text);
      const hasRoundClock = SCHEDULE_ROUND_CLOCK_RE.test(text);

      const accepted =
        hasStrong ||
        rangeCount >= 2 ||
        (rangeCount >= 1 && (hasDays || hasSemantic)) ||
        hasRoundClock;

      if (!accepted) return null;

      let score = 0;
      if (hasStrong) score += 5;
      if (hasRoundClock) score += 3;
      score += Math.min(rangeCount, 3) * 2;
      if (hasDays) score += 1;
      if (hasSemantic) score += 1;

      return { score, hasTime: rangeCount > 0, hasRoundClock };
    }

    try {
      const sel = SCHEDULE_SELECTORS.join(', ');
      document.querySelectorAll(sel).forEach(el => {
        try {
          if (!isElementVisible(el)) return;
          const t = cleanText(el.textContent);
          const a = analyze(t);
          if (!a) return;
          if (!a.hasTime && !a.hasRoundClock) return;
          if (seenElements.has(el)) return;
          seenElements.add(el);
          candidates.push({ element: el, text: t, score: a.score });
        } catch { /* ignore */ }
      });
    } catch { /* ignore */ }

    if (document.body) {
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
            const v = node.nodeValue;
            if (!v || v.length > 2000) return NodeFilter.FILTER_REJECT;
            if (SCHEDULE_TIME_RANGE_RE.test(v) ||
                SCHEDULE_FROM_TO_RE.test(v) ||
                SCHEDULE_ROUND_CLOCK_RE.test(v) ||
                SCHEDULE_STRONG_LABEL_RE.test(v)) {
              return NodeFilter.FILTER_ACCEPT;
            }
            return NodeFilter.FILTER_REJECT;
          }
        }
      );

      let node;
      while ((node = walker.nextNode())) {
        let block = node.parentElement;
        let depth = 0;
        let found = null;
        let fallback = null;

        while (block && depth < 8) {
          const t = cleanText(block.textContent);
          if (t.length > 2000) break;
          if (t.length > 0 && t.length <= 500) {
            const a = analyze(t);
            if (a && (a.hasTime || a.hasRoundClock)) {
              found = block;
              break;
            }
            if (a && a.hasStrong && !fallback) fallback = block;
          }
          block = block.parentElement;
          depth++;
        }

        if (!found && fallback) found = fallback;
        if (!found) continue;
        if (seenElements.has(found)) continue;
        seenElements.add(found);

        const t = cleanText(found.textContent);
        const a = analyze(t);
        if (!a) continue;
        candidates.push({ element: found, text: t, score: a.score });
      }
    }

    const drop = new Set();
    for (let i = 0; i < candidates.length; i++) {
      for (let j = i + 1; j < candidates.length; j++) {
        if (drop.has(i) || drop.has(j)) continue;
        const ci = candidates[i], cj = candidates[j];
        const a = ci.element, b = cj.element;
        if (!a || !b || a === b) continue;
        let ancIdx, descIdx, ancScore, descScore;
        if (a.contains(b)) {
          ancIdx = i; descIdx = j; ancScore = ci.score; descScore = cj.score;
        } else if (b.contains(a)) {
          ancIdx = j; descIdx = i; ancScore = cj.score; descScore = ci.score;
        } else {
          continue;
        }
        if (ancScore >= descScore) drop.add(descIdx);
        else drop.add(ancIdx);
      }
    }
    const deduped = candidates.filter((_, i) => !drop.has(i));

    deduped.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.text.length - b.text.length;
    });

    for (const c of deduped) {
      const key = c.text.toLowerCase();
      if (seenText.has(key)) continue;
      seenText.add(key);
      results.push({ element: c.element, text: c.text });
      if (results.length >= 3) break;
    }

    return results;
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

    // NEW: голые URL в тексте (не внутри <a>) — например, https://vk.com/... в <p>
    try {
      if (document.body) {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            const p = node.parentElement;
            if (!p) return NodeFilter.FILTER_REJECT;
            const tag = p.tagName;
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'NOSCRIPT' || tag === 'A') return NodeFilter.FILTER_REJECT;
            if (p.getRootNode() !== document) return NodeFilter.FILTER_REJECT;
            const v = node.nodeValue;
            if (!v || v.length < 8 || v.length > 500) return NodeFilter.FILTER_REJECT;
            if (!/https?:\/\/|(?:[a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}/.test(v)) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          }
        });
        let tn;
        while ((tn = walker.nextNode())) {
          const text = tn.nodeValue || '';
          const matches = text.match(TEXT_URL_REGEX);
          if (!matches) continue;
          for (const m of matches) {
            let raw = m;
            if (!/^https?:\/\//i.test(raw)) raw = 'https://' + raw;
            try {
              const decoded = decodeRedirect(raw);
              const absolute = new URL(decoded, window.location.href).href;
              const u = new URL(absolute);
              if (u.protocol !== 'http:' && u.protocol !== 'https:') continue;
              links.add(absolute);
            } catch { /* skip */ }
          }
        }
      }
    } catch { /* ignore */ }

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
        if (isYandexMapUrl(absolute)) return;
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
      else if (item.schedule) key += item.schedule.text;
      else if (item.org) key += item.org.text;
      else if (item.address) key += item.address.text;
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

      try {
        const orgs = collectOrganizations();
        for (const o of orgs) {
          results.push({ url: null, org: o, network: 'org', isDirect: false });
        }
      } catch { /* ignore */ }

      try {
        const addresses = collectAddresses();
        for (const a of addresses) {
          results.push({ url: null, address: a, network: 'address', isDirect: false });
        }
      } catch { /* ignore */ }

      try {
        const maps = collectYandexMaps();
        for (const m of maps) {
          results.push({
            url: m.url,
            mapAddress: m.mapAddress,
            element: m.element,
            network: 'yandexmap',
            isDirect: false
          });
        }
      } catch { /* ignore */ }

      try {
        const schedules = collectSchedule();
        for (const s of schedules) {
          results.push({ url: null, schedule: s, network: 'schedule', isDirect: false });
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
    .lr-tabs { display: flex; gap: 4px; padding: 8px 12px; background: #f9fafb; border-bottom: 1px solid #e5e7eb; }
    .lr-tab { flex: 1; padding: 6px 4px; border-radius: 8px; font-size: 10px; font-weight: 600; color: #6b7280; cursor: pointer; text-align: center; border: 1px solid transparent; transition: all 0.15s; user-select: none; display: flex; flex-direction: column; align-items: center; gap: 2px; min-width: 0; }
    .lr-tab.hidden { display: none; }
    .lr-tab:hover { background: #f3f4f6; color: #374151; }
    .lr-tab.active { background: #fff; color: #00a550; border-color: #00a550; box-shadow: 0 1px 3px rgba(0, 165, 80, 0.15); }
    .lr-tab-label { font-size: 10px; line-height: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 100%; }
    .lr-tab-count { font-size: 9px; font-weight: 700; background: #e5e7eb; color: #6b7280; padding: 1px 5px; border-radius: 6px; min-width: 16px; display: inline-block; line-height: 1.1; }
    .lr-tab.active .lr-tab-count { background: #00a550; color: #fff; }
    .lr-links { overflow-y: auto; max-height: 360px; padding: 12px; background: #fff; }
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
    .lr-card-schedule { font-size: 10px; color: #475569; line-height: 1.4; word-break: break-word; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; margin-top: 2px; }
    .lr-card-org { font-size: 10px; color: #4338ca; line-height: 1.4; word-break: break-word; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; margin-top: 2px; }
    .lr-card-address { font-size: 10px; color: #065f46; line-height: 1.4; word-break: break-word; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; margin-top: 2px; }
    .lr-card-map-address { font-size: 10px; color: #7c2d12; line-height: 1.4; word-break: break-word; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; margin-top: 2px; }
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
    // NEW: для Дзена и Рутуба — полная ссылка, иначе путь
    const copyValue = (item.network === 'dzen' || item.network === 'rutube')
      ? item.url
      : getCopyPath(item.url);
    right.appendChild(makeCopyButton(copyValue));
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

  function createScheduleCard(item) {
    const s = item.schedule;
    const card = el('div', 'background:#f0f9ff;border-color:#0ea5e9;');
    card.className = 'lr-card';

    const left = el('div', '');
    left.className = 'lr-card-left';
    left.addEventListener('click', () => {
      clearHighlights('linkradar-schedule-highlight');
      if (s.element && s.element.isConnected && isElementVisible(s.element)) {
        applyHighlight(s.element, '#0ea5e9', 'linkradar-schedule-highlight', null);
      } else if (s.text) {
        const found = findElementByTextInDOM(s.text);
        if (found) applyHighlight(found, '#0ea5e9', 'linkradar-schedule-highlight', null);
      }
    });
    left.addEventListener('mouseenter', () => { card.style.borderColor = '#0284c7'; card.style.background = '#e0f2fe'; });
    left.addEventListener('mouseleave', () => { card.style.borderColor = '#0ea5e9'; card.style.background = '#f0f9ff'; });

    const iconBox = el('div', 'background:#0ea5e9;', '🕒');
    iconBox.className = 'lr-icon';

    const textBox = el('div', '');
    textBox.className = 'lr-card-text';

    const title = el('div', '', 'График работы');
    title.className = 'lr-card-title';

    const sub = el('div', '', s.text);
    sub.className = 'lr-card-schedule';
    sub.title = s.text;

    textBox.appendChild(title);
    textBox.appendChild(sub);
    left.appendChild(iconBox);
    left.appendChild(textBox);

    card.appendChild(left);
    return card;
  }

  function createOrgCard(item) {
    const o = item.org;
    const card = el('div', 'background:#eef2ff;border-color:#6366f1;');
    card.className = 'lr-card';

    const left = el('div', '');
    left.className = 'lr-card-left';
    left.addEventListener('click', () => {
      clearHighlights('linkradar-org-highlight');
      if (o.element && o.element.isConnected && isElementVisible(o.element)) {
        applyHighlight(o.element, '#6366f1', 'linkradar-org-highlight', null);
      } else if (o.text) {
        const found = findElementByTextInDOM(o.text);
        if (found) applyHighlight(found, '#6366f1', 'linkradar-org-highlight', null);
      }
    });
    left.addEventListener('mouseenter', () => { card.style.borderColor = '#4f46e5'; card.style.background = '#e0e7ff'; });
    left.addEventListener('mouseleave', () => { card.style.borderColor = '#6366f1'; card.style.background = '#eef2ff'; });

    const iconBox = el('div', 'background:#6366f1;', '🏢');
    iconBox.className = 'lr-icon';

    const textBox = el('div', '');
    textBox.className = 'lr-card-text';

    const title = el('div', '', 'Организация');
    title.className = 'lr-card-title';

    const sub = el('div', '', o.text);
    sub.className = 'lr-card-org';
    sub.title = o.text;

    textBox.appendChild(title);
    textBox.appendChild(sub);
    left.appendChild(iconBox);
    left.appendChild(textBox);

    const right = el('div', '');
    right.className = 'lr-card-right';
    right.appendChild(makeCopyButton(o.text));

    card.appendChild(left);
    card.appendChild(right);
    return card;
  }

  function createAddressCard(item) {
    const a = item.address;
    const card = el('div', 'background:#ecfdf5;border-color:#10b981;');
    card.className = 'lr-card';

    const left = el('div', '');
    left.className = 'lr-card-left';
    left.addEventListener('click', () => {
      clearHighlights('linkradar-address-highlight');
      if (a.element && a.element.isConnected && isElementVisible(a.element)) {
        applyHighlight(a.element, '#10b981', 'linkradar-address-highlight', null);
      } else if (a.text) {
        const found = findElementByTextInDOM(a.text);
        if (found) applyHighlight(found, '#10b981', 'linkradar-address-highlight', null);
      }
    });
    left.addEventListener('mouseenter', () => { card.style.borderColor = '#059669'; card.style.background = '#d1fae5'; });
    left.addEventListener('mouseleave', () => { card.style.borderColor = '#10b981'; card.style.background = '#ecfdf5'; });

    const iconBox = el('div', 'background:#10b981;', '📍');
    iconBox.className = 'lr-icon';

    const textBox = el('div', '');
    textBox.className = 'lr-card-text';

    const title = el('div', '', 'Адрес');
    title.className = 'lr-card-title';

    const sub = el('div', '', a.text);
    sub.className = 'lr-card-address';
    sub.title = a.text;

    textBox.appendChild(title);
    textBox.appendChild(sub);
    left.appendChild(iconBox);
    left.appendChild(textBox);

    card.appendChild(left);
    return card;
  }

  function createYandexMapCard(item) {
    const card = el('div', 'background:#fff4ee;border-color:#fc3f1d;');
    card.className = 'lr-card';

    const left = el('div', '');
    left.className = 'lr-card-left';
    left.addEventListener('click', () => {
      clearHighlights('linkradar-yandexmap-highlight');
      const target = resolveYandexMapTarget(item);
      if (target) {
        applyHighlight(target, '#fc3f1d', 'linkradar-yandexmap-highlight', null);
      }
    });
    left.addEventListener('mouseenter', () => { card.style.borderColor = '#e0350f'; card.style.background = '#ffe8dd'; });
    left.addEventListener('mouseleave', () => { card.style.borderColor = '#fc3f1d'; card.style.background = '#fff4ee'; });

    const iconBox = el('div', 'background:#fc3f1d;', '🗺️');
    iconBox.className = 'lr-icon';

    const textBox = el('div', '');
    textBox.className = 'lr-card-text';

    const title = el('div', '', 'Яндекс.Карта');
    title.className = 'lr-card-title';

    let subText = item.mapAddress || 'Показать на странице';
    if (subText.length > 80) subText = subText.slice(0, 80) + '…';
    const sub = el('div', '', subText);
    sub.className = 'lr-card-map-address';
    sub.title = item.mapAddress || item.url;

    textBox.appendChild(title);
    textBox.appendChild(sub);
    left.appendChild(iconBox);
    left.appendChild(textBox);

    card.appendChild(left);
    return card;
  }

  function createCard(item) {
    if (CARD_META[item.network]) return createDataCard(item);
    if (item.network === 'schedule') return createScheduleCard(item);
    if (item.network === 'org') return createOrgCard(item);
    if (item.network === 'address') return createAddressCard(item);
    if (item.network === 'yandexmap') return createYandexMapCard(item);
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

    activeTabId = 'org';
    currentItems = null;

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

    tabsEl = document.createElement('div');
    tabsEl.className = 'lr-tabs';
    TAB_CONFIG.forEach(tab => {
      const tabBtn = document.createElement('div');
      tabBtn.className = 'lr-tab hidden';
      tabBtn.dataset.tabId = tab.id;
      const labelEl = document.createElement('div');
      labelEl.className = 'lr-tab-label';
      labelEl.textContent = tab.label;
      const countEl = document.createElement('div');
      countEl.className = 'lr-tab-count';
      countEl.textContent = '0';
      tabBtn.appendChild(labelEl);
      tabBtn.appendChild(countEl);
      tabBtn.addEventListener('click', () => switchTab(tab.id));
      tabsEl.appendChild(tabBtn);
    });

    linksContainerEl = document.createElement('div');
    linksContainerEl.className = 'lr-links';
    linksContainerEl.style.borderRadius = `0 0 ${PANEL_CONFIG.borderRadius} ${PANEL_CONFIG.borderRadius}`;

    windowEl.appendChild(header);
    windowEl.appendChild(tabsEl);
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

    currentItems = items;

    updateTabs(items);

    const counts = countByTab(items);
    if ((counts[activeTabId] || 0) === 0) {
      let picked = null;
      for (const tab of TAB_CONFIG) {
        if (counts[tab.id] > 0) { picked = tab.id; break; }
      }
      if (picked) {
        activeTabId = picked;
        updateTabsActive();
      }
    }

    const totalCount = counts.org + counts.address + counts.contacts + counts.schedule;
    const filtered = totalCount === 0 ? [] : filterByTab(items, activeTabId);

    linksContainerEl.textContent = '';

    if (totalCount === 0) {
      const empty = el('div', '', '🔍 Ничего не найдено');
      empty.className = 'lr-empty';
      linksContainerEl.appendChild(empty);
      return;
    }

    if (filtered.length === 0) {
      const empty = el('div', '', getEmptyMessage(activeTabId));
      empty.className = 'lr-empty';
      linksContainerEl.appendChild(empty);
      return;
    }

    const totalItems = filtered.length;
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
        const card = createCard(filtered[i]);
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
                  const card = createCard(filtered[i]);
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
            'iframe[src*="yandex"][src*="map"], a[href*="yandex"][href*="/maps"], a[href*="yandex"][href*="map-widget"], [data-init-params], ' +
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
            '[data-ogrn], [data-ogrnip], [data-ogrnul], [data-list], ' +
            '[itemprop="address"], [data-address], [data-addr], address'
          )) return true;

          if (node.querySelector && node.querySelector(
            'iframe[src*="yandex"][src*="map"], a[href*="yandex"][href*="/maps"], a[href*="yandex"][href*="map-widget"], [data-init-params], ' +
            'a[href^="tel:"], a[href^="mailto:"], ' +
            'a[href*="wa.me"], a[href*="api.whatsapp.com"], a[href*="whatsapp.com"], ' +
            'a[href*="t.me"], a[href*="telegram.me"], ' +
            'a[href*="vk.com"], a[href*="vk.ru"], a[href*="ok.ru"], ' +
            'a[href*="youtube.com"], a[href*="youtu.be"], ' +
            'a[href*="instagram.com"], a[href*="tiktok.com"], ' +
            'a[href*="dzen.ru"], a[href*="zen.yandex"], ' +
            '[data-phone], [data-email], [data-inn], [data-ogrn], [data-list], ' +
            '[itemprop="address"], [data-address], [data-addr], address'
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

            {
              const tl = t.toLowerCase();
              if (/https?:\/\/|(?:[a-z0-9-]+\.)+[a-z]{2,}/.test(tl)) {
                for (const net in SOCIAL_DOMAINS) {
                  const doms = SOCIAL_DOMAINS[net];
                  for (let d = 0; d < doms.length; d++) {
                    if (tl.indexOf(doms[d]) !== -1) return true;
                  }
                }
                for (const svc in BOOKING_DOMAINS) {
                  const doms = BOOKING_DOMAINS[svc];
                  for (let d = 0; d < doms.length; d++) {
                    if (tl.indexOf(doms[d]) !== -1) return true;
                  }
                }
              }
            }

            if (/yandex\.[a-z.]+\/(?:maps|map-widget)/i.test(t)) return true;

            if (t.length < 3000 && LOCAL_PHONE_LABEL_REGEX.test(t)) return true;

            if (SCHEDULE_STRONG_LABEL_RE.test(t) || SCHEDULE_ROUND_CLOCK_RE.test(t)) return true;

            if (t.match(ORG_ABBREV_RE)) return true;
            if (t.match(ORG_FULL_RE)) return true;

            if (t.length < 3000 && ADDRESS_LABEL_RE.test(t)) return true;
            if (t.length < 1000 && ADDRESS_POSTAL_RE.test(t) && ADDRESS_STREET_RE.test(t)) return true;
            if (t.length < 1000 && ADDRESS_STREET_RE.test(t) && ADDRESS_HOUSE_RE.test(t)) return true;

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
    tabsEl = null;
    linksContainerEl = null;
    panelTitleEl = null;
    feedbackLinkEl = null;
    isPanelOpen = false;

    currentItems = null;

    clearHighlights('linkradar-phone-highlight');
    clearHighlights('linkradar-email-highlight');
    clearHighlights('linkradar-verification-highlight');
    clearHighlights('linkradar-schedule-highlight');
    clearHighlights('linkradar-org-highlight');
    clearHighlights('linkradar-address-highlight');
    clearHighlights('linkradar-yandexmap-highlight');
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
