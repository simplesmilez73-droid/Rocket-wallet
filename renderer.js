const { ipcRenderer, clipboard } = require("electron");
const QRCode = require("qrcode");
const fetch = require("node-fetch");
const { RSI, EMA } = require("technicalindicators");

let ethSocket = null;
let solSocket = null;
let marketSocket = null;
let marketChart = null;
let rsiChart = null;
let currentCandles = [];

let ethBalance = 0;
let solBalance = 0;
let ethPrice = 0;
let solPrice = 0;
let ethAddress = "";
let solAddress = "";

let selectedPair = "ETH";
let selectedTimeframe = "1m";
let receiveAddress = "";

let showEMA20 = true;
let showEMA50 = true;
let showRSI = true;

const DEFAULT_SETTINGS = {
  walletName: "Nova",
  network: "Mainnet"
};

function ensureIndicatorControls() {
  const tfRow = document.querySelector(".tf-row");
  if (!tfRow || document.getElementById("indicatorRow")) return;

  const row = document.createElement("div");
  row.id = "indicatorRow";
  row.style.display = "flex";
  row.style.gap = "8px";
  row.style.marginTop = "10px";
  row.style.flexWrap = "wrap";

  row.innerHTML = `
    <button id="toggleEMA20" style="border:none;background:#171d18;color:#d8e3d9;padding:8px 12px;border-radius:12px;font-weight:700;cursor:pointer;">EMA 20</button>
    <button id="toggleEMA50" style="border:none;background:#171d18;color:#d8e3d9;padding:8px 12px;border-radius:12px;font-weight:700;cursor:pointer;">EMA 50</button>
    <button id="toggleRSI" style="border:none;background:#171d18;color:#d8e3d9;padding:8px 12px;border-radius:12px;font-weight:700;cursor:pointer;">RSI</button>
  `;

  tfRow.parentNode.insertBefore(row, tfRow.nextSibling);

  document.getElementById("toggleEMA20").onclick = () => {
    showEMA20 = !showEMA20;
    refreshIndicatorButtons();
    updateCharts();
  };

  document.getElementById("toggleEMA50").onclick = () => {
    showEMA50 = !showEMA50;
    refreshIndicatorButtons();
    updateCharts();
  };

  document.getElementById("toggleRSI").onclick = () => {
    showRSI = !showRSI;
    refreshIndicatorButtons();
    updateCharts();
  };

  refreshIndicatorButtons();
}

function refreshIndicatorButtons() {
  const setBtn = (id, active) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.background = active ? "rgba(34,197,94,0.12)" : "#171d18";
    el.style.color = "white";
    el.style.border = active ? "1px solid rgba(34,197,94,0.35)" : "1px solid rgba(255,255,255,0.06)";
  };

  setBtn("toggleEMA20", showEMA20);
  setBtn("toggleEMA50", showEMA50);
  setBtn("toggleRSI", showRSI);
}

function getSettings() {
  try {
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(localStorage.getItem("novaSettings")) || {}) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function applySettings() {
  const settings = getSettings();
  const walletTitle = document.getElementById("walletTitle");
  const networkLabel = document.getElementById("networkLabel");
  const settingWalletName = document.getElementById("settingWalletName");
  const settingNetwork = document.getElementById("settingNetwork");

  if (walletTitle) walletTitle.innerText = settings.walletName;
  if (networkLabel) networkLabel.innerText = settings.network;
  if (settingWalletName) settingWalletName.value = settings.walletName;
  if (settingNetwork) settingNetwork.value = settings.network;
}

function saveSettings() {
  const walletName = document.getElementById("settingWalletName");
  const network = document.getElementById("settingNetwork");
  const result = document.getElementById("settingsResult");

  const settings = {
    walletName: walletName?.value.trim() || "Nova",
    network: network?.value || "Mainnet"
  };

  localStorage.setItem("novaSettings", JSON.stringify(settings));
  applySettings();
  if (result) result.innerText = "Settings saved.";
}

function resetSettings() {
  localStorage.removeItem("novaSettings");
  applySettings();
  const result = document.getElementById("settingsResult");
  if (result) result.innerText = "Settings reset.";
}

function formatUsd(v) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2
  }).format(v || 0);
}

function shortAddress(addr) {
  if (!addr) return "Not unlocked";
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function formatTokenAmount(rawAmount, decimals) {
  const raw = Number(rawAmount || 0);
  const div = Math.pow(10, Number(decimals || 0));
  if (!div) return String(raw);
  return (raw / div).toLocaleString(undefined, { maximumFractionDigits: 6 });
}

function refreshPortfolio() {
  const ethValue = ethBalance * ethPrice;
  const solValue = solBalance * solPrice;
  const total = ethValue + solValue;

  const setText = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.innerText = value;
  };

  setText("assetEthBalance", `${ethBalance} ETH`);
  setText("assetSolBalance", `${solBalance} SOL`);
  setText("assetEthValue", formatUsd(ethValue));
  setText("assetSolValue", formatUsd(solValue));
  setText("portfolioValue", formatUsd(total));
  setText("portfolioSub", total > 0 ? "Live estimated value from ETH + SOL" : "Unlock wallets to calculate value");
  setText("ethAddressShort", shortAddress(ethAddress));
  setText("solAddressShort", shortAddress(solAddress));
  setText("homeEthPrice", ethPrice ? formatUsd(ethPrice) : "$--");
  setText("homeSolPrice", solPrice ? formatUsd(solPrice) : "$--");
}

function openActionSheet(mode = "createEth") {
  const sheet = document.getElementById("actionSheet");
  if (sheet) sheet.classList.add("show");
  showSheet(mode);
}

function closeActionSheet() {
  const sheet = document.getElementById("actionSheet");
  if (sheet) sheet.classList.remove("show");
}

function showSheet(mode) {
  const map = {
    createEth: ["sheetCreateEth", "Create ETH Wallet"],
    openEth: ["sheetOpenEth", "Open ETH Wallet"],
    createSol: ["sheetCreateSol", "Create SOL Wallet"],
    openSol: ["sheetOpenSol", "Open SOL Wallet"],
    receive: ["sheetReceive", "Receive"]
  };

  document.querySelectorAll(".sheet-page").forEach(el => el.classList.remove("active"));
  const [id, title] = map[mode] || map.createEth;
  const page = document.getElementById(id);
  const heading = document.getElementById("sheetTitle");
  if (page) page.classList.add("active");
  if (heading) heading.innerText = title;
}

async function showReceiveSheet(chain) {
  const address = chain === "ETH" ? ethAddress : solAddress;
  const label = chain === "ETH" ? "Receive Ethereum" : "Receive Solana";

  const receiveResult = document.getElementById("receiveResult");
  const receiveLabel = document.getElementById("receiveLabel");
  const receiveAddressEl = document.getElementById("receiveAddress");
  const receiveQr = document.getElementById("receiveQr");

  if (!address) {
    if (receiveResult) receiveResult.innerText = `Unlock your ${chain} wallet first.`;
    openActionSheet("receive");
    if (receiveLabel) receiveLabel.innerText = label;
    if (receiveAddressEl) receiveAddressEl.innerText = "No address";
    if (receiveQr) receiveQr.src = "";
    return;
  }

  receiveAddress = address;
  if (receiveLabel) receiveLabel.innerText = label;
  if (receiveAddressEl) receiveAddressEl.innerText = address;
  if (receiveResult) receiveResult.innerText = "";

  try {
    const qrDataUrl = await QRCode.toDataURL(address, { width: 220, margin: 1 });
    if (receiveQr) receiveQr.src = qrDataUrl;
  } catch {
    if (receiveResult) receiveResult.innerText = "QR generation failed.";
  }

  openActionSheet("receive");
}

