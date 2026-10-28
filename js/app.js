import { parseCode, searchArticles, findRelevant } from './parser.js';
import { loadAccounts, syncAccount, banAccount, setBadge, wikiSummary } from './api.js';

// ================= АДМИН-КОНСТАНТЫ (из AHK) =================
const ADMIN_CODE = 'mjyj391NpGhfSs_cB1Mq6565emSVjy';
const ADMIN_ACC = {
  'ak1nzass':  { pass: 'd5aUecw3VF6',    rank: 'OWNER'  },
  'xl3byshek': { pass: 'BmM-CMi-uXQ-5tb', rank: 'TESTER' },
};

// ================= ХРАНИЛИЩЕ =================
const LS = {
  get(k, d = null) {
    try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; }
    catch { return d; }
  },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} },
};

// ================= СОСТОЯНИЕ =================
const state = {
  user: null,
  accounts: {},     // { login: {nick, ban, badge, color} }
  codesConfig: null,
  articles: {},     // { 'УК': [...], ... }
  facts: {},
  faq: [],
  currentTab: 'УК',
  adminSession: null,
  codeCache: {},    // { 'УК': articles[] }
};

// ================= УТИЛИТЫ =================
async function sha256(str) {
  const buf = new TextEncoder().encode(str);
  const h = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(h))
    .map(b => b.toString(16).padStart(2, '0')).join('');
}

function $(sel) { return document.querySelector(sel); }
function $$(sel) { return document.querySelectorAll(sel); }

function toast(text, ms = 2200) {
  const el = $('#toast');
  el.textContent = text;
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), ms);
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

// ================= АККАУНТЫ (локально) =================
function getLocalAccounts() { return LS.get('accounts', {}); }
function saveLocalAccounts(a) { LS.set('accounts', a); }

function getLocalAccount(login) {
  return getLocalAccounts()[login] || null;
}

