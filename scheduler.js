const schedule = require('node-schedule');
const PokemonBoosterPriceCalculator = require('./PokemonBoosterPriceCalculator');
const ItemManager = require('./ItemManager');
const WebSocket = require('ws');

const itemManager = new ItemManager('items_simon.json');
const calculator = new PokemonBoosterPriceCalculator(itemManager);
const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws) => {
    console.log('[SERVER] Client verbunden.');
});

// Funktion zum Aktualisieren der Preise
const updatePrices = async () => {
    const ws = [...wss.clients][0];
    if (ws && ws.readyState === WebSocket.OPEN) {
        await calculator.updatePrices(ws);
        console.log('[SCHEDULER] Preise wurden aktualisiert.');
    } else {
        console.log('[SCHEDULER] Kein WebSocket-Client verbunden.');
    }
};

// Scheduler, der die Preise jeden Tag um 3 Uhr morgens aktualisiert
const job = schedule.scheduleJob('0 3 * * *', updatePrices);
console.log('[SCHEDULER] Scheduler gestartet. Preise werden jeden Tag um 3 Uhr morgens aktualisiert.');
