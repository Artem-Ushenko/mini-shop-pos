/**
 * ГЕРКУЛЕС ШОП — приймач снапшотів каси → Google Drive (+ Telegram-звіти змін)
 *
 * Каса (PWA) при закритті зміни POST-ить повний JSON-бекап бази сюди,
 * скрипт кладе його файлом у папку Drive і чистить старі снапшоти.
 * Додатково (необов'язково): відкриття/закриття зміни шле звіт у Telegram.
 *
 * Налаштування (разово):
 * 1. drive.google.com → цей скрипт живе в Apps Script (script.google.com),
 *    прив'язки до Таблиці не потрібно — створи standalone-проєкт.
 * 2. Project Settings → Script Properties:
 *      SECRET_TOKEN = довгий випадковий рядок (той самий вводиться в касі)
 * 3. Deploy → New deployment → Web app:
 *      Execute as: Me · Who has access: Anyone
 *    Отриманий URL (…/exec) + токен → каса → «Бекапи» → «Хмарні снапшоти».
 * 4. Перевірка: у касі кнопка «Надіслати снапшот зараз» → файл у папці
 *    «Геркулес Шоп — бекапи каси» на Drive.
 *
 * Telegram-звіти (необов'язково — без них снапшоти працюють як раніше):
 * 5. У Telegram: @BotFather → /newbot → ім'я → юзернейм (закінчується на bot)
 *    → отримаєш BOT_TOKEN.
 * 6. Напиши своєму боту будь-яке повідомлення, потім відкрий у браузері
 *    https://api.telegram.org/bot<BOT_TOKEN>/getUpdates — у відповіді
 *    знайди "chat":{"id":ЧИСЛО} → це CHAT_ID.
 * 7. Script Properties: додай BOT_TOKEN і CHAT_ID.
 * 8. Перевірка: у редакторі Apps Script запусти функцію testBot —
 *    у Telegram має прийти тестове повідомлення.
 *
 * Оновлення коду скрипта = новий deploy (Manage deployments → Edit → New version),
 * інакше URL продовжує виконувати стару версію.
 */

var FOLDER_NAME = 'Геркулес Шоп — бекапи каси';
var RETENTION_DAYS = 30; // снапшоти старші — у кошик Drive

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    var secret = PropertiesService.getScriptProperties().getProperty('SECRET_TOKEN');
    if (!secret) return json_({ ok: false, error: 'SECRET_TOKEN не заданий у Script Properties' });
    if (body.token !== secret) return json_({ ok: false, error: 'невірний токен' });

    var report = typeof body.report === 'string' ? body.report.trim() : '';
    if (!body.snapshot && !report) {
      return json_({ ok: false, error: 'порожній запит: немає ні снапшота, ні звіту' });
    }

    var result = { ok: true };

    if (body.snapshot) {
      // Назва точки → безпечна частина імені файлу
      var loc = String(body.locationName || 'kasa')
        .replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s+/g, '_') || 'kasa';

      var folder = getOrCreateFolder_(FOLDER_NAME);
      var stamp = Utilities.formatDate(new Date(), 'Europe/Kyiv', 'yyyy-MM-dd-HHmm');
      var name = 'kasa-' + loc + '-' + stamp + '.json';

      folder.createFile(name, JSON.stringify(body.snapshot), 'application/json');
      cleanupOld_(folder, 'kasa-' + loc + '-');
      result.file = name;
    }

    // Звіт — best effort: невдача Telegram не має губити снапшот,
    // тому статус повертається окремим полем, а не валить запит.
    if (report) result.telegram = sendTelegram_(report);

    return json_(result);
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// Каса шле готовий HTML-текст (parse_mode HTML) — формат живе в касі,
// щоб зміна тексту звіту не вимагала передеплою цього скрипта.
function sendTelegram_(text) {
  var props = PropertiesService.getScriptProperties();
  var bot = props.getProperty('BOT_TOKEN');
  var chat = props.getProperty('CHAT_ID');
  if (!bot || !chat) return 'not_configured';
  try {
    var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + bot + '/sendMessage', {
      method: 'post',
      payload: { chat_id: chat, text: text.slice(0, 4000), parse_mode: 'HTML' },
      muteHttpExceptions: true,
    });
    var data = JSON.parse(res.getContentText());
    return data.ok ? 'sent' : 'error: ' + (data.description || res.getResponseCode());
  } catch (err) {
    return 'error: ' + err;
  }
}

function getOrCreateFolder_(name) {
  var it = DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : DriveApp.createFolder(name);
}

// Снапшоти цієї точки старші за RETENTION_DAYS — у кошик (відновлювані 30 днів).
function cleanupOld_(folder, prefix) {
  var deadline = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
  var files = folder.getFiles();
  while (files.hasNext()) {
    var f = files.next();
    if (f.getName().indexOf(prefix) === 0 && f.getDateCreated().getTime() < deadline) {
      f.setTrashed(true);
    }
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// Ручна перевірка з редактора: створює папку і тестовий файл.
function testSetup() {
  var folder = getOrCreateFolder_(FOLDER_NAME);
  folder.createFile('kasa-test-' + Date.now() + '.json', '{"test":true}', 'application/json');
  Logger.log('OK, папка: ' + folder.getUrl());
}

// Ручна перевірка Telegram: шле тестове повідомлення (BOT_TOKEN + CHAT_ID).
function testBot() {
  Logger.log(sendTelegram_('🤖 Каса «Геркулес Шоп» підключена до Telegram!'));
}
