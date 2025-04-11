const puppeteer = require('puppeteer');
const cheerio = require('cheerio');
const cliProgress = require('cli-progress');
const WebSocket = require('ws');
const fs = require('fs');
const QuickChart = require('quickchart-js');
const { randomInt } = require('crypto');
const { chromium } = require('playwright');
const { ipcRenderer } = require('electron');

class PokemonBoosterPriceCalculator {
    constructor(itemManager) {
        this.itemManager = itemManager;
        this.isPaused = false;
        this.isStopped = false;
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
            'Mozilla/5.0 (Windows NT 6.1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/109.0.0.0 Safari/537.36 Edg/109.0.1518.10',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.3',
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/112.0.0.'
        ];
    }

    logToGUI(data) {
        const logMessage = JSON.stringify({ data });
        process.stdout.write(logMessage + '\n');
    }

    randomInt(min, max) {
        return Math.floor(Math.random() * (max - min + 1)) + min;
    }

    async fetchPageContent(url, retries = 3) {
        if (url.includes('localhost')) {
            return null;
        }

        for (let attempt = 1; attempt <= retries; attempt++) {
            let browser;
            try {
                browser = await chromium.launch();
                const userAgent = this.userAgents[this.randomInt(0, this.userAgents.length - 1)];
                const context = await browser.newContext({
                    userAgent: userAgent,
                    extraHTTPHeaders: {
                        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
                        'Accept-Language': 'en-US,en;q=0.5',
                        'Connection': 'keep-alive',
                        'Cookie': '0jn7e8e9lcrv0ecm3jmrdf4aig'
                    }
                });
                const page = await context.newPage();
                await page.goto(url, { waitUntil: 'networkidle' });
                const content = await page.content();
                await browser.close();
                return content;
            } catch (error) {
                if (browser) {
                    await browser.close();
                }
                if (error.message.includes('429')) {
                    this.logToGUI(`[SERVER] 429 Too Many Requests for ${url}, retrying in ${attempt * 2} seconds...`);
                    await new Promise(resolve => setTimeout(resolve, attempt * 2000));
                } else {
                    console.error(`[SERVER] Failed to load data from ${url}: ${error.message}`);
                    return null;
                }
            }
        }
        return null;
    }

    parsePriceFromCardmarket($) {
        const parsePrice = (element) => {
            let priceText = $(element).text().trim();
            priceText = priceText.replace('€', '').trim();
            priceText = priceText.replace(/\.(?=\d{3})/g, '');
            priceText = priceText.replace(',', '.');
            return parseFloat(priceText);
        };

        const prices = [];

        $(".table-body .article-row").slice(0, 10).each((index, element) => {
            const priceElement = $(element).find(".col-offer.col-auto .color-primary.small.text-end.text-nowrap.fw-bold");
            if (priceElement.length > 0) {
                const price = parsePrice(priceElement.first());
                if (!isNaN(price)) {
                    prices.push(price);
                }
            }
        });
    
        if (prices.length > 0) {
            const total = prices.reduce((sum, price) => sum + price, 0);
            return total / prices.length;
        }
        return null;
    }

    parsePriceFromPokecheck($) {
        const priceNode = $("li.col-auto.mx-3 h3.h5.mb-0:contains('Durchschnittspreis')").next('span.d-block');
        if (priceNode.length) {
            const price = parseFloat(priceNode.text().trim().replace('€', '').replace(',', '.'));
            return isNaN(price) ? null : price;
        }
        return null;
    }

    async getPrice(url, retries = 3) {
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const data = await this.fetchPageContent(url);
                if (!data) return null;
    
                const $ = cheerio.load(data);
                let price = this.extractPrice(url, $);
    
                if (price !== null) {
                    return price;
                } else {
                    this.logToGUI(`[SERVER] Preis nicht gefunden für ${url}, Versuch ${attempt} von ${retries}`);
                    await this.delay(randomInt(1000, 3000)); // Random delay between 1-3 seconds
                }
            } catch (error) {
                this.logError(`[SERVER] Fehler beim Abrufen des Preises für ${url}: ${error.message}`);
            }
        }
        return null;
    }
    
    extractPrice(url, $) {
        if (url.includes('cardmarket.com')) {
            return this.parsePriceFromCardmarket($);
        } else if (url.includes('pokecheck.de')) {
            return this.parsePriceFromPokecheck($);
        } else {
            this.logError(`[SERVER] Nicht supporteter Link: ${url}`);
            return null;
        }
    }
    
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async updatePrices(ws) {
        const items = this.itemManager.getItems();
        const progressBar = new cliProgress.SingleBar({
            format: '\n[SERVER]{bar}| {percentage}% || {value}/{total} || ',
            hideCursor: true
        }, cliProgress.Presets.shades_classic);
        progressBar.start(items.length, 0);
    
        let totalValue = 0;
        let hasUpdates = false;
    
        const sendWebSocketMessage = (message) => {
            if (ws && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify(message));
            }
        };
    
        for (const [index, item] of items.entries()) {
            if (this.isStopped) break;
    
            while (this.isPaused) {
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
    
            this.logToGUI(`Sammlerstück: ${item.name}`);
    
            if (!item.link) {
                this.logToGUI(`[SERVER] Übersprungenes Item: ${item.name} hat keinen Link.`);
                continue;
            }
    
            try {
                const currentPrice = await this.getPrice(item.link);
                if (currentPrice === null) {
                    this.logToGUI(`[SERVER] Kein Preis gefunden für ${item.name}`);
                    continue;
                }
    
                const filePath = `./prices/${item.name}.json`;
                let startPrice = currentPrice;
                if (fs.existsSync(filePath)) {
                    const priceHistory = JSON.parse(fs.readFileSync(filePath));
                    if (priceHistory.length > 0) {
                        startPrice = parseFloat(priceHistory[0].price);
                    }
                }
    
                const previousPrice = parseFloat(item.price);
                if (currentPrice.toFixed(2) === previousPrice.toFixed(2)) {
                    this.logToGUI(`[SERVER] Kein Preisupdate für ${item.name} (Preis bleibt: ${currentPrice.toFixed(2)} €)`);
                    continue;
                }
    
                const priceChangePercentage = (((currentPrice - startPrice) / startPrice) * 100);

                item.previousPrice = previousPrice;
                this.logToGUI(`[PBC] Neuer Preis für ${item.name} | ALT: ${previousPrice.toFixed(2)} € NEU: ${currentPrice.toFixed(2)} € | StartPreis: ${startPrice.toFixed(2)}€ Änderung: ${priceChangePercentage.toFixed(2)}%`);
                item.price = currentPrice.toFixed(2);
                item.changePercentage = priceChangePercentage.toFixed(2);
                hasUpdates = true;

                this.saveDailyPrice(item.name, currentPrice);
                totalValue += currentPrice * item.in_stock;
                await this.generateCharts(item);
    
                sendWebSocketMessage({
                    type: 'priceUpdate',
                    item: {
                        name: item.name,
                        price: currentPrice.toFixed(2),
                        changePercentage: item.changePercentage
                    },
                    totalValue: totalValue.toFixed(2)
                });
    
            } catch (error) {
                this.logError(`[SERVER] Fehler beim Abrufen des Preises für ${item.name}: ${error.message}`);
            }
    
            progressBar.increment();
            sendWebSocketMessage({ progress: ((index + 1) / items.length) * 100 });
        }
    
        progressBar.stop();
        this.itemManager.saveItems(items);
        this.cleanPrices();
    
        if (!hasUpdates) {
            sendWebSocketMessage({ type: 'noUpdates' });
        }
    
        this.isPaused = false;
        this.isStopped = false;
    }
    

    saveDailyPrice(itemName, price) {
        const date = new Date().toISOString().split('T')[0];
        const filePath = `./prices/${itemName}.json`;
        let data = [];
        if (fs.existsSync(filePath)) {
            data = JSON.parse(fs.readFileSync(filePath));
        }
        data.push({ date, price });
        fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    }

    cleanPrices() {
        const items = this.itemManager.getItems();
        for (const item of items) {
            const filePath = `./prices/${item.name}.json`;
            if (fs.existsSync(filePath)) {
                let data = JSON.parse(fs.readFileSync(filePath));
                const cleanedData = data.reduce((acc, entry) => {
                    const existingEntry = acc.find(e => e.date === entry.date);
                    if (existingEntry) {
                        if (entry.price > existingEntry.price) {
                            existingEntry.price = entry.price;
                        }
                    } else { acc.push(entry); }
                    return acc;
                }, []);
                fs.writeFileSync(filePath, JSON.stringify(cleanedData, null, 2));
            }
        }
    }

    async generateCharts(item) {
        const filePath = `./prices/${item.name}.json`;
        if (fs.existsSync(filePath)) {
            const data = JSON.parse(fs.readFileSync(filePath));
            const labels = data.map(entry => entry.date);
            const prices = data.map(entry => entry.price);
            await this.generateChartImage(item.name, labels, prices);
        }
    }

    async generateChartImage(itemName, labels, prices) {
        const chart = new QuickChart();
        chart.setConfig({
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: itemName,
                    data: prices,
                    fill: false,
                    borderColor: 'rgb(12 20 31)',
                    tension: 0.5
                }]
            },
            options: {
                scales: {
                    yAxes: [{
                        ticks: {
                            beginAtZero: false,
                            callback: (val) => {
                                return val.toLocaleString() + '€';
                            },
                        }
                    }]
                }
            }
        });

        try {
            const imageUrl = chart.getUrl();
            const response = await import('node-fetch').then(module => module.default(imageUrl));
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            fs.writeFileSync(`./public/charts/${itemName}.png`, buffer);
            this.logToGUI(`[SERVER] Graph wurde erstellt für ${itemName}.`);
        } catch (error) {
            this.logError(`[SERVER] Error Graph konnte nicht für ${itemName} hergestellt werden. Grund: ${error.message}`);
        }
    }

    logError(message) {
        const errorMessage = `${new Date().toISOString()} - ${message}\n`;
        fs.appendFileSync('error.txt', errorMessage);
    }
    pauseUpdate() {this.isPaused = true;}
    resumeUpdate() {this.isPaused = false;}
    stopUpdate() {this.isStopped = true;}
}

if (!fs.existsSync('./prices')) {
    fs.mkdirSync('./prices');
}
if (!fs.existsSync('./public/charts')) {
    fs.mkdirSync('./public/charts');
}

module.exports = PokemonBoosterPriceCalculator;
