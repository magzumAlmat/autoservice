<?php
/**
 * CARX SERVICE — приём заявок с формы записи.
 *
 * Кладётся рядом с index.html. Форма отправляет сюда POST через fetch,
 * скрипт проверяет данные, шлёт письмо на корпоративную почту
 * и дублирует заявку в лог-файл (чтобы ничего не потерялось, если почта упадёт).
 *
 * НАСТРОЙКА — блок ниже, менять нужно только его.
 */
declare(strict_types=1);

/* ═══════════════════ НАСТРОЙКИ ═══════════════════ */

/** Куда приходят заявки. Можно несколько адресов через запятую. */
const MAIL_TO = 'info@carx-service.kz','imarchik9@gmail.com';

/**
 * От какого адреса уходит письмо.
 * ОБЯЗАТЕЛЬНО ящик на вашем домене — иначе письма улетят в спам.
 * Сюда НЕ ставится почта клиента.
 */
const MAIL_FROM = 'noreply@carx-service.kz';

/** Как подписан отправитель в списке писем. */
const MAIL_FROM_NAME = 'CARX SERVICE';

/**
 * Способ отправки:
 *   'mail' — функция PHP mail(). Подходит, если корпоративный ящик заведён
 *            на этом же хостинге. Настраивать больше ничего не нужно.
 *   'smtp' — отправка через SMTP. Нужна, если почта на Yandex 360,
 *            Google Workspace, Mail.ru и т. п. Заполните SMTP_* ниже.
 */
const MAIL_MODE = 'mail';

/* Параметры SMTP — заполняются только при MAIL_MODE = 'smtp' */
const SMTP_HOST   = 'smtp.yandex.ru';  // Google: smtp.gmail.com, Mail.ru: smtp.mail.ru
const SMTP_PORT   = 465;               // 465 — SSL, 587 — STARTTLS
const SMTP_SECURE = 'ssl';             // 'ssl' для порта 465, 'tls' для 587
const SMTP_USER   = 'noreply@carx-service.kz';
const SMTP_PASS   = '87762193402imar95'; // НЕ обычный пароль от почты — см. README

/** Лимит заявок с одного IP в час — защита от спам-ботов. */
const RATE_LIMIT = 15;

/** Резервный лог заявок. Каталог должен быть НЕ доступен из браузера. */
const LOG_FILE = __DIR__ . '/../carx-orders.log';

/** Телефон, который показываем клиенту, если отправка сорвалась. */
const FALLBACK_PHONE = '+7 (776) 219-34-02';

/* ═════════════════ КОНЕЦ НАСТРОЕК ═════════════════ */


header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

/** Единая точка выхода: всегда отдаём JSON. */
function reply(bool $ok, string $error = '', int $code = 200): void
{
    http_response_code($code);
    echo json_encode(
        $ok ? ['ok' => true] : ['ok' => false, 'error' => $error],
        JSON_UNESCAPED_UNICODE
    );
    exit;
}

/**
 * Убирает переводы строк из коротких полей.
 * Без этого через форму можно дописать свои заголовки в письмо
 * и рассылать спам от вашего имени (header injection).
 */
function clean(string $v, int $max = 300): string
{
    $v = str_replace(["\r", "\n", "\0", '%0a', '%0d'], ' ', $v);
    $v = trim((string)preg_replace('/\s+/u', ' ', $v));
    return mb_substr($v, 0, $max);
}

/** Многострочное поле: переносы строк оставляем, управляющие символы убираем. */
function cleanMultiline(string $v, int $max = 2000): string
{
    $v = str_replace(["\r\n", "\r", "\0"], ["\n", "\n", ''], $v);
    return mb_substr(trim($v), 0, $max);
}

/** Кодирует тему письма по RFC 2047 — иначе кириллица станет кракозябрами. */
function encodeHeader(string $s): string
{
    if (function_exists('mb_encode_mimeheader')) {
        mb_internal_encoding('UTF-8');
        return mb_encode_mimeheader($s, 'UTF-8', 'B', "\r\n");
    }
    return '=?UTF-8?B?' . base64_encode($s) . '?=';
}