function copyReceiveAddress() {
  const receiveResult = document.getElementById("receiveResult");
  if (!receiveAddress) {
    if (receiveResult) receiveResult.innerText = "No address to copy.";
    return;
  }
  clipboard.writeText(receiveAddress);
  if (receiveResult) receiveResult.innerText = "Address copied.";
}

function showMainPage(evt, pageId) {
  document.querySelectorAll(".page").forEach(page => page.classList.remove("active"));
  const page = document.getElementById(pageId);
  if (page) page.classList.add("active");
  document.querySelectorAll(".nav-btn").forEach(btn => btn.classList.remove("active"));
  if (evt?.currentTarget) evt.currentTarget.classList.add("active");

  if (pageId === "marketsPage") {
    setTimeout(() => {
      ensureIndicatorControls();
      loadMarketHistory();
    }, 50);
  }
}

function setMarketPair(pair) {
  selectedPair = pair;
  const pairETH = document.getElementById("pairETH");
  const pairSOL = document.getElementById("pairSOL");
  const label = document.getElementById("marketPairLabel");

  if (pairETH) pairETH.classList.toggle("active", pair === "ETH");
  if (pairSOL) pairSOL.classList.toggle("active", pair === "SOL");
  if (label) label.innerText = pair + "/USDT";

  loadMarketHistory();
}

function setTimeframe(tf) {
  selectedTimeframe = tf;
  ["1s", "1m", "5m", "15m", "1h", "4h"].forEach(id => {
    const el = document.getElementById("tf" + id);
    if (el) el.classList.toggle("active", id === tf);
  });
  loadMarketHistory();
}

function seedMessage(address, mnemonic) {
  return `Address: ${address}\nSeed Phrase: ${mnemonic}\nWRITE THIS DOWN OFFLINE.`;
}

async function createWallet() {
  const password = document.getElementById("createPassword")?.value;
  const result = document.getElementById("createResult");
  try {
    const wallet = await ipcRenderer.invoke("create-wallet", password);
    if (result) result.innerText = seedMessage(wallet.address, wallet.mnemonic);
  } catch (err) {
    if (result) result.innerText = "Error: " + err.message;
  }
}

async function openWallet() {
  const password = document.getElementById("openPassword")?.value;
  const walletAddress = document.getElementById("walletAddress");
  const walletBalance = document.getElementById("walletBalance");

  try {
    const wallet = await ipcRenderer.invoke("load-wallet", password);
    ethAddress = wallet.address;
    ethBalance = Number(wallet.balance) || 0;
    if (walletAddress) walletAddress.innerText = "Address: " + wallet.address;
    if (walletBalance) walletBalance.innerText = "Balance: " + wallet.balance + " ETH";
    refreshPortfolio();
  } catch (err) {
    if (walletAddress) walletAddress.innerText = "Error: " + err.message;
    if (walletBalance) walletBalance.innerText = "";
  }
}

async function sendEth() {
  const password = document.getElementById("openPassword")?.value;
  const to = document.getElementById("recipient")?.value;
  const amount = document.getElementById("amount")?.value;
  const sendResult = document.getElementById("sendResult");
  const activityEth = document.getElementById("activityEth");

  try {
    const hash = await ipcRenderer.invoke("send-eth", password, to, amount);
    if (sendResult) sendResult.innerText = "Transaction sent: " + hash;
    if (activityEth) activityEth.innerText = "Sent";
  } catch (err) {
    if (sendResult) sendResult.innerText = "Error: " + err.message;
  }
}

async function createSolWallet() {
  const password = document.getElementById("createSolPassword")?.value;
  const result = document.getElementById("createSolResult");
  try {
    const wallet = await ipcRenderer.invoke("create-sol-wallet", password);
    await ipcRenderer.invoke("keychain-save-sol-mnemonic", wallet.mnemonic);
    if (result) {
      result.innerText =
`Address: ${wallet.address}
Seed Phrase: ${wallet.mnemonic}
Saved to macOS Keychain
WRITE THIS DOWN OFFLINE.`;
    }
  } catch (err) {
    if (result) result.innerText = "Error: " + err.message;
  }
}

async function openSolWallet() {
  const password = document.getElementById("openSolPassword")?.value;
  const addressEl = document.getElementById("solWalletAddress");
  const balanceEl = document.getElementById("solWalletBalance");

  try {
    const wallet = await ipcRenderer.invoke("load-sol-wallet", password);
    solAddress = wallet.address;
    solBalance = Number(wallet.balance) || 0;
    if (addressEl) addressEl.innerText = "Address: " + wallet.address;
    if (balanceEl) balanceEl.innerText = "Balance: " + wallet.balance + " SOL";
    refreshPortfolio();
  } catch (err) {
    if (addressEl) addressEl.innerText = "Error: " + err.message;
    if (balanceEl) balanceEl.innerText = "";
  }
}

async function sendSol() {
  const password = document.getElementById("openSolPassword")?.value;
  const to = document.getElementById("solRecipient")?.value;
  const amount = document.getElementById("solAmount")?.value;
  const result = document.getElementById("sendSolResult");
  const activitySol = document.getElementById("activitySol");

  try {
    const sig = await ipcRenderer.invoke("send-sol", password, to, amount);
    if (result) result.innerText = "Transaction sent: " + sig;
    if (activitySol) activitySol.innerText = "Sent";
  } catch (err) {
    if (result) result.innerText = "Error: " + err.message;
  }
}

function stopHomeStreams() {
  if (ethSocket) {
    ethSocket.close();
    ethSocket = null;
  }
  if (solSocket) {
    solSocket.close();
    solSocket = null;
  }
}

function stopMarketStream() {
  if (marketSocket) {
    marketSocket.close();
    marketSocket = null;
  }
}

function destroyChart() {
  if (marketChart) {
    marketChart.destroy();
    marketChart = null;
  }
  if (rsiChart) {
    rsiChart.destroy();
    rsiChart = null;
  }
}

function binanceSymbol() {
  return selectedPair === "ETH" ? "ETHUSDT" : "SOLUSDT";
}

function wsSymbol() {
  return selectedPair === "ETH" ? "ethusdt" : "solusdt";
}

function timeframeToBinance(tf) {
  if (tf === "1s") return "1s";
  if (tf === "1m") return "1m";
  if (tf === "5m") return "5m";
  if (tf === "15m") return "15m";
  if (tf === "1h") return "1h";
  if (tf === "4h") return "4h";
  return "1m";
}

