const express = require('express');
const fs = require('fs');
const bodyParser = require('body-parser');
const path = require('path');
const PokemonBoosterPriceCalculator = require('./PokemonBoosterPriceCalculator');
const WebSocket = require('ws');
const app = express();
const port = 80;
const jsonFilePath = 'items_simon.json';
const { spawn } = require('child_process');

const calculatorProcess = spawn('node', ['PokemonBoosterPriceCalculator.js']);

calculatorProcess.stdout.on('data', (data) => {
    const messages = data.toString().trim().split('\n');
    messages.forEach(message => {
        try {
            const logData = JSON.parse(message);
            console.log(`[Calculator] Function: ${logData.function}, Data:`, logData.data);
        } catch (error) {
            console.log(`[Calculator] Raw Log: ${message}`);
        }
    });
});

calculatorProcess.stderr.on('data', (data) => {
    console.error(`[Calculator ERROR] ${data.toString()}`);
});

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

const loadItems = () => {
    try {
        const data = fs.readFileSync(jsonFilePath, 'utf8');
        return JSON.parse(data);
    } catch (err) {
        logError('Error reading file:', err);
        return [];
    }
};

const saveItems = (items) => {
    try {
        fs.writeFileSync(jsonFilePath, JSON.stringify(items, null, 2));
        console.log('[ITEMMANAGER] Änderungen wurden gespeichert.');
    } catch (err) {
        logError('Error writing file:', err);
    }
};

const logError = (message, error) => {
    const errorMessage = `${new Date().toISOString()} - ${message} ${error ? error.message : ''}\n`;
    fs.appendFileSync('error.txt', errorMessage);
    console.error(message, error);
};

process.on('uncaughtException', (err) => {
    logError('Uncaught Exception:', err);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logError('Unhandled Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});

class ItemManager {
    constructor(filePath) {
        this.filePath = filePath;
    }
    getItems() {
        return loadItems();
    }
    saveItems(items) {
        saveItems(items);
    }
}

const itemManager = new ItemManager(jsonFilePath);
const calculator = new PokemonBoosterPriceCalculator(itemManager);
const wss = new WebSocket.Server({ noServer: true });

wss.on('connection', (ws) => {
    console.log('[SERVER] Client wurde geöffnet und ist mit dem Server verbunden.');
    ws.on('message', async (message) => {
        try {
            const data = JSON.parse(message);
            if (data.type === 'addItem') {
                const items = itemManager.getItems();
                const item = data.item;
                const index = parseInt(item.index, 10);
                const isValidIndex = !isNaN(index) && index >= 0 && index < items.length;

                if (item.image) {
                    const base64Data = item.image.replace(/^data:image\/\w+;base64,/, "");
                    const filename = `public/uploads/${Date.now()}.png`;
                    fs.writeFileSync(filename, base64Data, 'base64');
                    item.image = `/uploads/${path.basename(filename)}`;
                } else if (isValidIndex) { item.image = items[index].image; }
                
                if (isValidIndex) {
                    item.previousPrice = items[index].price;
                    items[index] = item;
                } else { items.push(item); }

                itemManager.saveItems(items);
                ws.send(JSON.stringify({ type: 'updateItems', items }));
            } else if (data.type === 'pauseUpdate') {
                calculator.pauseUpdate();
                ws.send(JSON.stringify({ type: 'updateStatus', status: 'paused' }));
            } else if (data.type === 'resumeUpdate') {
                calculator.resumeUpdate();
                ws.send(JSON.stringify({ type: 'updateStatus', status: 'resumed' }));
            } else if (data.type === 'stopUpdate') {
                calculator.stopUpdate();
                ws.send(JSON.stringify({ type: 'updateStatus', status: 'stopped' }));
            }
        } catch (err) {
            logError('[SERVER] Websocket Verbindung konnte nicht gestartet werden:', err);
        }
    });
});

const server = app.listen(port, () => {
    console.log(`
         ########################################<br>
         #                                      #<br>
         #   II NN N VV VV EEEE  SSSSS  TTTTTT  #<br>
         #   II N NN  VVV  Eeee  SsssS    TT    #<br>
         #   II N  N   V   EEEE  SSSSS    TT    #<br>
         #                                      #<br>
         #        IG: @ichbinmalkurzweg         #<br>
         #    E-MAIL: simondevde@gmail.com      #<br>
         #                                      #<br>
         ########################################<br>
    `);
    console.log('[SERVER] Itemmanager wurde gestartet.');
    console.log('[SERVER] Booster Preis Kalkulierer wurde gestartet.');
    console.log(`[SERVER] Invest Server wurde gestartet unter http://localhost:${port}`);
    console.log(`---------------------------------------------------------------------`);
    console.log('');
});

server.on('upgrade', (request, socket, head) => {
    wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request);
    });
});

app.get('/api/items', (req, res) => {
    try {
        const items = itemManager.getItems();
        res.json(items);
    } catch (err) {
        logError('[Error] Item wurde nicht gefunden. Grund:', err);
        res.status(500).json({ error: 'Internes Server Problem' });
    }
});

app.delete('/api/items/:index', (req, res) => {
    try {
        const items = itemManager.getItems();
        const index = parseInt(req.params.index, 10);
        if (index >= 0 && index < items.length) {
            items.splice(index, 1);
            itemManager.saveItems(items);
            res.json(items);
        } else {
            res.status(404).json({ error: 'Item nicht gefunden' });
        }
    } catch (err) {
        logError('[ERROR] Item konnte nicht gelöscht werden Grund:', err);
        res.status(500).json({ error: 'Internes Server Problem' });
    }
});

app.post('/api/update-item-price', async (req, res) => {
    try {
        const { index } = req.body;
        const items = itemManager.getItems();
        const item = items[index];

        if (!item) {
            return res.status(404).json({ error: 'Item not found' });
        }

        const currentPrice = await calculator.getPrice(item.link);
        if (currentPrice === null) {
            return res.status(500).json({ error: 'Price could not be retrieved' });
        }

        item.previousPrice = item.price;
        item.price = currentPrice.toFixed(2);
        itemManager.saveItems(items);
        res.json({ message: 'Price successfully updated', item });
    } catch (err) {
        logError('[ERROR] Price could not be updated:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

app.post('/api/resync-prices', async (req, res) => {
    try {
        const ws = [...wss.clients][0];
        await calculator.updatePrices(ws);
        res.json({ message: '[SERVER] Preise wurden erfolgreich synchronisiert.' });
        console.log('[SERVER & BPC] Daten wurden erfolgreich geupdated.');
    } catch (err) {
        logError('[ERROR] Synchronisation konnte nicht realisiert werden. Grund:', err);
        res.status(500).json({ error: 'Internes Server Problem' });
    }
});

module.exports = { app, server, wss };