// ================= ИНИЦИАЛИЗАЦИЯ =================
async function init() {
  // Загружаем конфиг кодексов, facts, faq параллельно
  const [codesR, factsR, faqR] = await Promise.all([
    fetch('data/codes.json').then(r => r.json()).catch(() => null),
    fetch('data/facts.json').then(r => r.json()).catch(() => ({})),
    fetch('data/faq.json').then(r => r.json()).catch(() => []),
  ]);
  state.codesConfig = codesR;
  state.facts = factsR;
  state.faq = faqR;

  // Загружаем сессию
  const savedUser = LS.get('session');
  if (savedUser) {
    state.user = savedUser;
    state.accounts = await loadAccounts();
  }

  // Строим табы
  buildTabs();

  // Показываем нужный экран
  go(state.user ? 'main' : 'auth');
  if (state.user) {
    renderMain();
    updateAvatar();
  }

  // Обработчики
  setupEvents();

  // SW
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

// ================= НАВИГАЦИЯ =================
function go(screenName) {
  $$('.screen').forEach(s => s.classList.remove('active'));
  const el = $(`#screen-${screenName}`);
  if (el) el.classList.add('active');

  if (screenName === 'main') renderMain();
  if (screenName === 'profile') renderProfile(state.user, true);
  if (screenName === 'players') renderPlayers();
  if (screenName === 'admin') renderAdmin();
  if (screenName === 'bookmarks') renderBookmarks();
  if (screenName === 'history') renderHistory();
  if (screenName === 'settings') renderSettings();
}

// ================= АВТОРИЗАЦИЯ =================
let authMode = 'login';

function setAuthMode(mode) {
  authMode = mode;
  $$('.tabs-auth button').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  $('#pass2-wrap').classList.toggle('hidden', mode !== 'register');
  $('#auth-pass2').classList.toggle('hidden', mode !== 'register');
  $('#auth-submit').textContent = mode === 'login' ? 'Войти' : 'Зарегистрироваться';
  $('#auth-msg').textContent = '';
  $('#auth-msg').classList.remove('err');
}

function setAuthMsg(text, isErr = false) {
  const el = $('#auth-msg');
  el.textContent = text;
  el.classList.toggle('err', isErr);
}

async function doAuth(e) {
  e.preventDefault();
  const login = $('#auth-login').value.trim().toLowerCase();
  const pass = $('#auth-pass').value;
  const pass2 = $('#auth-pass2').value;

  if (!/^[а-яёa-z0-9_]{3,20}$/.test(login)) {
    return setAuthMsg('Логин: 3-20 символов, только буквы, цифры и _', true);
  }
  if (pass.length < 4) {
    return setAuthMsg('Пароль — минимум 4 символа', true);
  }

  const accounts = getLocalAccounts();

  if (authMode === 'register') {
    if (pass !== pass2) return setAuthMsg('Пароли не совпадают', true);
    if (accounts[login]) return setAuthMsg('Такой логин уже занят', true);

    const ban = (state.accounts[login]?.ban || 0);
    if (ban > 0) return setAuthMsg('Логин заблокирован администрацией', true);

    accounts[login] = {
      hash: await sha256(login + '|' + pass),
      nick: login,
      avatar: '',
      points: 0,
      createdAt: Date.now(),
    };
    saveLocalAccounts(accounts);
    await syncAccount(login, login);
    loginSuccess(login, true);
  } else {
    if (!accounts[login]) return setAuthMsg('Аккаунт не найден. Зарегистрируйтесь.', true);
    const hash = await sha256(login + '|' + pass);
    if (accounts[login].hash !== hash) return setAuthMsg('Неверный логин или пароль', true);

    const ban = (state.accounts[login]?.ban || 0);
    if (ban > 0) return setAuthMsg('Логин заблокирован администрацией', true);

    loginSuccess(login, false);
  }
}

async function loginSuccess(login, isNew) {
  state.user = login;
  LS.set('session', login);
  state.accounts = await loadAccounts();
  toast(isNew ? `Аккаунт создан! Добро пожаловать, ${login}` : `С возвращением, ${getNick(login)}`);
  go('main');
  updateAvatar();
}

function logout() {
  if (!confirm('Выйти из аккаунта?')) return;
  state.user = null;
  LS.del('session');
  go('auth');
}

// ================= ПОЛЬЗОВАТЕЛИ =================
function getNick(login) {
  const local = getLocalAccount(login);
  if (local?.nick) return local.nick;
  if (state.accounts[login]?.nick) return state.accounts[login].nick;
  return login;
}

function getBadge(login) {
  return state.accounts[login]?.badge || '';
}
function getBadgeColor(login) {
  return state.accounts[login]?.color || '';
}
function getPoints(login) {
  return getLocalAccount(login)?.points || 0;
}
function getRank(login) {
  return ADMIN_ACC[login]?.rank || 'PLAYER';
}

// ================= ТАБЫ =================
function buildTabs() {
  const tabs = $('#tabs');
  tabs.innerHTML = '';
  state.codesConfig.tabs.forEach(name => {
    const b = document.createElement('button');
    b.className = 'tab' + (name === state.currentTab ? ' active' : '');
    b.textContent = name;
    b.onclick = () => {
      state.currentTab = name;
      buildTabs();
      runSearch();
    };
    tabs.appendChild(b);
  });
}

// ================= ЗАГРУЗКА КОДЕКСОВ =================
async function loadCode(tab) {
  if (state.codeCache[tab]) return state.codeCache[tab];
  const fileName = state.codesConfig.files[tab];
  if (!fileName) return [];
  const url = state.codesConfig.base + fileName;
  try {
    const r = await fetch(url);
    const text = await r.text();
    const articles = parseCode(text, fileName);
    state.codeCache[tab] = articles;
    return articles;
  } catch (e) {
    console.warn('loadCode failed', tab, e);
    return [];
  }
}

// ================= ПОИСК =================
let searchTimer = null;

function setupSearch() {
  const input = $('#search');
  input.oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(runSearch, 200);
  };
  input.onkeydown = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); askAI(); }
  };
}

