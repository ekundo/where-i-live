'use strict';

// Событие в календаре относится к родителю, если его название подходит под match.
const PARENTS = {
  mom: { match: /мам/i, label: 'Мама', at: 'у мамы', to: 'к маме', emoji: '👩🏻‍🦰' },
  dad: { match: /пап/i, label: 'Папа', at: 'у папы', to: 'к папе', emoji: '👨🏻‍🦳' },
};

const DAYS_SHOWN = 7;                 // карточек после сегодняшнего дня
const LOOKAHEAD = 45;                 // насколько вперёд искать следующий переезд
const REFRESH_MS = 30 * 60 * 1000;    // как часто перечитывать календарь
const STALE_MS = 36 * 60 * 60 * 1000; // после этого данные помечаются как старые

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const WEEKDAYS_AT = ['в воскресенье', 'в понедельник', 'во вторник', 'в среду', 'в четверг', 'в пятницу', 'в субботу'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
  'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

const $ = (id) => document.getElementById(id);

// В приватном режиме Safari localStorage может бросать исключения.
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* ignore */ } },
};

// ---------- даты ----------

const dayKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const parseKey = (s) => {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
};

const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

const startOfToday = () => {
  const n = new Date();
  return new Date(n.getFullYear(), n.getMonth(), n.getDate());
};

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

const plural = (n, one, few, many) => {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
};

const fmtTime = (ts) => {
  const d = new Date(ts);
  const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return dayKey(d) === dayKey(new Date()) ? time : `${d.getDate()} ${MONTHS[d.getMonth()]} ${time}`;
};

// ---------- расписание ----------

function parentOf(title) {
  for (const [id, p] of Object.entries(PARENTS)) if (p.match.test(title || '')) return id;
  return null;
}

// events: [{title, start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' (не включая), updated}]
// Если на один день попало несколько событий, побеждает самое короткое:
// разовое исключение «Папа 12–14» перекрывает длинный блок «Мама».
// При равной длине побеждает изменённое позже.
function buildSchedule(events) {
  const items = events
    .map((e) => ({ ...e, parent: parentOf(e.title), s: parseKey(e.start), e: parseKey(e.end) }))
    .filter((e) => e.parent && e.e > e.s)
    .sort((a, b) => (b.e - b.s) - (a.e - a.s) || (a.updated || 0) - (b.updated || 0));

  const days = new Map();
  for (const ev of items) {
    for (let d = ev.s; d < ev.e; d = addDays(d, 1)) days.set(dayKey(d), ev.parent);
  }
  return days;
}

// Демо: стандартный график 2-2-5-5. Пн–Вт мама, Ср–Чт папа,
// Пт–Вс по очереди; выходные 1–3 января 2027 у мамы.
function demoEvents() {
  const anchorMonday = new Date(2026, 11, 28);
  const today = startOfToday();
  const events = [];
  for (let i = -3; i < 90; i++) {
    const d = addDays(today, i);
    const dow = d.getDay();
    let who;
    if (dow === 1 || dow === 2) who = 'Мама';
    else if (dow === 3 || dow === 4) who = 'Папа';
    else {
      const monday = addDays(d, dow === 0 ? -6 : 1 - dow);
      const weeks = Math.round((monday - anchorMonday) / (7 * 864e5));
      who = ((weeks % 2) + 2) % 2 === 0 ? 'Мама' : 'Папа';
    }
    events.push({ title: who, start: dayKey(d), end: dayKey(addDays(d, 1)), updated: 0 });
  }
  return events;
}

// ---------- загрузка ----------

let lastError = null;
let lastAttempt = 0;
let renderedFor = null;

