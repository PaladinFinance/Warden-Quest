import { BigNumber, ethers } from "ethers";
import { Vote } from "../dto/vote";
import {
  biasChecker,
  getVotesEvents,
  getVotesForGauge,
} from "../utils/gaugeVotes.utils";
import * as fs from "fs";
import { getQuestFromId, getQuestsFromPeriod } from "../utils/quests.utils";
import { Quest } from "../dto/quest";
import { Score } from "../dto/score";
import { Balance } from "../dto/balance";
import { parseBalanceMap } from "./src/parse-balance-map";
import { WEEK } from "../constants/gauge.constants";

const generateMerkleScore = async (
  quest: Quest,
  votesEvents: ethers.utils.LogDescription[],
  period: BigNumber
) => {
  console.log("Start merkle for ", quest.questID.toString());
  let listOfVotes: Vote[] = await getVotesForGauge(
    votesEvents,
    quest.gauge,
    period
  );

  console.log(listOfVotes.length, " votes for the gauge");
  console.log(
    "Bias checker :",
    await biasChecker(quest.gauge, period, listOfVotes)
  );
  let score: Score = {};
  let balance: Balance = {};
  if (listOfVotes.length === 0) return { score: score, balance: balance };
  let totalBias: BigNumber = BigNumber.from(0);
  let biasCheck = BigNumber.from(0);
  let voteRewardCheck = BigNumber.from(0);

  for (let vote of listOfVotes) {
    if (totalBias.gt(quest.objectiveVotes)) break;
    totalBias = totalBias.add(vote.bias);
    let voteBias = totalBias.gt(quest.objectiveVotes)
      ? vote.bias.sub(totalBias.sub(quest.objectiveVotes))
      : vote.bias;
    biasCheck = biasCheck.add(
      totalBias.gt(quest.objectiveVotes)
        ? vote.bias.sub(totalBias.sub(quest.objectiveVotes))
        : vote.bias
    );
    let voteReward = voteBias
      .mul(quest.rewardPerVote)
      .div(ethers.constants.WeiPerEther);
    voteRewardCheck = voteRewardCheck.add(voteBias.mul(quest.rewardPerVote));
    //Gaardur
    if (
      vote.user === "0x0037f3Deb586d1b34aBAAe92341F9Bb70527a4d4" ||
      vote.user === "0x1FBB5a5687E08177e5B70E80D9884910c373F694"
    )
      vote.user = "0x5ACbD1C0Ad98349BCA68B33E1dD3041aa3EeA1Ba";
    //Frieeze
    if (
      vote.user === "0x004d415be7d9ef539E16f4A9D2E5d29C06789ece" ||
      vote.user === "0xF89501B77b2FA6329F94F5A05FE84cEbb5c8b1a0"
    )
      vote.user = "0x3Dbf0047dd16BfEC26b18419be6F36382e383852";
    //Koga
    if (
      vote.user === "0x04e8e5aA372D8e2233D2EF26079e23E3309003D5" ||
      vote.user === "0x32D03DB62e464c9168e41028FFa6E9a05D8C6451"
    )
      vote.user = "0x26D756D057513a43b89735CBd581d5B6eD1b0711";

    score[vote.user] = {
      time: vote.time.toString(),
      bias: voteBias.toString(),
      reward: voteReward.toString(),
    };
    balance[vote.user] = {
      questID: quest.questID,
      period: quest.periodStart,
      earning: voteReward.toString(),
    };
  }

  console.log(
    "biasCheck :",
    biasCheck
      .mul(quest.rewardPerVote)
      .div(ethers.constants.WeiPerEther)
      .toString(),
    " | voteRewardCheck :",
    voteRewardCheck.div(ethers.constants.WeiPerEther).toString(),
    " | diff :",
    biasCheck
      .mul(quest.rewardPerVote)
      .div(ethers.constants.WeiPerEther)
      .sub(voteRewardCheck.div(ethers.constants.WeiPerEther))
      .toString()
  );
  try {
    console.log("Writing files for ", quest.questID.toString());
    let dir = `scripts/data/${quest.periodStart.toString()}`;
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      dir.concat(`/${quest.questID.toString()}_scores.json`),
      JSON.stringify(score)
    );
    fs.writeFileSync(
      dir.concat(`/${quest.questID.toString()}_balance.json`),
      JSON.stringify(balance)
    );
  } catch (err) {
    console.error(err);
  }

  return { score: score, balance: balance };
};
export const generateMerkleScoresForQuest = async (
  questId: string,
  period: BigNumber
) => {
  const quest: Quest = await getQuestFromId(questId);
  const voteEvents = await getVotesEvents(period);

  await generateMerkleScore(quest, voteEvents, period);
};

export const generateMerkleScoresForPeriod = async (period: BigNumber) => {
  const quests = await getQuestsFromPeriod(period);
  const voteEvents = await getVotesEvents(period);
  const merkleRoots: {
    questId: string;
    merkleRoot: string;
    tokenTotal: string;
  }[] = [];

  for (const quest of quests) {
    let scoreAndBalance = await generateMerkleScore(quest, voteEvents, period);
    if (
      Object.values(scoreAndBalance.score).length === 0 ||
      Object.values(scoreAndBalance.balance).length === 0
    )
      continue;
    let merkleTree = parseBalanceMap(scoreAndBalance.balance);
    merkleRoots.push({
      questId: quest.questID.toString(),
      merkleRoot: merkleTree.merkleRoot,
      tokenTotal: merkleTree.tokenTotal,
    });
    try {
      fs.writeFileSync(
        `scripts/data/${quest.periodStart.toString()}/${quest.questID.toString()}_merkle_root.json`,
        JSON.stringify(merkleTree)
      );
    } catch (err) {
      console.error(err);
    }
  }
  try {
    fs.writeFileSync(
      `scripts/data/${period.toString()}/${period.toString()}_quests_merkle_roots.json`,
      JSON.stringify(merkleRoots)
    );
  } catch (err) {
    console.error(err);
  }
};

/**
 * Test
 */
const gmsTest = async () => {
  //await generateMerkleScoresForQuest("1", BigNumber.from(1652313600));
  await generateMerkleScoresForPeriod(BigNumber.from(1652313600));
};

gmsTest();
