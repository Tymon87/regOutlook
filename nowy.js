const { executablePath } = require('puppeteer');
const csv = require('csv-parser');
const fs = require('fs');
const path = require('path');
const { plugin } = require('puppeteer-with-fingerprints');
const axios = require('axios');
const querystring = require('querystring');
const express = require('express');

// Import konfiguracji (upewnij się, że ścieżka jest poprawna względem lokalizacji nowy.js)
const config = require('./config/config');

let app;
const results = [];

async function startTokenListener() {
    app = express();
    const port = config.server.port;

    app.get('/auth', (req, res) => {
        const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${config.oauth.clientId}&response_type=code&redirect_uri=${config.server.redirectUri}&response_mode=query&scope=${config.oauth.scope}&state=12345`;
        res.redirect(authUrl);
    });

    app.get('/callback', async (req, res) => {
        const { code, state } = req.query;
        if (!code) return res.status(400).send('Brak kodu autoryzacji.');

        try {
            const tokenResponse = await axios.post(`https://login.microsoftonline.com/common/oauth2/v2.0/token`, querystring.stringify({
                client_id: config.oauth.clientId,
                client_secret: config.oauth.clientSecret,
                code: code,
                redirect_uri: config.server.redirectUri,
                grant_type: 'authorization_code',
                scope: config.oauth.scope
            }), {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            const { access_token, refresh_token } = tokenResponse.data;
            const tokenData = `${state}\t${access_token}\t${refresh_token}\n`;

            // Użycie ścieżki z config
            await fs.promises.appendFile(config.files.tokens, tokenData);
            res.send(`Tokeny zapisane dla: ${state}`);
        } catch (error) {
            console.error('Błąd tokenu:', error.response ? error.response.data : error.message);
            res.status(500).send('Błąd przy uzyskiwaniu tokenu.');
        }
    });

    app.listen(port, () => {
        console.log(`Serwer działa na ${config.server.redirectUri}`);
    });
}

async function getToken(email, page) {
    const authUrl = `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=${config.oauth.clientId}&response_type=code&redirect_uri=${config.server.redirectUri}&response_mode=query&scope=${config.oauth.scope}&state=${email}`;

    await page.goto(authUrl, { waitUntil: 'domcontentloaded' });
    await page.waitForNavigation({ waitUntil: 'domcontentloaded' }).catch(() => {});
    await new Promise(r => setTimeout(r, 10000));

    await page.waitForSelector('input[name="ucaccept"]');
    await page.click('input[name="ucaccept"]');

    await new Promise((resolve, reject) => {
        const checkFile = setInterval(() => {
            if (fs.existsSync(config.files.tokens)) {
                const tokens = fs.readFileSync(config.files.tokens, 'utf8');
                if (tokens.includes(email)) {
                    clearInterval(checkFile);
                    resolve();
                }
            }
        }, 1000);
        setTimeout(() => { clearInterval(checkFile); reject(new Error("Timeout zapisu")); }, 60000);
    });
}

async function main() {
    await startTokenListener();

    // Użycie ustawień CSV z config
    fs.createReadStream(config.files.csv)
        .pipe(csv({
            separator: config.csv.separator,
            headers: config.csv.headers.length > 0 ? config.csv.headers : undefined
        }))
        .on('data', (data) => results.push(data))
        .on('end', async () => {
            if (results.length === 0) return console.log("Brak danych w CSV.");

            for (let i = 0; i < results.length; i++) {
                const result = results[i];
                console.log(`Przetwarzam ${result.email} [${i + 1}]`);

                plugin.setServiceKey(config.capsolver.apiKey);
                const capsolverPath = path.join(__dirname, 'capsolver');

                const fingerprint = await plugin.fetch(config.fingerprint);
                plugin.useFingerprint(fingerprint, { perfectCanvasLogs: true });

                if (config.proxy.url) {
                    plugin.useProxy(config.proxy.url);
                }

                const browser = await plugin.launch({
                    headless: false,
                    args: [`--disable-extensions-except=${capsolverPath}`, `--load-extensions=${capsolverPath}`],
                    executablePath: executablePath()
                });

                const page = await browser.newPage();

                try {
                    // Logika wypełniania formularza pozostaje bez zmian,
                    // ale korzysta z danych 'result' wczytanych z CSV
                    await page.goto('http://httpbin.org/ip');

                    // ... reszta Twojej logiki (wpisywanie imienia, nazwiska itd.) ...

                    await getToken(result.email, page);
                    console.log("Proces zakończony dla: " + result.email);
                } catch (error) {
                    console.error("Błąd:", error);
                } finally {
                    await browser.close();
                }
            }
        });
}

main().catch(console.error);
