const { ethers } = require("ethers");
const readline = require("readline");

// connect to ethereum
const provider = new ethers.JsonRpcProvider("https://ethereum.publicnode.com");

// PUT YOUR PRIVATE KEY HERE
const privateKey = "0xb64f174f716e8034d0142276486d8dd885192bfc0bbf96658a84a5e0949f57cd";

const wallet = new ethers.Wallet(privateKey, provider);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

async function showMenu() {
  console.log("\n--- My Crypto Wallet ---");
  console.log("1. Show Address");
  console.log("2. Check Balance");
  console.log("3. Send ETH");
  console.log("4. Exit");

  rl.question("Choose option: ", async (answer) => {

    if (answer === "1") {
      console.log("Address:", wallet.address);
      showMenu();
    }

    else if (answer === "2") {
      const balance = await provider.getBalance(wallet.address);
      console.log("Balance:", ethers.formatEther(balance), "ETH");
      showMenu();
    }

    else if (answer === "3") {

      rl.question("Recipient address: ", (to) => {

        rl.question("Amount ETH: ", async (amount) => {

          const tx = await wallet.sendTransaction({
            to: to,
            value: ethers.parseEther(amount)
          });

          console.log("Transaction sent:", tx.hash);
          showMenu();

        });

      });

    }

    else {
      rl.close();
    }

  });
}

showMenu();