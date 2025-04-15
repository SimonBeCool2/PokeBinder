const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const { cleanItems } = require('./cleaner.js');

let mainWindow;
let serverProcess = null;
let child = null;

app.whenReady().then(() => {
    mainWindow = new BrowserWindow({
        width: 900,
        height: 700,
        icon: path.join(__dirname, 'public/images/loader.jpg'),
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false
        }
    });

    mainWindow.loadFile('gui.html');
    Menu.setApplicationMenu(null);
    mainWindow.on('closed', () => {
        stopServer();
        mainWindow = null;
    });
});

// Start the server process
function startServer() {
    if (serverProcess) {
        sendLog("[GUI] Server läuft bereits.");
        return;
    }

    serverProcess = spawn('node', ['server.js']);
    serverRunning = true;

    serverProcess.stdout.on('data', (data) => {
        const text = data.toString();
    
        // Splitte z.B. an Zeilenumbrüchen oder mehreren JSON-Objekten
        const chunks = text.split(/(?<=})\s*(?={)/); // trennt zwischen zwei geschlossenen JSON-Objekten
    
        for (const chunk of chunks) {
            const trimmed = chunk.trim();
    
            if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
                try {
                    const parsed = JSON.parse(trimmed);
                    const message = parsed.data?.trim();
                    if (message) {
                        sendLog(message);
                    }
                } catch (err) {
                    console.warn('JSON konnte nicht geparst werden:', err.message);
                }
            } else {
                // Kein JSON, einfach direkt ausgeben
                sendLog(trimmed);
            }
        }
    });

    serverProcess.stderr.on('data', (data) => {
        sendLog(`[ERROR] ${data.toString()}`);
    });

    serverProcess.on('exit', (code) => {
        sendLog(`[GUI] Server Prozess beendet mit ${code}`);
        serverProcess = null;
        serverRunning = false;
        updateServerStatus();
    });

    sendLog("[GUI] Server wurde gestartet.");
    updateServerStatus(true);

    // Zusätzlicher Debug-Log, um zu überprüfen, ob serverProcess korrekt ist
    sendLog(`[GUI] Serverprozess gestartet: ${serverProcess.pid}`);
}

function stopServer() {
    if (serverProcess) {
        sendLog("[GUI] Server wird gestoppt...");

        try {
            if (serverProcess.pid) {
                process.kill(serverProcess.pid, 'SIGTERM');
            }
        } catch (err) {
            sendLog(`[ERROR] Fehler beim Beenden des Servers: ${err.message}`);
        }

        serverProcess = null;
        updateServerStatus(false);
    } else {
        sendLog("[GUI] Kein Server läuft.");
    }
}

function sendLog(message) {
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('log', message);
    }
}

function updateServerStatus(isRunning) {
    if (mainWindow && !mainWindow.isDestroyed()) { 
        mainWindow.webContents.send('server-status', isRunning);
    }
}

app.on('before-quit', () => {
    if (serverProcess) {
        stopServer();
    }
});

app.on('window-all-closed', () => {
    if (serverProcess) {
        stopServer();
    }

    if (process.platform !== 'darwin') {
        app.quit();
    }
});

ipcMain.on('run-cleaner', () => {
    cleanItems();
  });

ipcMain.on('trigger-auto-update', () => {
    if (serverProcess && serverProcess.stdin.writable) {
        serverProcess.stdin.write(JSON.stringify({ type: 'triggerUpdate' }) + '\n');
    } else {
        sendLog('[GUI] Fehler: Serverprozess läuft nicht oder stdin nicht beschreibbar.');
    }
});

ipcMain.on('cancel-auto-update', () => {
    console.log('[AUTO-UPDATE] Auto Updater gestoppt.');
});
ipcMain.on('start-server', () => startServer());
ipcMain.on('stop-server', () => stopServer());
