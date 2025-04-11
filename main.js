const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

let mainWindow;
let serverProcess = null;

app.whenReady().then(() => {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
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
        sendLog(`[SERVER] ${data.toString()}`);
    });

    serverProcess.stderr.on('data', (data) => {
        sendLog(`[ERROR] ${data.toString()}`);
    });

    serverProcess.on('exit', (code) => {
        sendLog(`[SERVER] Beendet mit Code ${code}`);
        serverProcess = null;
        serverRunning = false;
        updateServerStatus();
    });

    sendLog("[GUI] Server wurde gestartet.");
    updateServerStatus(true);
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

ipcMain.on('start-server', () => startServer());
ipcMain.on('stop-server', () => stopServer());
