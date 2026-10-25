/**
 * Источник расписания для приложения «Где я живу».
 *
 * doGet отдаёт события календаря в JSON. Скрипт выполняется от имени владельца,
 * поэтому сам календарь остаётся приватным; наружу видно только то, что возвращает doGet.
 *
 * seedSchedule() один раз заполняет календарь расписанием: октябрь 2026 – январь 2027
 * по согласованной таблице, дальше стандартный график 2-2-5-5 до SEED_UNTIL.
 */

const CALENDAR_ID = 'PASTE_CALENDAR_ID_HERE'; // Настройки календаря → «Идентификатор календаря»
const DAYS_BACK = 3;
const DAYS_AHEAD = 60;

function doGet() {
  try {
    const cal = getCalendar_();
    const tz = Session.getScriptTimeZone();
    const now = new Date();
    const from = new Date(now.getTime() - DAYS_BACK * 864e5);
    const to = new Date(now.getTime() + DAYS_AHEAD * 864e5);

    const events = cal.getEvents(from, to).map(function (ev) {
      let start, end;
      if (ev.isAllDayEvent()) {
        start = fmt_(ev.getAllDayStartDate(), tz);
        end = fmt_(ev.getAllDayEndDate(), tz); // уже «не включая»
      } else {
        // Событие со временем занимает все дни, которых касается.
        start = fmt_(ev.getStartTime(), tz);
        end = nextDay_(fmt_(new Date(ev.getEndTime().getTime() - 1), tz));
      }
      return { title: ev.getTitle(), start: start, end: end, updated: ev.getLastUpdated().getTime() };
    });

    return json_({ generatedAt: now.getTime(), timeZone: tz, events: events });
  } catch (e) {
    return json_({ error: String(e && e.message || e) });
  }
}

// ---------- первоначальное заполнение ----------

const MOM_TITLE = 'Мама';
const DAD_TITLE = 'Папа';
const SEED_UNTIL = '2027-08-31';

// Каждая строка: месяц и буквы по дням начиная с 1-го числа (М = мама, П = папа).
// Пробелы для читаемости, по неделям Пн–Вс. Перенесено со скриншотов расписания.
const AGREED = [
  ['2026-10', 'ПППП ММППМММ ММППППП ММППМММ ММПППП'],
  ['2026-11', 'П ММППМММ ММППМММ МММММПП ППППППП М'],
  ['2026-12', 'МПППММ ММППППП ММППМММ ММППППП ММПП'],
  ['2027-01', 'МММ ММППППП ММППМММ ММППППП ММППМММ'],
];

/** Запусти один раз из редактора Apps Script. Повторный запуск откажется работать, если события уже есть. */
function seedSchedule() {
  const cal = getCalendar_();
  const days = []; // [{date: Date, who: 'М' | 'П'}]

  AGREED.forEach(function (row) {
    const ym = row[0].split('-').map(Number);
    const letters = row[1].replace(/\s+/g, '');
    const daysInMonth = new Date(ym[0], ym[1], 0).getDate();
    if (letters.length !== daysInMonth) {
      throw new Error(row[0] + ': ' + letters.length + ' дней в строке, а в месяце ' + daysInMonth);
    }
    for (let i = 0; i < letters.length; i++) days.push({ date: new Date(ym[0], ym[1] - 1, i + 1), who: letters[i] });
  });

  const until = parseKey_(SEED_UNTIL);
  for (let d = addDays_(days[days.length - 1].date, 1); d <= until; d = addDays_(d, 1)) {
    days.push({ date: d, who: standardPattern_(d) });
  }

  const first = days[0].date;
  const afterLast = addDays_(days[days.length - 1].date, 1);
  const existing = cal.getEvents(first, afterLast);
  if (existing.length) {
    throw new Error('В календаре уже есть ' + existing.length + ' событий в этом диапазоне. Удали их или сократи диапазон.');
  }

  // Склеиваем подряд идущие дни одного родителя в одно событие на весь день.
  let created = 0;
  for (let i = 0; i < days.length;) {
    let j = i;
    while (j + 1 < days.length && days[j + 1].who === days[i].who) j++;
    const isMom = days[i].who === 'М';
    const ev = cal.createAllDayEvent(isMom ? MOM_TITLE : DAD_TITLE, days[i].date, addDays_(days[j].date, 1));
    ev.setColor(isMom ? CalendarApp.EventColor.PALE_RED : CalendarApp.EventColor.PALE_BLUE);
    created++;
    Utilities.sleep(250); // Google ограничивает частоту создания событий
    i = j + 1;
  }
  Logger.log('Создано событий: ' + created);
}

// Пн–Вт мама, Ср–Чт папа, Пт–Вс по очереди. Выходные 1–3 января 2027 у мамы.
function standardPattern_(d) {
  const dow = d.getDay();
  if (dow === 1 || dow === 2) return 'М';
  if (dow === 3 || dow === 4) return 'П';
  const anchorMonday = new Date(2026, 11, 28);
  const monday = addDays_(d, dow === 0 ? -6 : 1 - dow);
  const weeks = Math.round((monday - anchorMonday) / (7 * 864e5));
  return ((weeks % 2) + 2) % 2 === 0 ? 'М' : 'П';
}

// ---------- helpers ----------

function getCalendar_() {
  const cal = CalendarApp.getCalendarById(CALENDAR_ID);
  if (!cal) throw new Error('Календарь не найден: проверь CALENDAR_ID');
  return cal;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function fmt_(date, tz) {
  return Utilities.formatDate(date, tz, 'yyyy-MM-dd');
}

function parseKey_(s) {
  const p = s.split('-').map(Number);
  return new Date(p[0], p[1] - 1, p[2]);
}

function addDays_(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

function nextDay_(s) {
  return fmt_(addDays_(parseKey_(s), 1), Session.getScriptTimeZone());
}