/* ─────────── 1. Метод и защита от ботов ─────────── */

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') {
    reply(false, 'Метод не поддерживается', 405);
}

// Honeypot: скрытое поле, которое человек не видит и не заполняет.
// Боты заполняют все поля подряд. Отвечаем «ок», чтобы бот не подбирал обход.
if (clean((string)($_POST['website'] ?? '')) !== '') {
    reply(true);
}


/* ─────────── 2. Ограничение частоты ─────────── */

$ip   = (string)($_SERVER['REMOTE_ADDR'] ?? '0.0.0.0');
$slot = sys_get_temp_dir() . '/carx_rate_' . md5($ip . date('YmdH')) . '.tmp';
$hits = (int)@file_get_contents($slot);
if ($hits >= RATE_LIMIT) {
    reply(false, 'Слишком много заявок подряд. Позвоните нам: ' . FALLBACK_PHONE, 429);
}
@file_put_contents($slot, (string)($hits + 1), LOCK_EX);


/* ─────────── 3. Проверка полей ─────────── */
/* Повторяет проверки из main.js: клиентскую валидацию легко обойти. */

$name    = clean((string)($_POST['name'] ?? ''), 100);
$phone   = clean((string)($_POST['phone'] ?? ''), 30);
$car     = clean((string)($_POST['car'] ?? ''), 100);
$service = clean((string)($_POST['service'] ?? ''), 100);
$date    = clean((string)($_POST['date'] ?? ''), 20);
$time    = clean((string)($_POST['time'] ?? ''), 30);
$message = cleanMultiline((string)($_POST['message'] ?? ''));
$agree   = isset($_POST['agree']);

$digits = (string)preg_replace('/\D/', '', $phone);

if (mb_strlen($name) < 2) reply(false, 'Укажите имя');
if (strlen($digits) !== 11) reply(false, 'Проверьте номер телефона');
if ($service === '') reply(false, 'Выберите услугу');
if (!$agree) reply(false, 'Нужно согласие на обработку данных');
if ($date !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
    $date = '';
}


/* ─────────── 4. Текст письма ─────────── */

$subject = 'Заявка с сайта: ' . $service . ' — ' . $name;

$rows = [
    'Имя'        => $name,
    'Телефон'    => $phone,
    'Автомобиль' => $car !== '' ? $car : '—',
    'Услуга'     => $service,
    'Дата'       => $date !== '' ? $date : 'не указана',
    'Время'      => $time !== '' ? $time : 'не важно',
];

$body = "Новая заявка с сайта carx-service.kz\n";
$body .= str_repeat('=', 42) . "\n\n";
foreach ($rows as $label => $value) {
    $body .= sprintf("%-12s %s\n", $label . ':', $value);
}
if ($message !== '') {
    $body .= "\nОписание проблемы:\n" . $message . "\n";
}
$body .= "\n" . str_repeat('-', 42) . "\n";
$body .= 'Отправлено: ' . date('d.m.Y H:i') . "\n";
$body .= 'IP: ' . $ip . "\n";


/* ─────────── 5. Резервный лог ─────────── */
/* Пишем ДО отправки: если почта отвалится, заявка всё равно сохранится. */

@file_put_contents(
    LOG_FILE,
    implode(' | ', [date('Y-m-d H:i:s'), $name, $phone, $car, $service, $date, $time]) . "\n",
    FILE_APPEND | LOCK_EX
);


/* ─────────── 6. Отправка ─────────── */

$sent = MAIL_MODE === 'smtp'
    ? sendViaSmtp(MAIL_TO, $subject, $body)
    : sendViaMail(MAIL_TO, $subject, $body);

if (!$sent) {
    reply(false, 'Не удалось отправить заявку. Позвоните нам: ' . FALLBACK_PHONE, 500);
}

reply(true);


/* ═══════════════ ФУНКЦИИ ОТПРАВКИ ═══════════════ */

