// background.js - LinkRadar beta 0.1.0
// Инъекция content.js по клику. Ping-цикл после executeScript.
// Все ответы на onMessage — синхронные (return false).
// updateBadge(...).catch() — защита от unhandled rejection.
// Инъекция только на http(s). Внутренние домены отсекает content.js
// через isInternalDomain() — панель там не создаётся.
// ISOLATED world для content script.

const DEBUG = false;

const CONTENT_SCRIPT_PING_ATTEMPTS = 10;
const CONTENT_SCRIPT_PING_DELAY_MS = 50;

// ============================================
// ПРОВЕРКА URL
// ============================================
// Разрешаем только http(s). Внутренние домены (2gis.*, .local, .corp,
// .intranet, localhost, IP) отсекаются в content.js через isInternalDomain.

function isSupportedUrl(urlString) {
  try {
    const u = new URL(urlString);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ============================================
// PING / INJECT
// ============================================

async function pingContentScript(tabId) {
  try {
    await chrome.tabs.sendMessage(tabId, { action: "ping" });
    return true;
  } catch {
    return false;
  }
}

async function ensureContentScript(tabId) {
  if (await pingContentScript(tabId)) return true;

  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ['content.js'],
      world: 'ISOLATED'
    });
  } catch (err) {
    if (DEBUG) console.error('LinkRadar: executeScript failed', err);
    return false;
  }

  for (let i = 0; i < CONTENT_SCRIPT_PING_ATTEMPTS; i++) {
    if (await pingContentScript(tabId)) return true;
    await new Promise(resolve => setTimeout(resolve, CONTENT_SCRIPT_PING_DELAY_MS));
  }

  if (DEBUG) console.error('LinkRadar: content script не отвечает после инъекции');
  return false;
}

// ============================================
// CLICK HANDLER
// ============================================

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.id || !tab.url) return;

  if (!isSupportedUrl(tab.url)) {
    if (DEBUG) console.log('LinkRadar: неподдерживаемая схема', tab.url);
    return;
  }

  const ok = await ensureContentScript(tab.id);
  if (!ok) return;

  try {
    await chrome.tabs.sendMessage(tab.id, { action: "togglePanel" });
  } catch (err) {
    if (DEBUG) console.error('LinkRadar: togglePanel failed', err);
  }
});

// ============================================
// BADGE
// ============================================

async function updateBadge(tabId, count) {
  if (!tabId) return;
  try {
    if (count > 0) {
      await chrome.action.setBadgeText({
        tabId,
        text: count > 99 ? '99+' : String(count)
      });
      await chrome.action.setBadgeBackgroundColor({
        tabId,
        color: '#00a550'
      });
    } else {
      await chrome.action.setBadgeText({ tabId, text: '' });
    }
  } catch { /* ignore */ }
}

// ============================================
// MESSAGE HANDLER
// ============================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === "updateBadge" && sender.tab) {
    updateBadge(sender.tab.id, message.count).catch(() => {});
    sendResponse({ status: "ok" });
    return false;
  }

  if (message.action === "getTabId" && sender.tab) {
    sendResponse({ tabId: sender.tab.id });
    return false;
  }

  sendResponse({ status: "unknown_action" });
  return false;
});

// ============================================
// LIFECYCLE
// ============================================

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    if (DEBUG) console.log('LinkRadar установлен');
  } else if (details.reason === 'update') {
    if (DEBUG) console.log('LinkRadar обновлён');
  }
});