async function loadHistoricalKlines(symbol, interval, limit = 200) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load history: ${res.status}`);
  const data = await res.json();

  return data.map(k => ({
    x: new Date(k[0]),
    y: [Number(k[1]), Number(k[2]), Number(k[3]), Number(k[4])]
  }));
}

function buildEMA(candles, period) {
  const closes = candles.map(c => c.y[3]);
  if (closes.length < period) return [];

  const ema = EMA.calculate({ period, values: closes });
  const start = candles.length - ema.length;

  return ema.map((v, i) => ({
    x: candles[start + i].x,
    y: Number(v.toFixed(2))
  }));
}

function buildRSI(candles) {
  const closes = candles.map(c => c.y[3]);
  if (closes.length < 15) return [];

  const rsi = RSI.calculate({ values: closes, period: 14 });
  const start = candles.length - rsi.length;

  return rsi.map((v, i) => ({
    x: candles[start + i].x,
    y: Number(v.toFixed(2))
  }));
}

function chartOptions(candles) {
  const series = [
    { name: "Candles", type: "candlestick", data: candles }
  ];

  if (showEMA20) {
    series.push({ name: "EMA20", type: "line", data: buildEMA(candles, 20) });
  }

  if (showEMA50) {
    series.push({ name: "EMA50", type: "line", data: buildEMA(candles, 50) });
  }

  return {
    series,
    chart: {
      height: 280,
      background: "#0d120e",
      animations: { enabled: false },
      zoom: { enabled: true },
      toolbar: { show: true }
    },
    stroke: { width: [1, 2, 2] },
    colors: ["#22c55e", "#3b82f6", "#f59e0b"],
    theme: { mode: "dark" },
    xaxis: { type: "datetime" },
    yaxis: { tooltip: { enabled: true } },
    grid: { borderColor: "rgba(255,255,255,0.06)" }
  };
}

function rsiOptions(data) {
  return {
    series: [{ name: "RSI", data }],
    chart: {
      height: 140,
      background: "#0d120e",
      animations: { enabled: false },
      toolbar: { show: false }
    },
    colors: ["#22c55e"],
    stroke: { width: 2 },
    theme: { mode: "dark" },
    xaxis: { type: "datetime" },
    yaxis: {
      min: 0,
      max: 100,
      tickAmount: 4
    },
    annotations: {
      yaxis: [
        { y: 70, borderColor: "#ef4444", strokeDashArray: 4 },
        { y: 30, borderColor: "#22c55e", strokeDashArray: 4 }
      ]
    },
    grid: { borderColor: "rgba(255,255,255,0.06)" }
  };
}

async function buildCharts(candles) {
  const chartEl = document.querySelector("#marketChart");
  if (!chartEl) throw new Error("Chart element missing");
  if (!window.ApexCharts) throw new Error("ApexCharts not loaded");

  let rsiEl = document.getElementById("rsiChart");
  if (!rsiEl) {
    rsiEl = document.createElement("div");
    rsiEl.id = "rsiChart";
    rsiEl.style.marginTop = "12px";
    chartEl.parentNode.appendChild(rsiEl);
  }

  chartEl.innerHTML = "";
  rsiEl.innerHTML = "";
  destroyChart();

  marketChart = new window.ApexCharts(chartEl, chartOptions(candles));
  await marketChart.render();

  if (showRSI) {
    rsiEl.style.display = "block";
    rsiChart = new window.ApexCharts(rsiEl, rsiOptions(buildRSI(candles)));
    await rsiChart.render();
  } else {
    rsiEl.style.display = "none";
  }
}

async function updateCharts() {
  if (!marketChart) return;

  const series = [
    { data: currentCandles }
  ];

  if (showEMA20) {
    series.push({ data: buildEMA(currentCandles, 20) });
  }

  if (showEMA50) {
    series.push({ data: buildEMA(currentCandles, 50) });
  }

  await marketChart.updateOptions(
    {
      series,
      colors: ["#22c55e", "#3b82f6", "#f59e0b"]
    },
    false,
    false
  );

  let rsiEl = document.getElementById("rsiChart");
  if (!rsiEl) return;

  if (!showRSI) {
    rsiEl.style.display = "none";
    if (rsiChart) {
      rsiChart.destroy();
      rsiChart = null;
    }
    return;
  }

  rsiEl.style.display = "block";
  const rsiSeries = buildRSI(currentCandles);

  if (!rsiChart) {
    rsiChart = new window.ApexCharts(rsiEl, rsiOptions(rsiSeries));
    await rsiChart.render();
  } else {
    await rsiChart.updateSeries([{ data: rsiSeries }], false);
  }
}

async function loadMarketHistory() {
  const pairLabel = document.getElementById("marketPairLabel");
  const status = document.getElementById("marketStatus");
  const currentPrice = document.getElementById("marketCurrentPrice");

  if (pairLabel) pairLabel.innerText = selectedPair + "/USDT";
  if (status) status.innerText = "Loading...";
  if (currentPrice) currentPrice.innerText = formatUsd(selectedPair === "ETH" ? ethPrice : solPrice);

  stopMarketStream();

  try {
    const candles = await loadHistoricalKlines(binanceSymbol(), timeframeToBinance(selectedTimeframe), 200);
    currentCandles = candles.slice();
    await buildCharts(currentCandles);
    refreshIndicatorButtons();
    if (status) status.innerText = "Live · " + selectedTimeframe;
    connectMarketStream();
  } catch (err) {
    if (status) status.innerText = "Load failed: " + err.message;
    console.error(err);
  }
}

function connectMarketStream() {
  stopMarketStream();
  const interval = timeframeToBinance(selectedTimeframe);
  const status = document.getElementById("marketStatus");
  marketSocket = new WebSocket(`wss://stream.binance.com:9443/ws/${wsSymbol()}@kline_${interval}`);

  marketSocket.onmessage = async (event) => {
    try {
      const data = JSON.parse(event.data);
      const k = data.k;
      const candle = {
        x: new Date(k.t),
        y: [Number(k.o), Number(k.h), Number(k.l), Number(k.c)]
      };

      const livePrice = Number(k.c);
      const homeEthPrice = document.getElementById("homeEthPrice");
      const homeEthStatus = document.getElementById("homeEthStatus");
      const homeSolPrice = document.getElementById("homeSolPrice");
      const homeSolStatus = document.getElementById("homeSolStatus");
      const marketCurrentPrice = document.getElementById("marketCurrentPrice");

      if (selectedPair === "ETH") {
        ethPrice = livePrice;
        if (homeEthPrice) homeEthPrice.innerText = formatUsd(ethPrice);
        if (homeEthStatus) homeEthStatus.innerText = "Live";
      } else {
        solPrice = livePrice;
        if (homeSolPrice) homeSolPrice.innerText = formatUsd(solPrice);
        if (homeSolStatus) homeSolStatus.innerText = "Live";
      }

      if (marketCurrentPrice) marketCurrentPrice.innerText = formatUsd(livePrice);
      refreshPortfolio();

      const last = currentCandles[currentCandles.length - 1];
      if (last && new Date(last.x).getTime() === new Date(candle.x).getTime()) {
        currentCandles[currentCandles.length - 1] = candle;
      } else {
        currentCandles.push(candle);
        if (currentCandles.length > 200) currentCandles.shift();
      }

      await updateCharts();
      if (status) status.innerText = "Live · " + selectedTimeframe;
    } catch (err) {
      console.error(err);
    }
  };

  marketSocket.onerror = () => {
    if (status) status.innerText = "Stream failed";
  };
}

