import { BigNumber, ethers } from "ethers";
import questBoardABI from "../../abi/QuestBoard.json";
import { WARDEN_QUEST_CONTRACT_ADRESS, WEEK } from "../constants/gauge.constants";
import { Quest } from "../dto/quest";
const provider = new ethers.providers.JsonRpcProvider(process.env.MAINNET_URI);

export const getQuestFromId = async (questId: string): Promise<Quest> => {
  const questBoardContract: ethers.Contract = new ethers.Contract(WARDEN_QUEST_CONTRACT_ADRESS, questBoardABI, provider);
  const id = BigNumber.from(questId);
  const period = await questBoardContract.getCurrentPeriod();
  const rawQuest = await questBoardContract.quests(id);
  const questPeriod = await questBoardContract.periodsByQuest(id, period);
  const quest: Quest = {
    questID: id,
    creator: rawQuest.creator,
    gauge: rawQuest.gauge,
    rewardToken: rawQuest.rewardToken,
    duration: BigNumber.from(rawQuest.duration),
    periodStart: BigNumber.from(questPeriod[5]),
    objectiveVotes: questPeriod[2],
    rewardPerVote: questPeriod[1],
  };
  return quest;
};

export const getQuestsFromPeriod = async (period: BigNumber): Promise<Quest[]> => {
  const questBoardContract: ethers.Contract = new ethers.Contract(WARDEN_QUEST_CONTRACT_ADRESS, questBoardABI, provider);
  const questsIdsFromContract = await questBoardContract.getQuestIdsForPeriod(period);
  let quests: Quest[] = [];

  await Promise.all(
    questsIdsFromContract.map(async (id: BigNumber) => {
      const rawQuest = await questBoardContract.quests(id);
      const questPeriod = await questBoardContract.periodsByQuest(id, period);
      const quest: Quest = {
        questID: id,
        creator: rawQuest.creator,
        gauge: rawQuest.gauge,
        rewardToken: rawQuest.rewardToken,
        duration: BigNumber.from(rawQuest.duration),
        periodStart: BigNumber.from(questPeriod[5]),
        objectiveVotes: questPeriod[2],
        rewardPerVote: questPeriod[1],
      };
      quests.push(quest);
    })
  );
  return quests;
};