async function runSearch() {
  const q = $('#search').value.trim();
  const results = $('#results');

  if (!q) {
    results.innerHTML = `<div class="hint">🎃 Три действия — и всё под рукой<br><br>
      <b>Поиск:</b> введи статью («158») или слово («кража»)<br>
      <b>Табы:</b> переключай кодекс<br>
      <b>Enter:</b> задать вопрос ИИ</div>`;
    return;
  }

  results.innerHTML = '<div class="hint">Ищу...</div>';
  const articles = await loadCode(state.currentTab);
  const found = searchArticles(articles, q);

  if (found.length === 0) {
    results.innerHTML = `<div class="hint">Ничего не найдено в разделе [${esc(state.currentTab)}] по запросу: ${esc(q)}<br><br>Совет: нажми Enter — ИИ попробует ответить.</div>`;
    return;
  }

  results.innerHTML = found.map(a => `
    <div class="article">
      <div class="num">${esc(a.title.split('\n')[0].slice(0, 120))}</div>
      <div class="body">${esc(a.text.slice(0, 600))}${a.text.length > 600 ? '...' : ''}</div>
      <div class="actions">
        <button data-copy="${esc(a.text)}">📋 Скопировать</button>
        <button data-bookmark="${esc(a.text)}">⭐ В закладки</button>
      </div>
    </div>
  `).join('');

  results.querySelectorAll('[data-copy]').forEach(b => {
    b.onclick = () => {
      navigator.clipboard.writeText(b.dataset.copy).then(() => toast('Скопировано!'));
    };
  });
  results.querySelectorAll('[data-bookmark]').forEach(b => {
    b.onclick = () => addBookmark(b.dataset.bookmark);
  });

  saveToHistory(q, found[0].text.slice(0, 200));
}

// ================= ИИ (локальный) =================
async function askAI() {
  const q = $('#search').value.trim();
  if (!q) return toast('Введите вопрос!');

  const results = $('#results');
  results.innerHTML = '<div class="hint">Думаю...</div>';

  // 1) Факты
  const ql = q.toLowerCase();
  let bestFact = '';
  let bestLen = 0;
  for (const [key, val] of Object.entries(state.facts)) {
    if (ql.includes(key) && key.length > bestLen) {
      bestLen = key.length;
      bestFact = val;
    }
  }
  if (bestFact) {
    results.innerHTML = `<div class="article"><div class="body">${esc(bestFact)}</div>
      <div class="actions"><button data-copy="${esc(bestFact)}">📋 Скопировать</button></div></div>`;
    results.querySelector('[data-copy]').onclick = () => {
      navigator.clipboard.writeText(bestFact).then(() => toast('Скопировано!'));
    };
    saveToHistory(q, bestFact.slice(0, 200));
    return;
  }

  // 2) Номер статьи
  const numMatch = q.match(/(\d+(?:\.\d+)?)/);
  if (numMatch) {
    for (const tab of state.codesConfig.tabs) {
      const articles = await loadCode(tab);
      const found = articles.filter(a => a.num === numMatch[1]);
      if (found.length) {
        const txt = found.slice(0, 2).map(a => a.text).join('\n\n').slice(0, 2000);
        results.innerHTML = `<div class="article"><div class="num">Статья ${esc(numMatch[1])} (${esc(tab)})</div>
          <div class="body">${esc(txt)}</div>
          <div class="actions"><button data-copy="${esc(txt)}">📋 Скопировать</button></div></div>`;
        results.querySelector('[data-copy]').onclick = () => {
          navigator.clipboard.writeText(txt).then(() => toast('Скопировано!'));
        };
        saveToHistory(q, txt.slice(0, 200));
        return;
      }
    }
  }

  // 3) Ключевые слова в кодексах
  for (const tab of state.codesConfig.tabs) {
    const articles = await loadCode(tab);
    const relevant = findRelevant(articles, q, 3);
    if (relevant.length) {
      const txt = relevant.map(a => a.text).join('\n\n').slice(0, 2000);
      results.innerHTML = `<div class="article"><div class="num">Нашёл похожее (${esc(tab)})</div>
        <div class="body">${esc(txt)}</div>
        <div class="actions"><button data-copy="${esc(txt)}">📋 Скопировать</button></div></div>`;
      results.querySelector('[data-copy]').onclick = () => {
        navigator.clipboard.writeText(txt).then(() => toast('Скопировано!'));
      };
      saveToHistory(q, txt.slice(0, 200));
      return;
    }
  }

  // 4) Википедия
  const wiki = await wikiSummary(q);
  if (wiki) {
    results.innerHTML = `<div class="article"><div class="body">${esc(wiki)}</div>
      <div class="actions"><button data-copy="${esc(wiki)}">📋 Скопировать</button></div></div>`;
    results.querySelector('[data-copy]').onclick = () => {
      navigator.clipboard.writeText(wiki).then(() => toast('Скопировано!'));
    };
    saveToHistory(q, wiki.slice(0, 200));
    return;
  }

  results.innerHTML = `<div class="hint">Не нашёл ответ. Попробуй короче: например «228», «статья 228 УК», «президент», «губернатор», «срок полномочий».</div>`;
}

