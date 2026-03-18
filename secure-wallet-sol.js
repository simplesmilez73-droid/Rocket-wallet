const fs = require("fs");
const path = require("path");
const bip39 = require("bip39");
const { derivePath } = require("ed25519-hd-key");
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} = require("@solana/web3.js");

const WALLET_FILE = path.join(__dirname, "sol-wallet-data.json");
const connection = new Connection("https://api.mainnet-beta.solana.com", "confirmed");

function encodeSecretKey(secretKeyUint8) {
  return JSON.stringify(Array.from(secretKeyUint8));
}

function decodeSecretKey(secretKeyString) {
  return Uint8Array.from(JSON.parse(secretKeyString));
}

async function createSolWallet(password) {
  if (!password || password.trim() === "") {
    throw new Error("Please enter a Solana password.");
  }

  const mnemonic = bip39.generateMnemonic();
  const seed = await bip39.mnemonicToSeed(mnemonic);
  const derivedSeed = derivePath("m/44'/501'/0'/0'", seed.toString("hex")).key;
  const keypair = Keypair.fromSeed(derivedSeed);

  const payload = {
    secretKey: encodeSecretKey(keypair.secretKey),
    mnemonic,
  };

  const encrypted = Buffer.from(
    JSON.stringify({ password, payload }),
    "utf8"
  ).toString("base64");

  fs.writeFileSync(WALLET_FILE, encrypted, "utf8");

  return {
    address: keypair.publicKey.toBase58(),
    mnemonic,
  };
}

async function loadSolWallet(password) {
  if (!fs.existsSync(WALLET_FILE)) {
    throw new Error("No Solana wallet found. Create one first.");
  }

  const raw = fs.readFileSync(WALLET_FILE, "utf8");
  const decoded = JSON.parse(Buffer.from(raw, "base64").toString("utf8"));

  if (decoded.password !== password) {
    throw new Error("Wrong password.");
  }

  const secretKey = decodeSecretKey(decoded.payload.secretKey);
  return Keypair.fromSecretKey(secretKey);
}

async function getSolBalance(address) {
  const publicKey = new PublicKey(address);
  const lamports = await connection.getBalance(publicKey);
  return lamports / LAMPORTS_PER_SOL;
}

async function sendSol(password, to, amount) {
  const sender = await loadSolWallet(password);
  const recipient = new PublicKey(to);

  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: sender.publicKey,
      toPubkey: recipient,
      lamports: Math.round(Number(amount) * LAMPORTS_PER_SOL),
    })
  );

  const signature = await sendAndConfirmTransaction(connection, tx, [sender]);
  return signature;
}

module.exports = {
  createSolWallet,
  loadSolWallet,
  getSolBalance,
  sendSol,
};