async function refresh() {
  const src = store.get('src');
  if (!src) { showSetup(); return; }
  lastAttempt = Date.now();

  if (src === 'demo') {
    store.set('cache', { fetchedAt: Date.now(), events: demoEvents() });
    lastError = null;
    render();
    return;
  }

  try {
    const res = await fetch(src, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch {
      throw new Error('скрипт вернул не JSON. Проверь доступ «Все» при развёртывании');
    }
    if (json.error) throw new Error(json.error);
    if (!Array.isArray(json.events)) throw new Error('в ответе нет events');
    store.set('cache', { fetchedAt: Date.now(), events: json.events });
    lastError = null;
  } catch (e) {
    lastError = e.message || String(e);
  }
  render();
}

// ---------- отрисовка ----------

function hintFor(days, today) {
  const cur = days.get(dayKey(today));
  if (!cur) return '';
  let n = 1;
  while (n < LOOKAHEAD && days.get(dayKey(addDays(today, n))) === cur) n++;
  const next = days.get(dayKey(addDays(today, n)));
  if (!next || next === cur) return '';

  const to = PARENTS[next].to;
  if (n === 1) return `Сегодня последний день ${PARENTS[cur].at}. Завтра едешь ${to}!`;

  const d = addDays(today, n);
  let when = WEEKDAYS_AT[d.getDay()];
  if (n >= 7) when += `, ${d.getDate()} ${MONTHS[d.getMonth()]}`;
  return `Ещё ${n} ${plural(n, 'ночь', 'ночи', 'ночей')} ${PARENTS[cur].at}. ${cap(when)} едешь ${to}.`;
}

function render() {
  $('setup').hidden = true;
  $('app').hidden = false;

  const today = startOfToday();
  renderedFor = dayKey(today);
  const cache = store.get('cache');
  const days = cache ? buildSchedule(cache.events) : new Map();

  $('todayDow').textContent = `Сегодня ${WEEKDAYS[today.getDay()]}`;
  $('todayDate').textContent = `${today.getDate()} ${MONTHS[today.getMonth()]}`;

  const who = days.get(renderedFor);
  const hero = $('hero');
  hero.className = `hero ${who || 'none'}`;
  $('heroEmoji').textContent = who ? PARENTS[who].emoji : '🤔';
  $('heroWhere').textContent = who
    ? PARENTS[who].at
    : (cache ? 'спроси у мамы или папы' : 'загружаю расписание…');
  $('hint').textContent = hintFor(days, today);

  const list = $('days');
  list.textContent = '';
  let prev = who;
  for (let i = 1; i <= DAYS_SHOWN; i++) {
    const d = addDays(today, i);
    const p = days.get(dayKey(d));
    const li = document.createElement('li');
    li.className = `day ${p || ''}`;
    li.innerHTML = `
      <span class="day-dow"></span>
      <span class="day-num"></span>
      <span class="day-mon"></span>
      <span class="day-who"></span>`;
    li.querySelector('.day-dow').textContent = i === 1 ? 'Завтра' : cap(WEEKDAYS[d.getDay()]);
    li.querySelector('.day-num').textContent = d.getDate();
    li.querySelector('.day-mon').textContent = i === 1 ? WEEKDAYS[d.getDay()] : MONTHS[d.getMonth()];
    li.querySelector('.day-who').textContent = p ? `${PARENTS[p].emoji} ${PARENTS[p].label}` : '?';
    if (p && prev && p !== prev) {
      const badge = document.createElement('span');
      badge.className = 'day-badge';
      badge.textContent = 'переезд';
      li.appendChild(badge);
    }
    prev = p;
    list.appendChild(li);
  }

  const status = $('status');
  const stale = cache && Date.now() - cache.fetchedAt > STALE_MS;
  status.classList.toggle('warn', Boolean(lastError || stale));
  if (lastError && cache) status.textContent = `Нет связи с календарём (${lastError}). Данные от ${fmtTime(cache.fetchedAt)}`;
  else if (lastError) status.textContent = `Не получилось загрузить расписание: ${lastError}`;
  else if (cache) status.textContent = `Обновлено ${fmtTime(cache.fetchedAt)}`;
  else status.textContent = '';
}

// ---------- настройки ----------

function showSetup() {
  $('app').hidden = true;
  $('setup').hidden = false;
  $('setupError').textContent = '';
  const src = store.get('src');
  $('srcInput').value = src && src !== 'demo' ? src : '';
  $('cancelBtn').hidden = !src;
}

function saveSource(src) {
  store.set('src', src);
  store.set('cache', null);
  lastError = null;
  render();
  refresh();
}

$('saveBtn').addEventListener('click', () => {
  const v = $('srcInput').value.trim();
  if (!/^https:\/\/script\.google(usercontent)?\.com\/.+/.test(v)) {
    $('setupError').textContent = 'Нужна ссылка вида https://script.google.com/macros/s/…/exec';
    return;
  }
  saveSource(v);
});
$('demoBtn').addEventListener('click', () => saveSource('demo'));
$('cancelBtn').addEventListener('click', render);

// Настройки спрятаны от ребёнка: удерживать строку статуса 2 секунды.
let pressTimer = null;
const status = $('status');
const cancelPress = () => clearTimeout(pressTimer);
status.addEventListener('pointerdown', () => { pressTimer = setTimeout(showSetup, 2000); });
status.addEventListener('pointerup', cancelPress);
status.addEventListener('pointerleave', cancelPress);
status.addEventListener('pointercancel', cancelPress);

// ---------- жизненный цикл ----------

function tick() {
  if (!$('app').hidden && renderedFor !== dayKey(new Date())) render();
  if (Date.now() - lastAttempt > REFRESH_MS) refresh();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  if (Date.now() - lastAttempt > 5 * 60 * 1000) refresh();
  else tick();
});
setInterval(tick, 60 * 1000);

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => { /* офлайн-кэш необязателен */ });
}

if (store.get('src')) {
  render();
  refresh();
} else {
  showSetup();
}
