import { BigNumber, ethers } from "ethers";
import { Interface } from "ethers/lib/utils";
import curveGaugeControllerABI from "../../abi/curveGaugeController.json";
import {
  GAUGE_CONTROLLER_ADRESS,
  TO_MILISECOND,
} from "../constants/gauge.constants";
import { Vote } from "../dto/vote";
import { VoteMapper } from "../mappers/vote.mapper";
import { DateUtils } from "./date.utils";
import { Display } from "./display.utils";
import * as dotenv from "dotenv";

dotenv.config();
const provider = new ethers.providers.JsonRpcProvider(process.env.MAINNET_URI);

export const getVotesEvents = async (reference: BigNumber) => {
  const iGaugeController = new Interface(curveGaugeControllerABI);
  const voteForGaugeTopic = iGaugeController.getEventTopic("VoteForGauge");
  const scanBlockNumber = await DateUtils.getTimestampBlock(
    reference.toNumber(),
    provider
  );

  const blocksIntervals = [];
  for (let index = 10647874; index < scanBlockNumber; index += 100000) {
    blocksIntervals.push({
      fromBlock: index + 1,
      toBlock:
        index + 100000 <= scanBlockNumber ? index + 100000 : scanBlockNumber,
    });
  }

  let gaugeControllerVote: ethers.utils.LogDescription[] = [];
  await Promise.all(
    blocksIntervals.map(async (blockInterval) => {
      //Get the events of voting
      const filter = {
        fromBlock: blockInterval.fromBlock,
        toBlock: blockInterval.toBlock,
        topics: [voteForGaugeTopic],
      };
      const logs = await provider.getLogs(filter);
      const gaugeControllerVoteOnPeriod: ethers.utils.LogDescription[] = logs
        .filter((log) => {
          return (
            log.address.toLowerCase() ===
              GAUGE_CONTROLLER_ADRESS.toLowerCase() &&
            log.topics.indexOf(voteForGaugeTopic) >= 0
          );
        })
        .map((log) => {
          return iGaugeController.parseLog(log);
        });
      gaugeControllerVote = gaugeControllerVote.concat(
        gaugeControllerVoteOnPeriod
      );
    })
  );

  return gaugeControllerVote;
};

const filterVotesOnGauge = (
  gaugeControllerVote: ethers.utils.LogDescription[],
  gaugeAdress: string,
  reference: BigNumber
): Map<string, Vote[]> => {
  //Get the contract of the gauge controller
  console.log("Getting votes for gauge with adress ", gaugeAdress);

  //Only get the votes on the wanted gauge address
  let listOfVotesByUsers = new Map<string, Vote[]>();
  gaugeControllerVote.forEach((rawVote: ethers.utils.LogDescription) => {
    if (!!rawVote.args) {
      const vote: Vote = VoteMapper.rawVoteToVote(rawVote.args);
      if (vote.gaugeAdress === gaugeAdress && vote.time.lt(reference)) {
        if (!listOfVotesByUsers.has(vote.user)) {
          listOfVotesByUsers.set(vote.user, [vote]);
        } else {
          listOfVotesByUsers.get(vote.user)?.push(vote);
        }
      }
    }
  });

  return listOfVotesByUsers;
};

const getLastEntryVotes = (listOfVotes: Map<string, Vote[]>): Vote[] => {
  const listOfEntryVotes: Vote[] = [];

  //Get the oldest vote for the gauge
  listOfVotes.forEach((votes: Vote[], user: string) => {
    votes.sort((a: Vote, b: Vote) => b.time.sub(a.time).toNumber());

    if (!votes[0].weight.isZero()) {
      listOfEntryVotes.push(votes[0]);
    }
  });

  return listOfEntryVotes;
};

const getUsefulVotesOnGauge = async (
  votesMap: Map<string, Vote[]>,
  gaugeAdress: string,
  reference: BigNumber
): Promise<Vote[]> => {
  const listOfVotes = getLastEntryVotes(votesMap);
  const scanBlockNumber = await DateUtils.getTimestampBlock(
    reference.toNumber(),
    provider
  );
  const gaugeController: ethers.Contract = new ethers.Contract(
    GAUGE_CONTROLLER_ADRESS,
    curveGaugeControllerABI,
    provider
  );

  let countForSlopeVote: Vote[] = [];
  console.log("Waiting one minute for RPC..");
  await DateUtils.delay(10 * 1000);
  //Get all votes slope and calculate the total
  await Promise.all(
    listOfVotes.map(async (vote: Vote) => {
      let userSlope = await gaugeController.vote_user_slopes(
        vote.user,
        gaugeAdress,
        { blockTag: scanBlockNumber }
      );

      if (!userSlope.end.lt(reference)) {
        let user_dt = userSlope.end.sub(reference);
        let user_bias = userSlope.slope.mul(user_dt);
        vote.bias = user_bias;
        countForSlopeVote.push(vote);
      }
    })
  );

  return countForSlopeVote;
};

export const getVotesForGauge = async (
  gaugeControllerVote: ethers.utils.LogDescription[],
  gaugeAdress: string,
  reference: BigNumber
) => {
  console.log("Gettings votes on gauge :", gaugeAdress);
  const filteredVotesOnGauge = filterVotesOnGauge(
    gaugeControllerVote,
    gaugeAdress,
    reference
  );

  console.log("Getting useful votes on gauge :");
  const listOfVotes = await getUsefulVotesOnGauge(
    filteredVotesOnGauge,
    gaugeAdress,
    reference
  );

  return listOfVotes;
};

export const biasChecker = async (
  gaugeAdress: string,
  reference: BigNumber,
  listOfVotes: Vote[]
): Promise<boolean> => {
  const scanBlockNumber = await DateUtils.getTimestampBlock(
    reference.toNumber(),
    provider
  );
  const gaugeController: ethers.Contract = new ethers.Contract(
    GAUGE_CONTROLLER_ADRESS,
    curveGaugeControllerABI,
    provider
  );

  let gaugePointsWeight = await gaugeController.points_weight(
    gaugeAdress,
    reference,
    { blockTag: scanBlockNumber }
  );
  let totalVoteBias = BigNumber.from(0);

  listOfVotes.forEach((vote: Vote) => {
    totalVoteBias = totalVoteBias.add(vote.bias);
  });

  console.log(
    "Bias : Calculate :",
    Display.displayBigNumber(totalVoteBias),
    " | Real : ",
    Display.displayBigNumber(gaugePointsWeight.bias),
    " | Diff : ",
    Display.displayBigNumber(gaugePointsWeight.bias.sub(totalVoteBias))
  );

  return totalVoteBias.eq(gaugePointsWeight.bias);
};

/*
 * Tests
 */

const gaugeVotesTest = async () => {
  let gaugeAdress = "0xDeFd8FdD20e0f34115C7018CCfb655796F6B2168";
  const scanBlockNumber = 14622277;
  const gaugeController: ethers.Contract = new ethers.Contract(
    GAUGE_CONTROLLER_ADRESS,
    curveGaugeControllerABI,
    provider
  );
  let vote = {
    user: "0x989AEb4d175e16225E39E87d0D97A3360524AD80",
  };
  let userSlope = await gaugeController.vote_user_slopes(
    vote.user,
    gaugeAdress,
    { blockTag: scanBlockNumber }
  );
  console.log(userSlope);
};

//gaugeVotesTest();
