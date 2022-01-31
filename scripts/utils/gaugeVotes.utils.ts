import { BigNumber, ethers } from "ethers";
import { Interface } from "ethers/lib/utils";
import curveGaugeControllerABI from '../../abi/curveGaugeController.json'
import { GAUGE_CONTROLLER_ADRESS, TO_MILISECOND} from "../constants/gauge.constants";
import { Vote } from "../dto/vote";
import { VoteMapper } from "../mappers/vote.mapper";
import { DateUtils } from "./date.utils";
import { Display } from "./display.utils";
import * as dotenv from 'dotenv';

dotenv.config()
const provider = new ethers.providers.JsonRpcProvider(process.env.MAINNET_URI)

const getGaugeVotes = async (gaugeAdress:string, reference:BigNumber):Promise<Map<string,Vote[]>> => {
    
    //Get the contract of the gauge controller
    console.log("Getting votes for gauge with adress ",gaugeAdress)

    const iGaugeController = new Interface(curveGaugeControllerABI);
    const voteForGaugeTopic = iGaugeController.getEventTopic("VoteForGauge");
    

    //Get the events of voting
    const filter = {
        fromBlock: 0,
        toBlock: 14074070,
        topics: [voteForGaugeTopic]
      };
    const logs = await provider.getLogs(filter);
    const gaugeControllerVote: ethers.utils.LogDescription[] = 
        logs
        .filter((log) => {
            return (log.address.toLowerCase() === GAUGE_CONTROLLER_ADRESS.toLowerCase()
            && log.topics.indexOf(voteForGaugeTopic) >= 0)
        })
        .map((log) => {
            return iGaugeController.parseLog(log)
        })

    //Only get the votes on the wanted gauge address
    let listOfVotesByUsers= new Map<string, Vote[]>();
    gaugeControllerVote.forEach((rawVote: ethers.utils.LogDescription) => {
        if(!!rawVote.args){
            const vote:Vote = VoteMapper.rawVoteToVote(rawVote.args); 
            if(vote.gaugeAdress === gaugeAdress && vote.time.lt(reference)){
                if(!listOfVotesByUsers.has(vote.user)){
                    listOfVotesByUsers.set(vote.user, [vote])
                }else{
                    listOfVotesByUsers.get(vote.user)?.push(vote);
                }
            }
        }
    })

    return listOfVotesByUsers;
}

export const getLastEntryVotes = async (gaugeAdress:string, reference:BigNumber):Promise<Vote[]> => {

    const listOfEntryVotes:Vote[] = [];
    let listOfVotesByUsers:Map<string, Vote[]> = await getGaugeVotes(gaugeAdress, reference);

    //Get the oldest vote for the gauge
    listOfVotesByUsers.forEach((votes:Vote[], user:string) => {
        
        votes.sort((a:Vote, b:Vote) => b.time.sub(a.time).toNumber());

        if(!votes[0].weight.isZero()){
            const firstEntryIndex = votes.findIndex((vote:Vote) => vote.weight.isZero())
            const firstVote = votes[firstEntryIndex !== -1 ? firstEntryIndex-1 : votes.length-1];
            listOfEntryVotes.push(firstVote)
        }
    })
    
    return listOfEntryVotes
}
export const getVoteSlope = async (gaugeAdress:string, reference:BigNumber, listOfVotes:Vote[]):Promise<Vote[]> => {

    const scanBlockNumber = await DateUtils.getTimestampBlock(reference.toNumber(), provider);
    const gaugeController:ethers.Contract = new ethers.Contract(GAUGE_CONTROLLER_ADRESS, curveGaugeControllerABI, provider);

    let countForSlopeVote:Vote[] = [];

    //Get all votes slope and calculate the total
    await Promise.all(listOfVotes.map(async (vote:Vote) => {
            let userSlope = await gaugeController.vote_user_slopes(vote.user, gaugeAdress, {blockTag:scanBlockNumber});

            if(!userSlope.end.lt(reference)){
                countForSlopeVote.push(vote)
            }
    }))

    return countForSlopeVote;
}

export const getTotalVoteSlope = async (gaugeAdress:string, reference:BigNumber, listOfVotes:Vote[]):Promise<BigNumber> => {

    const scanBlockNumber = await DateUtils.getTimestampBlock(reference.toNumber(), provider);
    const gaugeController:ethers.Contract = new ethers.Contract(GAUGE_CONTROLLER_ADRESS, curveGaugeControllerABI, provider);

    //let totalSlope = (await gaugeController.points_weight(gaugeAdress, reference)).slope
    let totalVoteSlope = BigNumber.from(0);

    //Get all votes slope and calculate the total
    await Promise.all(listOfVotes.map(async (vote:Vote) => {
            let userSlope = await gaugeController.vote_user_slopes(vote.user, gaugeAdress, {blockTag:scanBlockNumber});

            if(!userSlope.end.lt(reference)){
                totalVoteSlope = totalVoteSlope.add(userSlope.slope);
            }
    }))

    console.log(" Total vote slope : ", Display.displayBigNumber(totalVoteSlope))

    return totalVoteSlope;
}


/*
 * Tests  
 */

const test = async () => {
    const gaugeAdress = "0xF98450B5602fa59CC66e1379DFfB6FDDc724CfC4";
    const period = BigNumber.from(1639612800);
    const start = Date.now();
    let listOfVotes:Vote[] = [];
    
    listOfVotes = await getLastEntryVotes(gaugeAdress, period);
    console.log("Duration :",(Date.now()-start)/TO_MILISECOND,"sec")
    console.log("votes dates :")
    listOfVotes.forEach((vote:Vote) => {
        DateUtils.printTimeStamp(vote.time)
    })
    
    await getTotalVoteSlope(gaugeAdress, period,  listOfVotes);
    
}

//test();
