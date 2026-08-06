const fs = require("node:fs");
const path = require("node:path");

const contracts = [
  ["MarsBrokersNFT", "contracts/MarsBrokersNFT.sol/MarsBrokersNFT.json"],
  ["MarsBrokerAccount", "contracts/MarsBrokerAccount.sol/MarsBrokerAccount.json"],
  ["MarsBrokersStaking", "contracts/MarsBrokersStaking.sol/MarsBrokersStaking.json"],
  ["MarsBrokersMarket", "contracts/MarsBrokersMarket.sol/MarsBrokersMarket.json"],
  ["MarsBrokerRouter", "contracts/MarsBrokerRouter.sol/MarsBrokerRouter.json"]
];

const root = path.join(__dirname, "..");
const outputDir = path.resolve(root, "..", "marsbrokers-frontend", "src", "contracts", "abi");
fs.mkdirSync(outputDir, { recursive: true });

for (const [name, artifactPath] of contracts) {
  const artifact = JSON.parse(fs.readFileSync(path.join(root, "artifacts", artifactPath), "utf8"));
  fs.writeFileSync(
    path.join(outputDir, `${name}.json`),
    `${JSON.stringify(artifact.abi, null, 2)}\n`
  );
  console.log(`Exported ${name}`);
}
