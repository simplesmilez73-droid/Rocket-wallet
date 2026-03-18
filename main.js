const { app, BrowserWindow, ipcMain } = require("electron");
const walletLib = require("./secure-wallet");
const solWalletLib = require("./secure-wallet-sol");

function createWindow() {
  const win = new BrowserWindow({
    width: 900,
    height: 700,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  win.loadFile("index.html");
}

app.whenReady().then(() => {
  createWindow();

  ipcMain.handle("create-wallet", async (_, password) => {
    return await walletLib.createWallet(password);
  });

  ipcMain.handle("load-wallet", async (_, password) => {
    const wallet = await walletLib.loadWallet(password);
    const balance = await walletLib.getBalance(wallet.address);

    return {
      address: wallet.address,
      balance
    };
  });

  ipcMain.handle("send-eth", async (_, password, to, amount) => {
    return await walletLib.sendEth(password, to, amount);
  });

  ipcMain.handle("create-sol-wallet", async (_, password) => {
    return await solWalletLib.createSolWallet(password);
  });

  ipcMain.handle("load-sol-wallet", async (_, password) => {
    const wallet = await solWalletLib.loadSolWallet(password);
    const balance = await solWalletLib.getSolBalance(wallet.publicKey.toBase58());

    return {
      address: wallet.publicKey.toBase58(),
      balance
    };
  });

  ipcMain.handle("send-sol", async (_, password, to, amount) => {
    return await solWalletLib.sendSol(password, to, amount);
  });
});

// --- Nova Keychain bridge ---
const keytar = require("keytar");

const NOVA_KEYCHAIN_SERVICE = "Nova Wallet";
const NOVA_SOL_MNEMONIC_ACCOUNT = "solana-mnemonic";

ipcMain.handle("keychain-save-sol-mnemonic", async (_event, mnemonic) => {
  if (!mnemonic || typeof mnemonic !== "string") {
    throw new Error("Missing mnemonic");
  }
  await keytar.setPassword(
    NOVA_KEYCHAIN_SERVICE,
    NOVA_SOL_MNEMONIC_ACCOUNT,
    mnemonic
  );
  return { ok: true };
});

ipcMain.handle("keychain-get-sol-mnemonic", async () => {
  const mnemonic = await keytar.getPassword(
    NOVA_KEYCHAIN_SERVICE,
    NOVA_SOL_MNEMONIC_ACCOUNT
  );
  return { mnemonic: mnemonic || null };
});

ipcMain.handle("keychain-clear-sol-mnemonic", async () => {
  await keytar.deletePassword(
    NOVA_KEYCHAIN_SERVICE,
    NOVA_SOL_MNEMONIC_ACCOUNT
  );
  return { ok: true };
});

// --- Rocket Wallet: import Solana wallet from seed phrase ---
const bip39_import_rw = require("bip39");
const { derivePath: derivePath_import_rw } = require("ed25519-hd-key");
const { Keypair: SolanaKeypair_import_rw } = require("@solana/web3.js");
const keytar_import_rw = require("keytar");

ipcMain.handle("import-sol-wallet-from-mnemonic", async (_event, mnemonic) => {
  const phrase = (mnemonic || "").trim().replace(/\s+/g, " ");
  if (!phrase) throw new Error("Missing seed phrase");
  if (!bip39_import_rw.validateMnemonic(phrase)) {
    throw new Error("Invalid seed phrase");
  }

  const seed = await bip39_import_rw.mnemonicToSeed(phrase);
  const path = "m/44'/501'/0'/0'";
  const derived = derivePath_import_rw(path, seed.toString("hex")).key;
  const keypair = SolanaKeypair_import_rw.fromSeed(derived);

  // Keep the existing service/account name for compatibility
  await keytar_import_rw.setPassword("Nova Wallet", "solana-mnemonic", phrase);

  return {
    address: keypair.publicKey.toBase58(),
    mnemonic: phrase
  };
});
