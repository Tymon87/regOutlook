// nowy.js
const { executablePath } = require('puppeteer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const { plugin } = require('puppeteer-with-fingerprints');
const axios = require('axios');
const querystring = require('querystring');
const express = require('express');

// <-- centralna konfiguracja
const config = require('./config/config');

let app;
const results = [];

/**
 * Prosty logger z timestampem.
 */
function log(...args) {
  const ts = new Date().toISOString();
  console.log(`[${ts}]`, ...args);
}

/**
 * Serwer do obsługi OAuth redirect i zapisu tokenów do pliku (config.files.tokens).
 * Endpointy:
 *   GET /auth?state=<email>  -> redirect do MS login
 *   GET /callback?code=...   -> wymiana kodu na tokeny i ich zapis
 */
async function startTokenListener() {
  app = express();
  const port = config.server.port;

  const { clientId, clientSecret, scope, tenant } = config.oauth;
  const redirectUri = config.server.redirectUri;

  // 1) Start autoryzacji
  app.get('/auth', (req, res) => {
    const state = req.query.state || 'state';
    const authUrl =
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize` +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&response_type=code` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&response_mode=query` +
      `&scope=${encodeURIComponent(scope)}` +
      `&state=${encodeURIComponent(state)}`;
    res.redirect(authUrl);
  });

  // 2) Callback z kodem -> tokeny
  app.get('/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!code) return res.status(400).send('Brak kodu autoryzacji.');

    try {
      const tokenResponse = await axios.post(
        `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
        querystring.stringify({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          scope
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );

      const { access_token, refresh_token } = tokenResponse.data;

      // Zapisujemy jako: <email>\t<access>\t<refresh>
      const tokenData = `${state}\t${access_token}\t${refresh_token}\n`;
      await fs.promises.appendFile(config.files.tokens, tokenData);

      res.send(`Tokeny zapisane dla: ${state}`);
      log('Zapisano tokeny dla:', state);
    } catch (error) {
      const errTxt = error?.response?.data || error?.message || String(error);
      log('Błąd przy uzyskiwaniu tokenu:', errTxt);
      res.status(500).send('Błąd przy uzyskiwaniu tokenu.');
    }
  });

  app.listen(port, () => {
    log(`OAuth nasłuchuje na http://localhost:${port}`);
  });
}

/**
 * Uruchamia flow pobrania tokenu dla danego emaila.
 * Wejście: email (state) + strona puppeteera (przeglądarka już otwarta).
 * Kończy się, gdy w pliku tokenów pojawi się linia z danym emailem lub minie timeout.
 */
async function getToken(email, page) {
  const { clientId, scope, tenant } = config.oauth;
  const redirectUri = config.server.redirectUri;

  const authUrl =
    `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize` +
    `?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_mode=query` +
    `&scope=${encodeURIComponent(scope)}` +
    `&state=${encodeURIComponent(email)}`;

  log('Przejście do MS login dla:', email);
  await page.goto(authUrl, { waitUntil: 'domcontentloaded', timeout: 120000 }).catch(() => {});
  await page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});

  // (Opcjonalne) zaakceptowanie ciasteczek, jeśli jest checkbox/przycisk:
  try {
    await page.waitForSelector('input[name="ucaccept"], button#accept', { timeout: 3000 }).catch(() => {});
    const accept = await page.$('input[name="ucaccept"], button#accept');
    if (accept) {
      await accept.click().catch(() => {});
      await page.waitForTimeout(1500);
    }
  } catch {}

  // Oczekiwanie na zapis tokenu w pliku
  await waitForTokenSaved(email, 90_000);
  log('Token zapisany dla:', email);
}

/**
 * Polling pliku z tokenami aż pojawi się linia zawierająca email.
 */
function waitForTokenSaved(email, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const int = setInterval(() => {
      try {
        if (fs.existsSync(config.files.tokens)) {
          const content = fs.readFileSync(config.files.tokens, 'utf8');
          if (content.includes(email)) {
            clearInterval(int);
            return resolve();
          }
        }
      } catch {}
      if (Date.now() - started > timeoutMs) {
        clearInterval(int);
        return reject(new Error('Token save timed out'));
      }
    }, 1000);
  });
}