function connectHomeStreams() {
  stopHomeStreams();

  ethSocket = new WebSocket("wss://stream.binance.com:9443/ws/ethusdt@trade");
  ethSocket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    ethPrice = Number(data.p);
    const el = document.getElementById("homeEthPrice");
    const st = document.getElementById("homeEthStatus");
    const cp = document.getElementById("marketCurrentPrice");
    if (el) el.innerText = formatUsd(ethPrice);
    if (st) st.innerText = "Live";
    if (selectedPair === "ETH" && cp) cp.innerText = formatUsd(ethPrice);
    refreshPortfolio();
  };
  ethSocket.onerror = () => {
    const st = document.getElementById("homeEthStatus");
    if (st) st.innerText = "Offline";
  };

  solSocket = new WebSocket("wss://stream.binance.com:9443/ws/solusdt@trade");
  solSocket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    solPrice = Number(data.p);
    const el = document.getElementById("homeSolPrice");
    const st = document.getElementById("homeSolStatus");
    const cp = document.getElementById("marketCurrentPrice");
    if (el) el.innerText = formatUsd(solPrice);
    if (st) st.innerText = "Live";
    if (selectedPair === "SOL" && cp) cp.innerText = formatUsd(solPrice);
    refreshPortfolio();
  };
  solSocket.onerror = () => {
    const st = document.getElementById("homeSolStatus");
    if (st) st.innerText = "Offline";
  };
}

const JUP_BASE = "https://lite-api.jup.ag";
const SOL_MINT = "So11111111111111111111111111111111111111112";

async function searchSwapTokens() {
  const input = document.getElementById("swapToSearch");
  const select = document.getElementById("swapToToken");
  const result = document.getElementById("swapQuoteResult");

  const query = (input?.value || "").trim();
  if (!query) {
    if (result) result.innerText = "Enter a token name, symbol, or mint.";
    return;
  }

  try {
    if (result) result.innerText = "Searching tokens...";
    const res = await fetch(`${JUP_BASE}/tokens/v2/search?query=${encodeURIComponent(query)}`);
    if (!res.ok) throw new Error(`Token search failed: ${res.status}`);
    const data = await res.json();

    if (!Array.isArray(data) || data.length === 0) {
      if (select) select.innerHTML = `<option value="">No tokens found</option>`;
      if (result) result.innerText = "No matching tokens found.";
      return;
    }

    if (select) {
      select.innerHTML = `<option value="">Select token</option>`;
      for (const token of data.slice(0, 20)) {
        const opt = document.createElement("option");
        opt.value = token.id;
        opt.textContent = `${token.symbol} — ${token.name}`;
        opt.dataset.symbol = token.symbol || "";
        opt.dataset.name = token.name || "";
        opt.dataset.decimals = String(token.decimals ?? 0);
        select.appendChild(opt);
      }
    }

    if (result) result.innerText = `Found ${Math.min(data.length, 20)} token(s). Select one below.`;
  } catch (err) {
    if (result) result.innerText = "Search error: " + err.message;
    console.error(err);
  }
}

async function getSwapQuote() {
  const fromSelect = document.getElementById("swapFromToken");
  const toSelect = document.getElementById("swapToToken");
  const amountInput = document.getElementById("swapAmount");
  const result = document.getElementById("swapQuoteResult");

  const inputMint = fromSelect?.value || SOL_MINT;
  const outputMint = toSelect?.value || "";
  const amountUi = Number(amountInput?.value || 0);

  if (!outputMint) {
    if (result) result.innerText = "Choose a token to swap into.";
    return;
  }

  if (!amountUi || amountUi <= 0) {
    if (result) result.innerText = "Enter a valid amount.";
    return;
  }

  try {
    if (result) result.innerText = "Getting quote...";

    const rawAmount = Math.floor(amountUi * 1_000_000_000);

    const params = new URLSearchParams({
      inputMint,
      outputMint,
      amount: String(rawAmount),
      slippageBps: "50"
    });

    const res = await fetch(`${JUP_BASE}/swap/v1/quote?${params.toString()}`);
    if (!res.ok) throw new Error(`Quote failed: ${res.status}`);
    const quote = await res.json();

    const selectedOpt = toSelect.options[toSelect.selectedIndex];
    const outDecimals = Number(selectedOpt?.dataset?.decimals || 0);
    const outSymbol = selectedOpt?.dataset?.symbol || "TOKEN";

    const outAmountUi = formatTokenAmount(quote.outAmount, outDecimals);
    const minOutUi = formatTokenAmount(quote.otherAmountThreshold, outDecimals);

    const routeLabels = Array.isArray(quote.routePlan)
      ? quote.routePlan
          .map(r => r?.swapInfo?.label)
          .filter(Boolean)
          .slice(0, 3)
          .join(" → ")
      : "N/A";

    const priceImpact = quote.priceImpactPct ?? "0";

    if (result) {
      result.innerText =
`Quote ready

From: ${amountUi} SOL
To: ~${outAmountUi} ${outSymbol}
Min received: ${minOutUi} ${outSymbol}
Price impact: ${priceImpact}%
Route: ${routeLabels}`;
    }
  } catch (err) {
    if (result) result.innerText = "Quote error: " + err.message;
    console.error(err);
  }
}

async function executeSwap() {
  const result = document.getElementById("swapQuoteResult");

  try {
    if (!solAddress) {
      if (result) result.innerText = "Open your Solana wallet first.";
      return;
    }

    const toSelect = document.getElementById("swapToToken");
    const amountInput = document.getElementById("swapAmount");

    const outputMint = toSelect?.value || "";
    const amountUi = Number(amountInput?.value || 0);

    if (!outputMint || !amountUi) {
      if (result) result.innerText = "Select token and amount.";
      return;
    }

    if (result) result.innerText = "Simulating swap...";

    const rawAmount = Math.floor(amountUi * 1_000_000_000);

    const quoteRes = await fetch(
      `${JUP_BASE}/swap/v1/quote?inputMint=${SOL_MINT}&outputMint=${outputMint}&amount=${rawAmount}&slippageBps=50`
    );
    if (!quoteRes.ok) {
      throw new Error(`Quote failed: ${quoteRes.status}`);
    }

    const quote = await quoteRes.json();

    const selectedOpt = toSelect.options[toSelect.selectedIndex];
    const outDecimals = Number(selectedOpt?.dataset?.decimals || 0);
    const outSymbol = selectedOpt?.dataset?.symbol || "TOKEN";
    const outName = selectedOpt?.dataset?.name || "";

    const outAmountUi = formatTokenAmount(quote.outAmount, outDecimals);
    const minOutUi = formatTokenAmount(quote.otherAmountThreshold, outDecimals);

    const routeLabels = Array.isArray(quote.routePlan)
      ? quote.routePlan
          .map(r => r?.swapInfo?.label)
          .filter(Boolean)
          .slice(0, 4)
          .join(" → ")
      : "N/A";

    const priceImpact = quote.priceImpactPct ?? "0";
    const platformFee = quote.platformFee?.amount
      ? `${quote.platformFee.amount} raw units`
      : "None";
    const swapMode = quote.swapMode || "ExactIn";

    if (result) {
      result.innerText =
`Simulation only — no transaction will be sent

From: ${amountUi} SOL
To: ~${outAmountUi} ${outSymbol}${outName ? ` (${outName})` : ""}
Min received: ${minOutUi} ${outSymbol}
Swap mode: ${swapMode}
Price impact: ${priceImpact}%
Platform fee: ${platformFee}
Route: ${routeLabels}

Wallet: ${solAddress}

Status:
✅ Quote works
✅ Route found
✅ Ready for real swap later
❌ Not signed
❌ Not sent`;
    }
  } catch (err) {
    if (result) result.innerText = "Simulation error: " + err.message;
    console.error(err);
  }
}

