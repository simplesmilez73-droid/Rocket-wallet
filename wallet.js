const { ethers } = require("ethers");

// Generate a random wallet
const wallet = ethers.Wallet.createRandom();

console.log("----- YOUR WALLET -----");
console.log("Address:", wallet.address);
console.log("Private Key:", wallet.privateKey);
console.log("Seed Phrase:", wallet.mnemonic.phrase);