// ================= ИСТОРИЯ =================
function saveToHistory(q, a) {
  let h = LS.get('history', []);
  h.unshift({ q, a, time: Date.now() });
  if (h.length > 120) h = h.slice(0, 120);
  LS.set('history', h);
}

function renderHistory() {
  const list = $('#history-list');
  const h = LS.get('history', []);
  if (h.length === 0) {
    list.innerHTML = '<div class="list-item empty">История пуста</div>';
    return;
  }
  list.innerHTML = h.map((item, i) => `
    <div class="list-item" data-i="${i}">
      <div class="title">${esc(item.q)}</div>
      <div class="meta">${new Date(item.time).toLocaleString('ru-RU')}</div>
    </div>
  `).join('');
  list.querySelectorAll('.list-item[data-i]').forEach(el => {
    el.onclick = () => {
      const item = h[Number(el.dataset.i)];
      $('#search').value = item.q;
      go('main');
      runSearch();
    };
  });
}

// ================= ЗАКЛАДКИ =================
function addBookmark(text) {
  let b = LS.get('bookmarks', []);
  if (b.some(x => x === text)) return toast('Уже в закладках');
  b.unshift(text);
  if (b.length > 100) b = b.slice(0, 100);
  LS.set('bookmarks', b);
  toast('Добавлено в закладки ⭐');
}

function renderBookmarks() {
  const list = $('#bookmarks-list');
  const b = LS.get('bookmarks', []);
  if (b.length === 0) {
    list.innerHTML = '<div class="list-item empty">Закладок пока нет — добавляйте из поиска</div>';
    return;
  }
  list.innerHTML = b.map((item, i) => `
    <div class="list-item">
      <div class="title">${esc(item.split('\n')[0].slice(0, 100))}</div>
      <div class="meta">${esc(item.slice(0, 150))}...</div>
    </div>
  `).join('');
}

// ================= ГЛАВНОЕ ОКНО =================
function renderMain() {
  if (!state.user) return;
  $('#footer').textContent = `🎃 ${getNick(state.user)}  •  Раздел: ${state.currentTab}  •  Enter — ИИ`;
}

function updateAvatar() {
  const el = $('#main-avatar');
  if (!state.user) { el.textContent = '🎃'; return; }
  const acc = getLocalAccount(state.user);
  if (acc?.avatar) {
    el.innerHTML = `<img src="${esc(acc.avatar)}" alt="">`;
  } else {
    el.textContent = '🎃';
  }
}