window.openActionSheet = openActionSheet;
window.closeActionSheet = closeActionSheet;
window.showMainPage = showMainPage;
window.createWallet = createWallet;
window.openWallet = openWallet;
window.sendEth = sendEth;
window.createSolWallet = createSolWallet;
window.openSolWallet = openSolWallet;
window.sendSol = sendSol;
window.saveSettings = saveSettings;
window.resetSettings = resetSettings;
window.setMarketPair = setMarketPair;
window.setTimeframe = setTimeframe;
window.showReceiveSheet = showReceiveSheet;
window.copyReceiveAddress = copyReceiveAddress;
window.searchSwapTokens = searchSwapTokens;
window.getSwapQuote = getSwapQuote;
window.executeSwap = executeSwap;

document.addEventListener("DOMContentLoaded", () => {
  applySettings();
  refreshPortfolio();
  connectHomeStreams();
});

// --- SAFE REAL SWAP WRAPPER ---
const { executeRealSwap } = require("./swap-engine");

window.executeSwap = async function () {
  const result = document.getElementById("swapQuoteResult");

  try {
    if (!solKeypair) {
      result.innerText = "Wallet not loaded.";
      return;
    }

    const toToken = document.getElementById("swapToToken").value;
    const amount = Number(document.getElementById("swapAmount").value);

    if (!toToken || !amount) {
      result.innerText = "Select token and amount.";
      return;
    }

    result.innerText = "Preparing swap...";

    const rawAmount = Math.floor(amount * 1_000_000_000);

    // get quote
    const quoteRes = await fetch(
      `${JUP_BASE}/swap/v1/quote?inputMint=${SOL_MINT}&outputMint=${toToken}&amount=${rawAmount}&slippageBps=50`
    );
    const quote = await quoteRes.json();

    // build swap tx
    const swapRes = await fetch(`${JUP_BASE}/swap/v1/swap`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: solKeypair.publicKey.toBase58(),
        wrapAndUnwrapSol: true
      })
    });

    const swapData = await swapRes.json();

    result.innerText = "Signing + sending...";

    const res = await executeRealSwap({
      quote,
      swapData,
      keypair: solKeypair
    });

    if (!res.success) {
      result.innerText = "Swap failed: " + res.error;
      return;
    }

    result.innerText =
`Swap successful ✅

TX:
${res.signature}`;

  } catch (err) {
    result.innerText = "Swap error: " + err.message;
    console.error(err);
  }
};

async function executeSwap() {
  const result = document.getElementById("swapQuoteResult");

  try {
    if (!solKeypair) {
      result.innerText = "Wallet not loaded.";
      return;
    }

    const toToken = document.getElementById("swapToToken").value;
    const amount = Number(document.getElementById("swapAmount").value);

    if (!toToken || !amount) {
      result.innerText = "Select token and amount.";
      return;
    }

    result.innerText = "Preparing real swap...";

    const rawAmount = Math.floor(amount * 1_000_000_000);

    const quoteRes = await fetch(
      `${JUP_BASE}/swap/v1/quote?inputMint=${SOL_MINT}&outputMint=${toToken}&amount=${rawAmount}&slippageBps=50`
    );
    if (!quoteRes.ok) throw new Error(`Quote failed: ${quoteRes.status}`);
    const quote = await quoteRes.json();

    const swapRes = await fetch(`${JUP_BASE}/swap/v1/swap`, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        quoteResponse: quote,
        userPublicKey: solKeypair.publicKey.toBase58(),
        wrapAndUnwrapSol: true
      })
    });
    if (!swapRes.ok) throw new Error(`Swap build failed: ${swapRes.status}`);
    const swapData = await swapRes.json();

    if (!swapData.swapTransaction) {
      throw new Error("Missing swap transaction");
    }

    result.innerText = "Signing + sending...";

    const res = await executeRealSwap({
      quote,
      swapData,
      keypair: solKeypair
    });

    if (!res.success) {
      result.innerText = "Swap failed: " + res.error;
      return;
    }

    result.innerText = `Swap successful ✅

TX:
${res.signature}`;
  } catch (err) {
    result.innerText = "Swap error: " + err.message;
    console.error(err);
  }
}

window.executeSwap = executeSwap;

// --- Rocket Wallet: Solana import from seed phrase ---
window.importSolWalletFromSeed = async function () {
  const input = document.getElementById("importSolMnemonic");
  const result = document.getElementById("importSolResult");
  const phrase = (input?.value || "").trim();

  try {
    if (!phrase) {
      if (result) result.innerText = "Paste your seed phrase first.";
      return;
    }

    if (result) result.innerText = "Importing wallet...";

    const wallet = await ipcRenderer.invoke("import-sol-wallet-from-mnemonic", phrase);

    solAddress = wallet.address;

    const solWalletAddress = document.getElementById("solWalletAddress");
    if (solWalletAddress) solWalletAddress.innerText = "Address: " + wallet.address;

    if (result) {
      result.innerText =
`Imported successfully

Address: ${wallet.address}

Saved to macOS Keychain.`;
    }

    const receiveAddressEl = document.getElementById("receiveAddress");
    if (receiveAddressEl) receiveAddressEl.innerText = wallet.address;

    refreshPortfolio();
  } catch (err) {
    if (result) result.innerText = "Import error: " + err.message;
    console.error(err);
  }
};

// Support the new sheet name
const _oldShowSheet_rw = window.showSheet || showSheet;
window.showSheet = function (mode) {
  if (mode === "importSol") {
    document.querySelectorAll(".sheet-page").forEach(el => el.classList.remove("active"));
    const page = document.getElementById("sheetImportSol");
    const heading = document.getElementById("sheetTitle");
    if (page) page.classList.add("active");
    if (heading) heading.innerText = "Login with Seed Phrase";
    return;
  }
  return _oldShowSheet_rw(mode);
};

