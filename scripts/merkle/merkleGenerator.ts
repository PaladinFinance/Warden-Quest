
import { BigNumber, ethers } from "ethers";
import { Vote } from "../dto/vote";
import { getVotesEvents, getVotesForGauge } from "../utils/gaugeVotes.utils";
import * as fs from 'fs';
import { getQuestFromId, getQuestsFromPeriod } from "../utils/quests.utils";
import { Quest } from "../dto/quest";
import { Score } from "../dto/score";
import { DateUtils } from "../utils/date.utils";
import { Balance } from "../dto/balance";
import { parseBalanceMap } from "./src/parse-balance-map";


const generateMerkleScore = async (quest: Quest, votesEvents:ethers.utils.LogDescription[]) => {
    console.log('Start merkle for ', quest.questID.toString())
    let listOfVotes:Vote[] = await getVotesForGauge(votesEvents, quest.gauge, quest.startPeriod);
    let score:Score = {}
    let balance:Balance = {}
    let totalBias:BigNumber = BigNumber.from(0);

    for(let vote of listOfVotes){
        if(totalBias.gt(quest.objectiveVotes)) break;
        totalBias = totalBias.add(vote.bias);
        let voteBias = totalBias.gt(quest.objectiveVotes) ? vote.bias.sub(totalBias.sub(quest.objectiveVotes)) : vote.bias;
        let voteReward = voteBias.mul(quest.rewardPerVote)
        score[vote.user] = {
            time: vote.time.toString(),
            bias: voteBias.toString(),
            reward: voteReward.toString()
        }
        balance[vote.user] = {
            questID:quest.questID,
            period:quest.startPeriod,
            earning:voteReward.toString()
        }
    }

    try{
        console.log("Writing files for ", quest.questID.toString())
        let dir = `scripts/data/${quest.startPeriod.toString()}`
        if(!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true })
        };
        fs.writeFileSync(dir.concat(`/${quest.questID.toString()}_scores.json`), JSON.stringify(score))
        fs.writeFileSync(dir.concat(`/${quest.questID.toString()}_balance.json`), JSON.stringify(balance))
        
    }catch(err){
        console.error(err);
    }
    console.log("Waiting one minute..")
    await DateUtils.delay(60*1000)
    return {score:score, balance:balance}
}
export const generateMerkleScoresForQuest = async (questId:string) => {
    
    const quest:Quest = await getQuestFromId(questId);
    const voteEvents = await getVotesEvents(quest.startPeriod)
    
    await generateMerkleScore(quest, voteEvents)
}

export const generateMerkleScoresForPeriod = async (period:BigNumber) => {
    
    const quests = await getQuestsFromPeriod(period);
    const voteEvents = await getVotesEvents(period)
    const merkleRoots:{questId:string, merkleRoot:string}[] = [];

    for(const quest of quests){
        let scoreAndBalance =  await generateMerkleScore(quest, voteEvents);
        let merkleTree = parseBalanceMap(scoreAndBalance.balance);
        merkleRoots.push({
            questId: quest.questID.toString(),
            merkleRoot: merkleTree.merkleRoot
        })
        try {
            fs.writeFileSync(`scripts/data/${quest.startPeriod.toString()}/${quest.questID.toString()}_merkle_root.json`, JSON.stringify(merkleTree));
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
    await generateMerkleScoresForPeriod(BigNumber.from(1639612800))
}

gmsTest();

