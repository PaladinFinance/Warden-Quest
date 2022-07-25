import { BigNumber, ethers } from "ethers";
import { WARDEN_QUEST_CONTRACT_ADRESS } from "./constants/gauge.constants";
import { generateMerkleScoresForPeriod } from "./merkle/merkleGenerator";
import questBoardABI from "../abi/QuestBoard.json";

const provider = new ethers.providers.JsonRpcProvider(process.env.MAINNET_URI);

const main = async () => {
  let period = process.argv.slice(2)[0];
  const questBoardContract: ethers.Contract = new ethers.Contract(WARDEN_QUEST_CONTRACT_ADRESS, questBoardABI, provider);
  period = await questBoardContract.getCurrentPeriod();
  console.log(period.toString());
  if (!!period) {
    await generateMerkleScoresForPeriod(BigNumber.from(period));
  } else {
    console.error("Gimme period");
  }
};

main();