/**
 * Wczytanie CSV (np. dane do logowania, maile, itp.).
 * Zmienna `results` będzie tablicą obiektów (kolumny -> klucze).
 */
 async function readCsv() {
   return new Promise((resolve, reject) => {
     const csvOpts = {
       separator: config.csv.separator,                 // np. ';'
       headers: config.csv.headers.length ? config.csv.headers : undefined, // narzucone nagłówki
       skipLines: 0,
       strict: false,
       mapHeaders: ({ header }) => header.trim(),
       mapValues: ({ value }) => (typeof value === 'string' ? value.trim() : value),
     };

     fs.createReadStream(config.files.csv)
       .pipe(csv(csvOpts))
       .on('data', (data) => results.push(data))
       .on('end', () => {
         log(`Wczytano wierszy z CSV: ${results.length}`);
         resolve();
       })
       .on('error', (err) => reject(err));
   });
 }

/**
 * Przygotowanie fingerprintu, proxy i uruchomienie przeglądarki z pluginem.
 */
async function prepareBrowser() {
  // CapSolver key
  if (config.capsolver.apiKey) plugin.setServiceKey(config.capsolver.apiKey);

  // Fingerprint
  const fingerprint = await plugin.fetch({
    tags: config.fingerprint.tags,
    minHeight: config.fingerprint.minHeight,
    maxHeight: config.fingerprint.maxHeight,
    minWidth: config.fingerprint.minWidth,
    maxWidth: config.fingerprint.maxWidth,
  });
  plugin.useFingerprint(fingerprint, { perfectCanvasLogs: true });

  // Proxy (pojedyncze lub z pliku – jeśli używasz helpers/proxy.js, tu możesz rotować)
  if (config.proxy.url) {
    plugin.useProxy(config.proxy.url, {
      // detectExternalIP: true,
      // changeBrowserLanguage: true,
      // changeGeolocation: true,
      // changeTimezone: true,
    });
  }

  const browser = await plugin.launch({
    headless: false,
    fingerprint: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
    ],
    executablePath: executablePath()
  });

  const page = await browser.newPage();
  return { browser, page };
}

/**
 * (Opcjonalne) Funkcja sprawdzająca IP widoczne na zewnątrz (diagnostyka proxy).
 */
async function getExternalIP(page) {
  try {
    await page.goto('https://api.ipify.org?format=json', { waitUntil: 'networkidle2', timeout: 60000 });
    const body = await page.evaluate(() => document.body.innerText);
    return body;
  } catch (e) {
    return 'Nie udało się pobrać IP';
  }
}

/**
 * Główna procedura.
 * 1) Start serwera OAuth
 * 2) Wczytaj CSV
 * 3) Dla każdego rekordu: uruchom przeglądarkę (lub reuse), pobierz token, (opcjonalnie) zmień IP / wykonaj akcje.
 */
async function main() {
  // 1) OAuth callback server
  await startTokenListener();

  // 2) CSV
  await readCsv();

  // 3) Przetwarzanie rekordów
  for (let i = 0; i < results.length; i++) {
    const row = results[i];
    // Zakładamy, że w CSV jest kolumna "email" (dopasuj do swojego pliku)
    const email = (row.email || row.Email || row.login || '').trim();
    if (!email) {
      log(`Wiersz ${i + 1}: brak pola email — pomijam`);
      continue;
    }

    log(`Przetwarzam ${email} [${i + 1}/${results.length}]`);

    try {
    const { browser, page } = await prepareBrowser(); // ✅ poprawione

      // 3a) Poproś o token (przeglądarka przejdzie do logowania Microsoft)
      await getToken(email, page);

      // 3b) (opcjonalnie) Sprawdź aktualne IP, jeśli używasz proxy i chcesz logować
      const ipInfo = await getExternalIP(page);
      log('IP info:', ipInfo);

      // 3c) TODO: tu dodaj właściwą logikę (np. klikanie btnSendCode, wklejanie kodów z CSV,
      //          kliknięcia w mfa_send_mfa_code_span, pola mfa_code_input, itp.)
      // Przykład (dopasuj selektory do realnej strony!):
      // await page.click('#btnSendCode');
      // await page.type('#code_input', row.code1); // np. jedna z kolumn CSV
      // await page.click('#btnSubmit');
      // await page.waitForNavigation({ waitUntil: 'networkidle2' });
      // await page.click('#editSecuritySection2');
      // await page.click('#mfa_send_mfa_code_span');
      // await page.type('#mfa_code_input', row.code2);

      log('Finished processing:', email);
    } catch (error) {
      log('Błąd podczas przetwarzania', email, '-', error?.message || error);
    } finally {
      if (browser) {
        try { await browser.close(); } catch {}
      }
    }
  }

  log('Zakończono pracę skryptu.');
}

main().catch((e) => log('Fatal error:', e));
