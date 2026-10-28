/**
 * Работа с внешними API:
 * - Google Apps Script (аккаунты, баны, бейджи)
 * - Wikipedia (справочник)
 */

// Твой endpoint из AHK
const API_URL = 'https://script.google.com/macros/s/AKfycbzvCl0YDbv9feLN72xOs8-EP0FEa3oxv3h7CBCbnxgbZso5HHPVLoVkDjrvDMEzZa_aNQ/exec';

/** Загружает список аккаунтов из Google-таблицы */
export async function loadAccounts() {
  try {
    const r = await fetch(API_URL, { method: 'GET' });
    const text = await r.text();
    const map = {};
    text.split('\n').forEach(line => {
      line = line.trim();
      if (!line) return;
      const p = line.split('|');
      if (p.length >= 2 && p[0]) {
        map[p[0]] = {
          nick: p[1] || p[0],
          ban: p[2] ? Number(p[2]) : 0,
          badge: p[3] || '',
          color: p[4] || '',
        };
      }
    });
    return map;
  } catch (e) {
    console.warn('loadAccounts failed', e);
    return {};
  }
}

/** Синхронизирует логин и ник в Google-таблицу */
export async function syncAccount(login, nick) {
  try {
    const body = `login=${encodeURIComponent(login)}&nick=${encodeURIComponent(nick)}`;
    await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body,
    });
  } catch (e) {
    console.warn('syncAccount failed', e);
  }
}

/** Банит логин на 9999 дней */
export async function banAccount(login) {
  try {
    const body = `action=ban&login=${encodeURIComponent(login)}&days=9999`;
    await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body,
    });
  } catch (e) {
    console.warn('banAccount failed', e);
  }
}

/** Устанавливает или сбрасывает бейдж */
export async function setBadge(login, text, color) {
  try {
    const body = `action=badge&login=${encodeURIComponent(login)}&text=${encodeURIComponent(text)}&color=${encodeURIComponent(color)}`;
    await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body,
    });
  } catch (e) {
    console.warn('setBadge failed', e);
  }
}

/** Краткая справка из Википедии (CORS-friendly) */
export async function wikiSummary(query) {
  try {
    const searchUrl = `https://ru.wikipedia.org/w/api.php?action=opensearch&limit=1&format=json&origin=*&search=${encodeURIComponent(query)}`;
    const sr = await fetch(searchUrl);
    const arr = await sr.json();
    if (!arr[1] || !arr[1][0]) return '';
    const title = arr[1][0];
    const sumUrl = `https://ru.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const sum = await fetch(sumUrl);
    const data = await sum.json();
    let extract = data.extract || '';
    if (extract.length > 1200) extract = extract.slice(0, 1200) + '...';
    return `Справочник (Википедия):\n\n${extract}\n\nИсточник: ru.wikipedia.org`;
  } catch (e) {
    return '';
  }
}