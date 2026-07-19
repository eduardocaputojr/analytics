// Processo principal do Electron — empacota o app Next (que tem rotas /api).
// Em produção, sobe o servidor "standalone" do Next e abre a janela nele;
// assim o motor Local (Ollama) e as rotas funcionam 100% offline no desktop.

const { app, BrowserWindow, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const http = require("http");
const { fork } = require("child_process");

const PORT = process.env.PORT || "34567";
const HOST = "127.0.0.1";
const APP_URL = `http://${HOST}:${PORT}`;

// [BE-9] Teto de reinícios automáticos do servidor após crash pós-startup —
// evita loop infinito de restart se o processo cair repetidamente (porta presa,
// binário corrompido etc.).
const MAX_SERVER_RESTARTS = 3;

let serverProcess = null;
let stoppingServer = false; // true durante encerramento intencional (não é crash)
let serverRestartCount = 0;
let mainWindowRef = null;

/** Carrega um .env.local ao lado do executável (p/ a chave do Gemini, opcional). */
function loadEnvFile() {
  try {
    const file = app.isPackaged
      ? path.join(path.dirname(app.getPath("exe")), ".env.local")
      : path.join(process.cwd(), ".env.local");
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    /* ignora — segue sem .env */
  }
}

function startNextServer() {
  // .next/standalone é empacotado em resources/app (ver electron-builder).
  const appDir = path.join(process.resourcesPath, "app");
  const child = fork(path.join(appDir, "server.js"), [], {
    cwd: appDir,
    env: { ...process.env, PORT, HOSTNAME: HOST, NODE_ENV: "production" },
  });
  serverProcess = child;

  // [BE-9] Falha do processo filho (crash/exit inesperado) após a subida:
  // sem isso, a janela do Electron continuava aberta apontando para uma URL
  // morta, sem diagnóstico. "error" cobre falha de spawn; "exit" cobre crash
  // em runtime (exceção não tratada, `kill` externo, porta perdida etc.).
  child.on("error", (err) => {
    handleServerCrash(child, err);
  });
  child.on("exit", (code, signal) => {
    // Durante um encerramento intencional (stopServer/quit), a saída é esperada.
    if (stoppingServer || serverProcess !== child) return;
    handleServerCrash(child, new Error(`saiu com código ${code} sinal ${signal ?? "nenhum"}`));
  });
}

/** Trata queda inesperada do servidor: oferece reiniciar (com teto) ou fechar. */
async function handleServerCrash(deadChild, err) {
  if (serverProcess === deadChild) serverProcess = null;
  console.error("[electron] servidor interno caiu inesperadamente:", err);

  if (!mainWindowRef || mainWindowRef.isDestroyed()) return;

  if (serverRestartCount >= MAX_SERVER_RESTARTS) {
    await dialog.showMessageBox(mainWindowRef, {
      type: "error",
      title: "IA Analytics Pro",
      message: "O servidor interno caiu repetidamente e não pôde ser recuperado.",
      detail: "Feche o aplicativo e abra novamente. Se o problema persistir, reinstale o app.",
      buttons: ["Fechar"],
      defaultId: 0,
    });
    app.quit();
    return;
  }

  const choice = await dialog.showMessageBox(mainWindowRef, {
    type: "warning",
    title: "IA Analytics Pro",
    message: "O servidor interno do aplicativo parou de responder.",
    detail: `Tentativa ${serverRestartCount + 1} de ${MAX_SERVER_RESTARTS}. Deseja reiniciá-lo?`,
    buttons: ["Reiniciar servidor", "Fechar aplicativo"],
    defaultId: 0,
    cancelId: 1,
  });

  if (choice.response !== 0) {
    app.quit();
    return;
  }

  serverRestartCount += 1;
  startNextServer();
  const ok = await waitForServer(30000);
  if (!ok || !mainWindowRef || mainWindowRef.isDestroyed()) {
    if (mainWindowRef && !mainWindowRef.isDestroyed()) {
      await dialog.showMessageBox(mainWindowRef, {
        type: "error",
        title: "IA Analytics Pro",
        message: "Não foi possível reiniciar o servidor interno.",
        buttons: ["Fechar"],
      });
      app.quit();
    }
    return;
  }
  mainWindowRef.loadURL(APP_URL);
}

function waitForServer(timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const ping = () => {
      const request = http.get(APP_URL, () => resolve(true));
      request.on("error", () => {
        if (Date.now() - started > timeoutMs) resolve(false);
        else setTimeout(ping, 300);
      });
    };
    ping();
  });
}

function createWindow(url) {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: "#0b1120",
    title: "IA Analytics Pro",
    autoHideMenuBar: true,
    // [SEC-6] Defesa em profundidade: o conteúdo é 100% web (HTML/JS/CSS do
    // standalone) servido via HTTP local — nenhum preload usa API do Node, então
    // sandbox: true não quebra nada. contextIsolation:true + nodeIntegration:false
    // explícitos reforçam o isolamento do renderer contra um eventual XSS.
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // Links externos abrem no navegador padrão, não dentro do app.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: "deny" };
  });
  win.on("closed", () => {
    if (mainWindowRef === win) mainWindowRef = null;
  });
  mainWindowRef = win;
  win.loadURL(url);
  return win;
}

app.whenReady().then(async () => {
  if (!app.isPackaged) {
    // Dev: assume `npm run dev` rodando em :3000.
    createWindow("http://localhost:3000");
  } else {
    loadEnvFile();
    startNextServer();
    const ok = await waitForServer(30000);
    createWindow(
      ok
        ? APP_URL
        : "data:text/html,<body style='background:%230b1120;color:%23e2e8f0;font-family:sans-serif;padding:2rem'><h2>Falha ao iniciar o servidor interno.</h2></body>",
    );
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow(app.isPackaged ? APP_URL : "http://localhost:3000");
    }
  });
});

/**
 * [BE-9] Encerra o servidor e aguarda (com teto curto) a confirmação real de
 * saída via evento "exit" — `kill()` sozinho não garante que o processo já
 * morreu quando a função retorna. `stoppingServer` sinaliza aos listeners de
 * "exit"/"error" que esta saída é intencional (não deve abrir o dialog de crash).
 */
function stopServer(timeoutMs = 3000) {
  const child = serverProcess;
  if (!child) return Promise.resolve();
  stoppingServer = true;
  serverProcess = null;
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      stoppingServer = false;
      resolve();
    };
    child.once("exit", finish);
    child.kill();
    setTimeout(finish, timeoutMs);
  });
}

app.on("window-all-closed", async () => {
  await stopServer();
  if (process.platform !== "darwin") app.quit();
});

app.on("quit", () => {
  stopServer();
});
