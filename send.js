const { ethers } = require("ethers");

// Connect to Ethereum network
const provider = new ethers.JsonRpcProvider("https://cloudflare-eth.com");

// Your wallet private key
const privateKey = "PUT_YOUR_PRIVATE_KEY_HERE";

// Create wallet
const wallet = new ethers.Wallet(privateKey, provider);

async function sendCrypto() {

    const tx = {
        to: "RECIPIENT_ADDRESS",
        value: ethers.parseEther("0.001")
    };

    const transaction = await wallet.sendTransaction(tx);

    console.log("Transaction sent!");
    console.log("TX Hash:", transaction.hash);
}

sendCrypto();