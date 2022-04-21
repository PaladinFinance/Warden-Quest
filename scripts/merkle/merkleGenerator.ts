
import { BigNumber, ethers } from "ethers";
import { Vote } from "../dto/vote";
import { biasChecker, getVotesEvents, getVotesForGauge } from "../utils/gaugeVotes.utils";
import * as fs from 'fs';
import { getQuestFromId, getQuestsFromPeriod } from "../utils/quests.utils";
import { Quest } from "../dto/quest";
import { Score } from "../dto/score";
import { DateUtils } from "../utils/date.utils";
import { Balance } from "../dto/balance";
import { parseBalanceMap } from "./src/parse-balance-map";
import { WEEK } from "../constants/gauge.constants";


const generateMerkleScore = async (quest: Quest, votesEvents:ethers.utils.LogDescription[]) => {
    console.log('Start merkle for ', quest.questID.toString())
    let listOfVotes:Vote[] = await getVotesForGauge(votesEvents, quest.gauge, BigNumber.from(1650499200).add(WEEK));
    console.log(listOfVotes.length,' votes for the gauge')
    console.log('Bias checker :', await biasChecker(quest.gauge, BigNumber.from(1650499200).add(WEEK), listOfVotes))
    let score:Score = {}
    let balance:Balance = {}
    let totalBias:BigNumber = BigNumber.from(0);
    let biasCheck = BigNumber.from(0);
    let voteRewardCheck = BigNumber.from(0);

    for(let vote of listOfVotes){
        if(totalBias.gt(quest.objectiveVotes)) break;
        totalBias = totalBias.add(vote.bias);
        let voteBias = totalBias.gt(quest.objectiveVotes) ? vote.bias.sub(totalBias.sub(quest.objectiveVotes)) : vote.bias;
        biasCheck = biasCheck.add(totalBias.gt(quest.objectiveVotes) ? vote.bias.sub(totalBias.sub(quest.objectiveVotes)) : vote.bias);
        let voteReward = voteBias.mul(quest.rewardPerVote);
        voteRewardCheck = voteRewardCheck.add(voteReward);
        score[vote.user] = {
            time: vote.time.toString(),
            bias: voteBias.toString(),
            reward: voteReward.toString()
        }
        balance[vote.user] = {
            questID:quest.questID,
            period:quest.periodStart,
            earning:voteReward.toString()
        }
    }

    console.log('biasCheck :', biasCheck.mul(quest.rewardPerVote).toString(), ' | voteRewardCheck :', voteRewardCheck.toString(), ' | diff :', biasCheck.mul(quest.rewardPerVote).sub(voteRewardCheck).toString())
    try{
        console.log("Writing files for ", quest.questID.toString())
        let dir = `scripts/data/${quest.periodStart.toString()}`
        if(!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true })
        };
        fs.writeFileSync(dir.concat(`/${quest.questID.toString()}_scores.json`), JSON.stringify(score))
        fs.writeFileSync(dir.concat(`/${quest.questID.toString()}_balance.json`), JSON.stringify(balance))
        
    }catch(err){
        console.error(err);
    }
    console.log("Waiting for RPC..")
    await DateUtils.delay(60)
    return {score:score, balance:balance}
}
export const generateMerkleScoresForQuest = async (questId:string) => {
    
    const quest:Quest = await getQuestFromId(questId);
    const voteEvents = await getVotesEvents(quest.periodStart)
    
    await generateMerkleScore(quest, voteEvents)
}

export const generateMerkleScoresForPeriod = async (period:BigNumber) => {
    
    const quests = await getQuestsFromPeriod(period);
    const voteEvents = await getVotesEvents(period)
    const merkleRoots:{questId:string, merkleRoot:string, tokenTotal:string}[] = [];

    for(const quest of quests){
        let scoreAndBalance =  await generateMerkleScore(quest, voteEvents);
        let merkleTree = parseBalanceMap(scoreAndBalance.balance);
        merkleRoots.push({
            questId: quest.questID.toString(),
            merkleRoot: merkleTree.merkleRoot,
            tokenTotal: merkleTree.tokenTotal
        })
        try {
            fs.writeFileSync(`scripts/data/${quest.periodStart.toString()}/${quest.questID.toString()}_merkle_root.json`, JSON.stringify(merkleTree));
        } catch (err) {
            console.error(err);
        }
    }
    try {
        fs.writeFileSync(`scripts/data/${period.toString()}/${period.toString()}_quests_merkle_roots.json`, JSON.stringify(merkleRoots));
    } catch (err) {
        console.error(err);
    }
}


/**
 * Test
 */
const gmsTest = async () => {
    //await generateMerkleScoresForQuest("0")
    //await generateMerkleScoresForPeriod(BigNumber.from(1650499200))
    const period = BigNumber.from(1650499200);
    const quest = {
        questID:BigNumber.from("0x00"),
        creator: "0x26D756D057513a43b89735CBd581d5B6eD1b0711",
        gauge: "0x1cEBdB0856dd985fAe9b8fEa2262469360B8a3a6",
        rewardToken: "0xD533a949740bb3306d119CC777fa900bA034cd52",
        duration:BigNumber.from("0x08"),
        periodStart: BigNumber.from("0x62609e80"),
        objectiveVotes: BigNumber.from("0x108b2a2c28029094000000"),
        rewardPerVote: BigNumber.from("0x038d7ea4c68000"),
      }
    await generateMerkleScore(quest, await getVotesEvents(period));
}

gmsTest();