// ================= ПРОФИЛЬ =================
function renderProfile(login, editable) {
  const content = $('#profile-content');
  if (!login) { content.innerHTML = '<div class="hint">Не авторизован</div>'; return; }
  const nick = getNick(login);
  const badge = getBadge(login);
  const color = getBadgeColor(login);
  const points = getPoints(login);
  const local = getLocalAccount(login);
  const avatar = local?.avatar || '';

  const badgeHtml = badge
    ? `<span class="badge" style="background:#${esc(color || 'FF8C00')};color:${textColorFor(color)}">${esc(badge)}</span>`
    : `<span class="badge" style="background:#3A3226;color:#A8A8A8">ИГРОК</span>`;

  content.innerHTML = `
    <div class="profile-card">
      <div class="avatar-big">${avatar ? `<img src="${esc(avatar)}" alt="">` : '🎃'}</div>
      <div class="nick">${esc(nick)}</div>
      ${badgeHtml}
      <div class="points">${points}</div>
      <div class="points-label">БАЛЛОВ</div>
      <div class="dim" style="margin-top:8px;font-size:12px">@${esc(login)}</div>
    </div>
    ${editable ? `
    <div class="profile-row">
      <button id="btn-change-avatar">Сменить аватар</button>
      <button id="btn-change-nick">Сменить ник</button>
    </div>
    ` : `<div class="dim" style="text-align:center;margin-top:12px;font-size:12px">Чужой профиль — только просмотр</div>`}
    ${getRank(login) !== 'PLAYER' ? `<div class="profile-card"><div class="dim">Ранг</div><div style="color:var(--accent);font-size:20px;font-weight:bold">${getRank(login)}</div></div>` : ''}
  `;

  if (editable) {
    $('#btn-change-avatar').onclick = changeAvatar;
    $('#btn-change-nick').onclick = changeNick;
  }
}

function textColorFor(hex) {
  if (!hex || hex.length < 6) return '#FFFFFF';
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  return lum > 140 ? '#1A1A1A' : '#FFFFFF';
}

function changeNick() {
  const n = prompt('Новый ник (до 26 символов):', getNick(state.user));
  if (!n || !n.trim()) return;
  const nick = n.trim().slice(0, 26);
  const accs = getLocalAccounts();
  accs[state.user].nick = nick;
  saveLocalAccounts(accs);
  syncAccount(state.user, nick);
  renderProfile(state.user, true);
  updateAvatar();
  toast('Ник изменён!');
}