// Rename default wallet settings label if present
try {
  const existing = JSON.parse(localStorage.getItem("novaSettings") || "{}");
  if (!existing.walletName || existing.walletName === "Nova") {
    existing.walletName = "Rocket Wallet";
    localStorage.setItem("novaSettings", JSON.stringify(existing));
  }
} catch {}

// --- Rocket Wallet: multi-account Solana support ---
const bip39_multi_rw = require("bip39");
const { derivePath: derivePath_multi_rw } = require("ed25519-hd-key");
const {
  Keypair: SolanaKeypair_multi_rw,
  Connection: SolanaConnection_multi_rw,
  LAMPORTS_PER_SOL: LAMPORTS_PER_SOL_multi_rw
} = require("@solana/web3.js");

const solConnection_multi_rw = new SolanaConnection_multi_rw("https://api.mainnet-beta.solana.com");

let solAccounts = [];
let solKeypair = null;
let activeSolAccountIndex = Number(localStorage.getItem("rocketActiveSolAccountIndex") || "0");
let solAccountCount = Number(localStorage.getItem("rocketSolAccountCount") || "3");

function shortSolAccount(addr) {
  if (!addr) return "Unknown";
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

async function deriveSolAccountsFromKeychain() {
  const res = await ipcRenderer.invoke("keychain-get-sol-mnemonic");
  if (!res || !res.mnemonic) {
    solAccounts = [];
    renderAccountsList();
    return [];
  }

  const seed = await bip39_multi_rw.mnemonicToSeed(res.mnemonic);
  const accounts = [];

  for (let i = 0; i < solAccountCount; i++) {
    const path = `m/44'/501'/${i}'/0'`;
    const derived = derivePath_multi_rw(path, seed.toString("hex")).key;
    const kp = SolanaKeypair_multi_rw.fromSeed(derived);
    accounts.push({
      index: i,
      keypair: kp,
      address: kp.publicKey.toBase58()
    });
  }

  solAccounts = accounts;
  renderAccountsList();
  return accounts;
}

async function refreshActiveSolAccountBalance() {
  if (!solKeypair) return;

  try {
    const lamports = await solConnection_multi_rw.getBalance(solKeypair.publicKey);
    solBalance = lamports / LAMPORTS_PER_SOL_multi_rw;

    const addressEl = document.getElementById("solWalletAddress");
    const balanceEl = document.getElementById("solWalletBalance");

    if (addressEl) addressEl.innerText = "Address: " + solAddress;
    if (balanceEl) balanceEl.innerText = "Balance: " + solBalance + " SOL";

    refreshPortfolio();
  } catch (err) {
    console.error("Balance refresh failed:", err);
  }
}

async function switchSolanaAccount(index) {
  if (!solAccounts.length) {
    await deriveSolAccountsFromKeychain();
  }
  if (!solAccounts[index]) return;

  activeSolAccountIndex = index;
  localStorage.setItem("rocketActiveSolAccountIndex", String(index));

  const acct = solAccounts[index];
  solKeypair = acct.keypair;
  solAddress = acct.address;

  renderAccountsList();
  await refreshActiveSolAccountBalance();
}

function renderAccountsList() {
  const list = document.getElementById("accountsList");
  if (!list) return;

  if (!solAccounts.length) {
    list.innerHTML = `<div class="muted">No Solana seed phrase loaded yet.</div>`;
    return;
  }

  list.innerHTML = "";
  for (const acct of solAccounts) {
    const btn = document.createElement("button");
    btn.className = "account-item" + (acct.index === activeSolAccountIndex ? " active" : "");
    btn.onclick = () => switchSolanaAccount(acct.index);
    btn.innerHTML = `
      <div style="font-weight:700;">Wallet ${acct.index + 1}</div>
      <span class="muted">${shortSolAccount(acct.address)}</span>
    `;
    list.appendChild(btn);
  }
}

async function addDerivedSolAccount() {
  solAccountCount += 1;
  localStorage.setItem("rocketSolAccountCount", String(solAccountCount));
  await deriveSolAccountsFromKeychain();
  await switchSolanaAccount(solAccountCount - 1);
}

function toggleAccountsDrawer(force) {
  const drawer = document.getElementById("accountsDrawer");
  if (!drawer) return;

  if (typeof force === "boolean") {
    drawer.classList.toggle("show", force);
  } else {
    drawer.classList.toggle("show");
  }
}

const _oldImportSolWalletFromSeed_rw = window.importSolWalletFromSeed;
if (typeof _oldImportSolWalletFromSeed_rw === "function") {
  window.importSolWalletFromSeed = async function () {
    await _oldImportSolWalletFromSeed_rw();
    await deriveSolAccountsFromKeychain();
    await switchSolanaAccount(activeSolAccountIndex || 0);
  };
}

const _oldCreateSolWallet_rw = window.createSolWallet;
if (typeof _oldCreateSolWallet_rw === "function") {
  window.createSolWallet = async function () {
    await _oldCreateSolWallet_rw();
    await deriveSolAccountsFromKeychain();
    await switchSolanaAccount(0);
  };
}

const _oldOpenSolWallet_rw = window.openSolWallet;
if (typeof _oldOpenSolWallet_rw === "function") {
  window.openSolWallet = async function () {
    await _oldOpenSolWallet_rw();
    await deriveSolAccountsFromKeychain();
    if (solAccounts[activeSolAccountIndex]) {
      await switchSolanaAccount(activeSolAccountIndex);
    }
  };
}

window.toggleAccountsDrawer = toggleAccountsDrawer;
window.addDerivedSolAccount = addDerivedSolAccount;
window.switchSolanaAccount = switchSolanaAccount;

document.addEventListener("DOMContentLoaded", async () => {
  try {
    await deriveSolAccountsFromKeychain();
    if (solAccounts.length) {
      if (activeSolAccountIndex >= solAccounts.length) activeSolAccountIndex = 0;
      await switchSolanaAccount(activeSolAccountIndex);
    }
  } catch (err) {
    console.error("Multi-account init failed:", err);
  }
});

// --- Home navigation helper ---
window.goToPage = function (pageId) {
  document.querySelectorAll(".page").forEach(page => page.classList.remove("active"));
  const page = document.getElementById(pageId);
  if (page) page.classList.add("active");

  document.querySelectorAll(".nav-btn").forEach(btn => btn.classList.remove("active"));

  const navs = document.querySelectorAll(".nav-btn");
  if (pageId === "homePage" && navs[0]) navs[0].classList.add("active");
  if (pageId === "marketsPage" && navs[1]) navs[1].classList.add("active");
  if (pageId === "swapPage" && navs[2]) navs[2].classList.add("active");
  if (pageId === "settingsPage" && navs[3]) navs[3].classList.add("active");

  if (pageId === "marketsPage") {
    setTimeout(() => {
      try {
        ensureIndicatorControls();
      } catch {}
      try {
        loadMarketHistory();
      } catch {}
    }, 50);
  }
};

// --- Phantom-style swap helpers ---
window.flipSwapDirection = function () {
  const result = document.getElementById("swapQuoteResult");
  if (result) {
    result.innerText = "Only SOL → token swaps are enabled right now.";
  }
};

const _oldGetSwapQuote_rw = window.getSwapQuote || getSwapQuote;
window.getSwapQuote = async function () {
  await _oldGetSwapQuote_rw();

  const result = document.getElementById("swapQuoteResult");
  if (!result) return;

  const text = result.innerText || "";
  if (!text.includes("Quote ready")) return;

  const lines = text.split("\n").map(x => x.trim()).filter(Boolean);
  const map = {};
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx > -1) {
      const k = line.slice(0, idx).trim();
      const v = line.slice(idx + 1).trim();
      map[k] = v;
    }
  }

  result.innerHTML = `
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
      <span class="muted">You pay</span>
      <span style="font-weight:700;">${map["From"] || "--"}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
      <span class="muted">You receive</span>
      <span style="font-weight:700;">${map["To"] || "--"}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
      <span class="muted">Minimum received</span>
      <span>${map["Min received"] || "--"}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid rgba(255,255,255,0.05);">
      <span class="muted">Price impact</span>
      <span>${map["Price impact"] || "--"}</span>
    </div>
    <div style="display:flex;justify-content:space-between;padding:8px 0;">
      <span class="muted">Route</span>
      <span style="text-align:right;max-width:60%;">${map["Route"] || "--"}</span>
    </div>
  `;
};

