import { BigNumber, ethers } from "ethers";
import { Interface } from "ethers/lib/utils";
import curveGaugeControllerABI from "../../abi/curveGaugeController.json";
import { WARDEN_QUEST_CONTRACT_ADRESS } from "../constants/gauge.constants";
import { DateUtils } from "./date.utils";
import questBoardABI from "../../abi/QuestBoard.json";

const provider = new ethers.providers.JsonRpcProvider(
  "http://164.132.55.131:8546/"
);
export const GAUGE_CONTROLLER_ADRESS =
  "0x2F50D538606Fa9EDD2B11E2446BEb18C9D5846bB";

export const getGauges = async (reference: BigNumber) => {
  const iGaugeController = new Interface(curveGaugeControllerABI);
  const voteForGaugeTopic = iGaugeController.getEventTopic("NewGauge");
  const scanBlockNumber = await DateUtils.getTimestampBlock(
    reference.toNumber(),
    provider
  );

  //Get the events of voting
  const filter = {
    fromBlock: 0,
    toBlock: scanBlockNumber,
    topics: [voteForGaugeTopic],
  };
  const logs = await provider.getLogs(filter);
  const gauges: ethers.utils.LogDescription[] = logs
    .filter((log) => {
      return log.removed === false;
    })
    .map((log) => {
      return iGaugeController.parseLog(log);
    });

  return gauges;
};

const test = async () => {
  const sevenDays = 7 * 24 * 60 * 60;
  const questBoardContract: ethers.Contract = new ethers.Contract(
    WARDEN_QUEST_CONTRACT_ADRESS,
    questBoardABI,
    provider
  );
  let questsIdsFromContract = await questBoardContract.getCurrentPeriod();
  console.log(questsIdsFromContract.sub(sevenDays).toString());

  //await provider.send("evm_increaseTime", [sevenDays]);
};

test();
