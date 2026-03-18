const { Connection, VersionedTransaction } = require("@solana/web3.js");

const connection = new Connection("https://api.mainnet-beta.solana.com");

async function executeRealSwap({ quote, swapData, keypair }) {
  try {
    if (!swapData?.swapTransaction) {
      throw new Error("Missing swap transaction");
    }

    const tx = VersionedTransaction.deserialize(
      Buffer.from(swapData.swapTransaction, "base64")
    );

    // sign locally
    tx.sign([keypair]);

    // send
    const sig = await connection.sendTransaction(tx);

    // confirm
    await connection.confirmTransaction(sig);

    return { success: true, signature: sig };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

module.exports = { executeRealSwap };
