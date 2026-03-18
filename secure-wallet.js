

const { ipcMain, app } = require("electron");

ipcMain.on("get-version", (event) => {
  event.returnValue = app.getVersion();
});
const { autoUpdater } = require("electron-updater");
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");

const WALLET_FILE = path.join(__dirname, "wallet-data.json");
const provider = new ethers.JsonRpcProvider("https://ethereum.publicnode.com");

async function createWallet(password) {
  const wallet = ethers.Wallet.createRandom();
  const encryptedJson = await wallet.encrypt(password);

  fs.writeFileSync(WALLET_FILE, encryptedJson, "utf8");

  return {
    address: wallet.address,
    mnemonic: wallet.mnemonic.phrase
  };
}

async function loadWallet(password) {
  if (!fs.existsSync(WALLET_FILE)) {
    throw new Error("No wallet found. Create one first.");
  }

  const encryptedJson = fs.readFileSync(WALLET_FILE, "utf8");
  const wallet = await ethers.Wallet.fromEncryptedJson(encryptedJson, password);
  return wallet.connect(provider);
}

async function getBalance(address) {
  const balance = await provider.getBalance(address);
  return ethers.formatEther(balance);
}

async function sendEth(password, to, amount) {
  const wallet = await loadWallet(password);

  const tx = await wallet.sendTransaction({
    to,
    value: ethers.parseEther(amount)
  });

  return tx.hash;
}

module.exports = {
  createWallet,
  loadWallet,
  getBalance,
  sendEth
};


// --- Auto Update ---
app.whenReady().then(() => {
  try {
    autoUpdater.checkForUpdatesAndNotify();
  } catch (e) {
    console.error("Updater init failed:", e);
  }
});

autoUpdater.on("update-available", () => {
  console.log("Update available");
});

autoUpdater.on("update-downloaded", () => {
  console.log("Update downloaded");
  autoUpdater.quitAndInstall();
});

autoUpdater.on("error", (err) => {
  console.error("Update error:", err);
});