// --- Live token search list for swap ---
let swapSearchTimer = null;
let swapTokenSearchResults = [];

function renderSwapSelectedToken(token) {
  const box = document.getElementById("swapSelectedToken");
  const select = document.getElementById("swapToToken");
  if (!box || !select) return;

  if (!token) {
    box.style.display = "none";
    box.innerHTML = "";
    return;
  }

  box.style.display = "block";
  box.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px;">
      <div>
        <div style="font-weight:700;">${token.symbol || "TOKEN"} — ${token.name || "Unknown"}</div>
        <div class="muted" style="margin-top:4px;">CA: ${token.id}</div>
      </div>
      <button onclick="clearSelectedSwapToken()" style="border:none;background:#0f1511;color:white;border-radius:10px;padding:6px 10px;cursor:pointer;">✕</button>
    </div>
  `;

  select.innerHTML = `<option value="${token.id}" selected>${token.symbol || "TOKEN"} — ${token.name || "Unknown"}</option>`;
}

function clearSelectedSwapToken() {
  const box = document.getElementById("swapSelectedToken");
  const results = document.getElementById("swapTokenResults");
  const select = document.getElementById("swapToToken");
  const search = document.getElementById("swapToSearch");

  if (box) {
    box.style.display = "none";
    box.innerHTML = "";
  }
  if (results) results.innerHTML = "";
  if (select) select.innerHTML = `<option value="">Select token</option>`;
  if (search) search.value = "";
}

function renderSwapTokenResults(tokens) {
  const wrap = document.getElementById("swapTokenResults");
  const select = document.getElementById("swapToToken");
  if (!wrap || !select) return;

  wrap.innerHTML = "";

  if (!tokens || !tokens.length) {
    wrap.innerHTML = `<div class="muted">No tokens found.</div>`;
    return;
  }

  for (const token of tokens.slice(0, 15)) {
    const item = document.createElement("button");
    item.type = "button";
    item.style.border = "1px solid rgba(255,255,255,0.06)";
    item.style.background = "#171d18";
    item.style.color = "white";
    item.style.borderRadius = "14px";
    item.style.padding = "12px";
    item.style.cursor = "pointer";
    item.style.textAlign = "left";
    item.innerHTML = `
      <div style="font-weight:700;">${token.symbol || "TOKEN"} — ${token.name || "Unknown"}</div>
      <div class="muted" style="margin-top:4px;">CA: ${token.id}</div>
    `;
    item.onclick = () => {
      select.innerHTML = "";
      const opt = document.createElement("option");
      opt.value = token.id;
      opt.textContent = `${token.symbol || "TOKEN"} — ${token.name || "Unknown"}`;
      opt.dataset.symbol = token.symbol || "";
      opt.dataset.name = token.name || "";
      opt.dataset.decimals = String(token.decimals ?? 0);
      opt.selected = true;
      select.appendChild(opt);

      renderSwapSelectedToken(token);
      wrap.innerHTML = "";
    };
    wrap.appendChild(item);
  }
}

async function liveSearchSwapTokens(query) {
  const result = document.getElementById("swapQuoteResult");
  const wrap = document.getElementById("swapTokenResults");

  if (!query.trim()) {
    if (wrap) wrap.innerHTML = "";
    return;
  }

  try {
    if (result) result.innerText = "Searching tokens...";
    const res = await fetch(`${JUP_BASE}/tokens/v2/search?query=${encodeURIComponent(query.trim())}`);
    if (!res.ok) throw new Error(`Token search failed: ${res.status}`);
    const data = await res.json();

    swapTokenSearchResults = Array.isArray(data) ? data : [];
    renderSwapTokenResults(swapTokenSearchResults);

    if (result) {
      result.innerText = swapTokenSearchResults.length
        ? `Found ${Math.min(swapTokenSearchResults.length, 15)} token(s).`
        : "No matching tokens found.";
    }
  } catch (err) {
    if (wrap) wrap.innerHTML = `<div class="muted">Search failed.</div>`;
    if (result) result.innerText = "Search error: " + err.message;
    console.error(err);
  }
}

const _oldSearchSwapTokens = window.searchSwapTokens;
window.searchSwapTokens = async function () {
  const input = document.getElementById("swapToSearch");
  await liveSearchSwapTokens(input?.value || "");
};

document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("swapToSearch");
  if (!input) return;

  input.addEventListener("input", () => {
    clearTimeout(swapSearchTimer);
    swapSearchTimer = setTimeout(() => {
      liveSearchSwapTokens(input.value || "");
    }, 250);
  });
});

window.clearSelectedSwapToken = clearSelectedSwapToken;

// --- Wallet view switcher ---
let activeWalletView = localStorage.getItem("rocketActiveWalletView") || "sol";

function applyWalletView() {
  const solBtn = document.getElementById("walletSwitchSol");
  const ethBtn = document.getElementById("walletSwitchEth");
  const solCard = document.getElementById("solAssetCard");
  const ethCard = document.getElementById("ethAssetCard");
  const splSection = document.getElementById("splTokenList")?.closest(".section");
  const portfolioSub = document.getElementById("portfolioSub");

  if (solBtn) solBtn.classList.toggle("active", activeWalletView === "sol");
  if (ethBtn) ethBtn.classList.toggle("active", activeWalletView === "eth");

  if (solCard) solCard.style.display = activeWalletView === "sol" ? "block" : "none";
  if (ethCard) ethCard.style.display = activeWalletView === "eth" ? "block" : "none";

  if (splSection) splSection.style.display = activeWalletView === "sol" ? "block" : "none";

  if (portfolioSub) {
    portfolioSub.innerText = activeWalletView === "sol"
      ? "Viewing Solana wallet"
      : "Viewing Ethereum wallet";
  }
}

window.switchWalletView = function (view) {
  activeWalletView = view === "eth" ? "eth" : "sol";
  localStorage.setItem("rocketActiveWalletView", activeWalletView);
  applyWalletView();
};

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    applyWalletView();
  }, 50);
});

// --- Active wallet value + receive behavior ---
function refreshPortfolioForActiveWallet() {
  const portfolioValueEl = document.getElementById("portfolioValue");
  const portfolioSubEl = document.getElementById("portfolioSub");

  const ethValue = Number(ethBalance || 0) * Number(ethPrice || 0);
  const solValue = Number(solBalance || 0) * Number(solPrice || 0);

  if (!portfolioValueEl || !portfolioSubEl) return;

  if (activeWalletView === "eth") {
    portfolioValueEl.innerText = formatUsd(ethValue);
    portfolioSubEl.innerText = ethAddress
      ? "Viewing Ethereum wallet"
      : "Open your Ethereum wallet";
  } else {
    portfolioValueEl.innerText = formatUsd(solValue);
    portfolioSubEl.innerText = solAddress
      ? "Viewing Solana wallet"
      : "Open your Solana wallet";
  }
}

window.receiveForActiveWallet = function () {
  if (activeWalletView === "eth") {
    showReceiveSheet("ETH");
  } else {
    showReceiveSheet("SOL");
  }
};

const _oldApplyWalletView_rw2 = applyWalletView;
applyWalletView = function () {
  _oldApplyWalletView_rw2();
  refreshPortfolioForActiveWallet();
};

const _oldRefreshPortfolio_rw2 = refreshPortfolio;
refreshPortfolio = function () {
  _oldRefreshPortfolio_rw2();
  refreshPortfolioForActiveWallet();
};

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    try { refreshPortfolioForActiveWallet(); } catch {}
  }, 80);
});

// --- Go Home shortcut ---
window.goHome = function () {
  if (typeof goToPage === "function") {
    goToPage("homePage");
  } else {
    // fallback
    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
    const home = document.getElementById("homePage");
    if (home) home.classList.add("active");
  }
};

// --- UI polish helpers ---
window.goHome = function () {
  if (typeof goToPage === "function") {
    goToPage("homePage");
    return;
  }

  document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
  const home = document.getElementById("homePage");
  if (home) home.classList.add("active");
};

document.addEventListener("DOMContentLoaded", () => {
  document.querySelectorAll("button").forEach(btn => {
    btn.addEventListener("mousedown", () => {
      btn.style.transform = "scale(0.985)";
    });
    btn.addEventListener("mouseup", () => {
      btn.style.transform = "";
    });
    btn.addEventListener("mouseleave", () => {
      btn.style.transform = "";
    });
  });
});

// --- UI polish for swap result ---
document.addEventListener("DOMContentLoaded", () => {
  const quote = document.getElementById("swapQuoteResult");
  if (quote && !quote.innerText.trim()) {
    quote.innerText = "Enter an amount and choose a token to preview your swap.";
  }
});

// --- Ethereum accounts drawer support ---
let ethAccounts = [];
let activeEthAccountIndex = Number(localStorage.getItem("rocketActiveEthAccountIndex") || "0");
let ethAccountCount = Number(localStorage.getItem("rocketEthAccountCount") || "1");

function shortEthAccount(addr) {
  if (!addr) return "Unknown";
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function renderEthAccountsList() {
  const list = document.getElementById("ethAccountsList");
  if (!list) return;

  if (!ethAccounts.length) {
    list.innerHTML = `<div class="muted">Open your Ethereum wallet to view accounts.</div>`;
    return;
  }

  list.innerHTML = "";
  for (const acct of ethAccounts) {
    const btn = document.createElement("button");
    btn.className = "account-item" + (acct.index === activeEthAccountIndex ? " active" : "");
    btn.onclick = () => switchEthereumAccount(acct.index);
    btn.innerHTML = `
      <div style="font-weight:700;">ETH Wallet ${acct.index + 1}</div>
      <span class="muted">${shortEthAccount(acct.address)}</span>
    `;
    list.appendChild(btn);
  }
}

async function buildEthAccountsList() {
  if (!ethAddress) {
    ethAccounts = [];
    renderEthAccountsList();
    return;
  }

  const base = ethAddress;
  const accounts = [];

  for (let i = 0; i < ethAccountCount; i++) {
    // UI-only derived list for now. Keeps current wallet working without changing key logic.
    const derivedAddress = i === 0
      ? base
      : base.slice(0, -Math.min(4, base.length)) + String(i).padStart(4, "0");

    accounts.push({
      index: i,
      address: derivedAddress
    });
  }

  ethAccounts = accounts;
  renderEthAccountsList();
}

async function switchEthereumAccount(index) {
  if (!ethAccounts.length) {
    await buildEthAccountsList();
  }
  if (!ethAccounts[index]) return;

  activeEthAccountIndex = index;
  localStorage.setItem("rocketActiveEthAccountIndex", String(index));

  // For now this switches the displayed ETH wallet slot in the UI.
  // Wallet 1 remains the real loaded ETH wallet until full ETH derivation is added.
  ethAddress = ethAccounts[index].address;

  const ethAddressShort = document.getElementById("ethAddressShort");
  if (ethAddressShort) ethAddressShort.innerText = shortAddress(ethAddress);

  renderEthAccountsList();
  refreshPortfolio();
}

async function addDerivedEthAccount() {
  ethAccountCount += 1;
  localStorage.setItem("rocketEthAccountCount", String(ethAccountCount));
  await buildEthAccountsList();
  await switchEthereumAccount(ethAccountCount - 1);
}

window.addDerivedEthAccount = addDerivedEthAccount;
window.switchEthereumAccount = switchEthereumAccount;

const _oldOpenWallet_ethAccounts = window.openWallet;
if (typeof _oldOpenWallet_ethAccounts === "function") {
  window.openWallet = async function () {
    await _oldOpenWallet_ethAccounts();
    await buildEthAccountsList();
    if (ethAccounts[activeEthAccountIndex]) {
      await switchEthereumAccount(activeEthAccountIndex);
    }
  };
}

document.addEventListener("DOMContentLoaded", () => {
  setTimeout(() => {
    try { buildEthAccountsList(); } catch {}
  }, 120);
});

// --- Bottom nav cleanup for Markets / Settings only ---
const _oldShowMainPage_bottomClean = window.showMainPage || showMainPage;
window.showMainPage = function (evt, pageId) {
  _oldShowMainPage_bottomClean(evt, pageId);

  const marketsBtn = document.getElementById("bottomMarketsBtn");
  const settingsBtn = document.getElementById("bottomSettingsBtn");

  if (marketsBtn) marketsBtn.classList.toggle("active", pageId === "marketsPage");
  if (settingsBtn) settingsBtn.classList.toggle("active", pageId === "settingsPage");
};

// --- Send shortcut ---
window.openSendSheet = function () {
  if (activeWalletView === "eth") {
    showSendSheet("ETH");
  } else {
    showSendSheet("SOL");
  }
};


// --- App version display ---
try {
  const v = require("electron").ipcRenderer.sendSync("get-version");
  const el = document.getElementById("appVersion");
  if (el) el.innerText = "v" + v;
} catch {}
