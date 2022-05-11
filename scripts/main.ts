import { BigNumber } from "ethers";
import { generateMerkleScoresForPeriod } from "./merkle/merkleGenerator";

const main = async () => {
  const period = process.argv.slice(2)[0];
  if (!!period) {
    await generateMerkleScoresForPeriod(BigNumber.from(period));
  } else {
    console.error("Gimme period");
  }
};

main();