function changeAvatar() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files[0];
    if (!file) return;
    if (file.size > 200 * 1024) return toast('Файл слишком большой (макс. 200 КБ)');
    const reader = new FileReader();
    reader.onload = e => {
      const accs = getLocalAccounts();
      accs[state.user].avatar = e.target.result;
      saveLocalAccounts(accs);
      updateAvatar();
      renderProfile(state.user, true);
      toast('Аватар обновлён!');
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

// ================= ПОИСК ИГРОКОВ (ЛУПА) =================
async function renderPlayers() {
  const list = $('#player-list');
  list.innerHTML = '<div class="list-item empty">Загружаю...</div>';
  state.accounts = await loadAccounts();
  const all = { ...getLocalAccounts(), ...state.accounts };
  const logins = Object.keys(all).sort();

  if (logins.length === 0) {
    list.innerHTML = '<div class="list-item empty">Нет игроков</div>';
    return;
  }

  const filter = ($('#player-search')?.value || '').toLowerCase();
  const filtered = logins.filter(l =>
    l.includes(filter) || getNick(l).toLowerCase().includes(filter)
  );

  if (filtered.length === 0) {
    list.innerHTML = '<div class="list-item empty">Ничего не найдено</div>';
    return;
  }

  list.innerHTML = filtered.map(l => {
    const nick = getNick(l);
    const rank = getRank(l);
    const rankBadge = rank !== 'PLAYER' ? ` <span style="color:var(--accent)">[${rank}]</span>` : '';
    return `<div class="list-item" data-login="${esc(l)}">
      <div class="title">${esc(nick)}${rankBadge}</div>
      <div class="meta">@${esc(l)}</div>
    </div>`;
  }).join('');

  list.querySelectorAll('.list-item[data-login]').forEach(el => {
    el.onclick = () => {
      renderProfile(el.dataset.login, el.dataset.login === state.user);
      go('profile');
    };
  });
}

// ================= АДМИН-ПАНЕЛЬ =================
function renderAdmin() {
  const content = $('#admin-content');

  if (!state.adminSession) {
    content.innerHTML = `
      <div class="admin-section">
        <h3>🔒 Вход в админ-панель</h3>
        <input type="password" id="adm-code" placeholder="Специальный код разблокировки">
        <button id="adm-unlock">Разблокировать</button>
      </div>
    `;
    $('#adm-unlock').onclick = () => {
      const code = $('#adm-code').value.trim();
      if (code !== ADMIN_CODE) return toast('Неверный код');
      renderAdminLogin();
    };
    return;
  }

  const rank = ADMIN_ACC[state.adminSession].rank;
  content.innerHTML = `
    <div class="admin-section">
      <h3>Сессия: ${esc(state.adminSession)} (${rank})</h3>
      <div class="status">Всего игроков: ${Object.keys({...getLocalAccounts(), ...state.accounts}).length}</div>
    </div>
    <div class="admin-section">
      <h3>Действия с профилем</h3>
      <input type="text" id="adm-target" placeholder="Логин игрока">
      <button id="adm-ban" class="secondary">Удалить / забанить</button>
      ${rank === 'OWNER' ? `
        <h3 style="margin-top:16px">Бейдж и цвет (OWNER)</h3>
        <input type="text" id="adm-badge-text" placeholder="Текст бейджа (до 20)">
        <input type="text" id="adm-badge-color" placeholder="HEX цвет (например FF8C00)">
        <button id="adm-badge-set">Установить бейдж</button>
        <button id="adm-badge-clear" class="secondary">Сбросить</button>
      ` : ''}
    </div>
  `;

  $('#adm-ban').onclick = async () => {
    const target = $('#adm-target').value.trim().toLowerCase();
    if (!target) return toast('Введи логин');
    const targetRank = getRank(target);
    if (targetRank === 'OWNER') return toast('Нельзя забанить OWNER');
    if (targetRank === 'TESTER' && rank !== 'OWNER') return toast('Нельзя забанить TESTER');
    if (!confirm(`Забанить ${target}?`)) return;
    await banAccount(target);
    const accs = getLocalAccounts();
    delete accs[target];
    saveLocalAccounts(accs);
    toast('Забанен и удалён локально');
  };

  if (rank === 'OWNER') {
    $('#adm-badge-set').onclick = async () => {
      const target = $('#adm-target').value.trim().toLowerCase();
      const text = $('#adm-badge-text').value.trim().slice(0, 20);
      const color = $('#adm-badge-color').value.trim().toUpperCase();
      if (!target || !text || !/^[0-9A-F]{6}$/.test(color)) return toast('Заполни все поля корректно');
      await setBadge(target, text, color);
      toast(`Бейдж установлен: ${text}`);
    };
    $('#adm-badge-clear').onclick = async () => {
      const target = $('#adm-target').value.trim().toLowerCase();
      if (!target) return toast('Введи логин');
      await setBadge(target, '', '');
      toast('Бейдж сброшен');
    };
  }
}

function renderAdminLogin() {
  const content = $('#admin-content');
  const opts = Object.keys(ADMIN_ACC).map(l => `<option value="${l}">${l} (${ADMIN_ACC[l].rank})</option>`).join('');
  content.innerHTML = `
    <div class="admin-section">
      <h3>Выбор админ-аккаунта</h3>
      <select id="adm-acc">${opts}</select>
      <input type="password" id="adm-pass" placeholder="Личный код аккаунта">
      <button id="adm-enter">Войти в админ-панель</button>
    </div>
  `;
  $('#adm-enter').onclick = () => {
    const login = $('#adm-acc').value;
    const pass = $('#adm-pass').value.trim();
    if (pass !== ADMIN_ACC[login].pass) return toast('Неверный код аккаунта');
    state.adminSession = login;
    renderAdmin();
    toast(`Админ-сессия: ${login}`);
  };
}

// ================= НАСТРОЙКИ =================
function renderSettings() {
  const content = $('#settings-content');
  content.innerHTML = `
    <div class="settings-section">
      <h3>Аккаунт</h3>
      <div class="settings-row"><span class="label">Логин</span><span class="value">${esc(state.user || '—')}</span></div>
      <div class="settings-row"><span class="label">Ник</span><span class="value">${esc(state.user ? getNick(state.user) : '—')}</span></div>
      <div class="settings-row"><span class="label">Ранг</span><span class="value">${esc(state.user ? getRank(state.user) : '—')}</span></div>
      <button id="btn-logout" class="danger">Выйти из аккаунта</button>
    </div>
    <div class="settings-section">
      <h3>Админ-панель</h3>
      <button id="btn-admin-open">Открыть админ-панель</button>
    </div>
    <div class="settings-section">
      <h3>Память</h3>
      <div class="settings-row"><span class="label">Кодексы в кэше</span><span class="value">${Object.keys(state.codeCache).length}</span></div>
      <div class="settings-row"><span class="label">Закладок</span><span class="value">${LS.get('bookmarks', []).length}</span></div>
      <div class="settings-row"><span class="label">История</span><span class="value">${LS.get('history', []).length}</span></div>
      <button id="btn-clear-cache" class="danger">Очистить кэш кодексов</button>
    </div>
    <div class="settings-section">
      <h3>FAQ</h3>
      ${state.faq.map(f => `<div style="margin-bottom:14px"><div class="label" style="color:var(--accent);font-weight:bold">${esc(f.q)}</div><div class="value" style="font-size:13px;line-height:1.5;margin-top:4px">${esc(f.a)}</div></div>`).join('')}
    </div>
  `;

  $('#btn-logout').onclick = logout;
  $('#btn-admin-open').onclick = () => go('admin');
  $('#btn-clear-cache').onclick = () => {
    state.codeCache = {};
    toast('Кэш очищен');
  };
}

// ================= СОБЫТИЯ =================
function setupEvents() {
  // Auth
  $$('.tabs-auth button').forEach(b => {
    b.onclick = () => setAuthMode(b.dataset.mode);
  });
  $('#auth-form').onsubmit = doAuth;

  // Навигация
  $$('[data-nav]').forEach(el => {
    el.onclick = () => go(el.dataset.nav);
  });

  // Главный экран
  setupSearch();
  $('#main-avatar').onclick = () => go('profile');
  $('#btn-players').onclick = () => go('players');
  $('#btn-bookmarks').onclick = () => go('bookmarks');
  $('#btn-history').onclick = () => go('history');
  $('#btn-settings').onclick = () => go('settings');
  $('#btn-refresh-players').onclick = () => renderPlayers();
  $('#btn-admin-logout').onclick = () => {
    state.adminSession = null;
    toast('Админ-сессия завершена');
    go('main');
  };
  $('#btn-clear-bookmarks').onclick = () => {
    if (!confirm('Очистить все закладки?')) return;
    LS.del('bookmarks');
    renderBookmarks();
    toast('Закладки очищены');
  };
  $('#btn-clear-history').onclick = () => {
    if (!confirm('Очистить всю историю?')) return;
    LS.del('history');
    renderHistory();
    toast('История очищена');
  };
  $('#player-search').oninput = () => renderPlayers();
}

// ================= START =================
document.addEventListener('DOMContentLoaded', init);