/** Через встроенную функцию PHP. Работает, если ящик на этом же хостинге. */
function sendViaMail(string $to, string $subject, string $body): bool
{
    $headers = implode("\r\n", [
        'From: ' . encodeHeader(MAIL_FROM_NAME) . ' <' . MAIL_FROM . '>',
        'Reply-To: ' . MAIL_FROM,
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        'X-Mailer: CARX SERVICE form',
    ]);

    // -f задаёт конверт-отправителя. Без него хостинг подставит адрес вида
    // www-data@server123.hoster.kz, и письмо почти наверняка уйдёт в спам.
    return @mail($to, encodeHeader($subject), $body, $headers, '-f' . MAIL_FROM);
}

/**
 * Через SMTP, без внешних библиотек.
 * Нужна, когда корпоративная почта живёт не на хостинге (Yandex, Google, Mail.ru).
 */
function sendViaSmtp(string $to, string $subject, string $body): bool
{
    $host = (SMTP_SECURE === 'ssl' ? 'ssl://' : '') . SMTP_HOST;
    $fp = @fsockopen($host, SMTP_PORT, $errno, $errstr, 15);
    if (!$fp) {
        error_log('CARX SMTP: нет соединения с ' . SMTP_HOST . ': ' . $errstr);
        return false;
    }
    stream_set_timeout($fp, 15);

    /** Читает ответ сервера и сверяет код (многострочные ответы дочитываем до конца). */
    $expect = static function ($fp, string $code): bool {
        do {
            $line = fgets($fp, 515);
            if ($line === false) {
                return false;
            }
        } while (isset($line[3]) && $line[3] === '-');
        // strncmp, а не str_starts_with: последняя появилась только в PHP 8.0,
        // а на шаред-хостинге может быть выбран PHP 7.4.
        return strncmp($line, $code, 3) === 0;
    };
    $say = static function ($fp, string $cmd): void {
        fwrite($fp, $cmd . "\r\n");
    };

    $helo = 'EHLO ' . (string)($_SERVER['HTTP_HOST'] ?? 'localhost');

    $ok = $expect($fp, '220');
    $say($fp, $helo);
    $ok = $ok && $expect($fp, '250');

    if ($ok && SMTP_SECURE === 'tls') {
        $say($fp, 'STARTTLS');
        $ok = $expect($fp, '220')
            && stream_socket_enable_crypto($fp, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
        $say($fp, $helo);
        $ok = $ok && $expect($fp, '250');
    }

    $say($fp, 'AUTH LOGIN');
    $ok = $ok && $expect($fp, '334');
    $say($fp, base64_encode(SMTP_USER));
    $ok = $ok && $expect($fp, '334');
    $say($fp, base64_encode(SMTP_PASS));
    $ok = $ok && $expect($fp, '235');

    if (!$ok) {
        error_log('CARX SMTP: не прошла авторизация — проверьте SMTP_USER и SMTP_PASS');
        fclose($fp);
        return false;
    }

    $say($fp, 'MAIL FROM:<' . MAIL_FROM . '>');
    $ok = $ok && $expect($fp, '250');

    foreach (array_map('trim', explode(',', $to)) as $rcpt) {
        $say($fp, 'RCPT TO:<' . $rcpt . '>');
        $ok = $ok && $expect($fp, '250');
    }

    $say($fp, 'DATA');
    $ok = $ok && $expect($fp, '354');

    // Точку в начале строки удваиваем — иначе письмо оборвётся на ней (RFC 5321).
    $safeBody = (string)preg_replace('/^\./m', '..', str_replace("\n", "\r\n", $body));

    $say($fp, implode("\r\n", [
        'From: ' . encodeHeader(MAIL_FROM_NAME) . ' <' . MAIL_FROM . '>',
        'To: ' . $to,
        'Subject: ' . encodeHeader($subject),
        'Date: ' . date('r'),
        'MIME-Version: 1.0',
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: 8bit',
        '',
        $safeBody,
        '.',
    ]));
    $ok = $ok && $expect($fp, '250');

    $say($fp, 'QUIT');
    fclose($fp);

    if (!$ok) {
        error_log('CARX SMTP: сервер отклонил письмо');
    }
    return $ok;
}
