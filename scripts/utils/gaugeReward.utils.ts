import { BigNumber, ethers } from "ethers";
import { GAUGE_CONTROLLER_ADRESS, GAUGE_UTILS_ADRESS } from "../constants/gauge.constants";
import curveGaugeControllerABI from '../../abi/curveGaugeController.json'
import curveGaugeUtilsABI from "../../abi/curveGaugeUtils.json";
import votingEscrowABI from "../../abi/votingEscrow.json";
import { getLastEntryVotes, getVoteSlope } from "./gaugeVotes.utils";
import { Vote } from "../dto/vote";
import { DateUtils } from "./date.utils";
import * as dotenv from 'dotenv';

dotenv.config()
const provider = new ethers.providers.JsonRpcProvider(process.env.MAINNET_URI)

const getBanlances = async (votes:Vote[], period:BigNumber):Promise<BigNumber[]> => {
    const votingEscrow = "0x5f3b5DfEb7B28CDbD7FAba78963EE202a494e2A2";
    const votingEscrowContract:ethers.Contract = new ethers.Contract(votingEscrow, votingEscrowABI, provider);
    let balances:BigNumber[] = []

    await Promise.all(votes.map(async (vote:Vote) => {
        balances.push(await votingEscrowContract["balanceOfAt(address,uint256)"](vote.user, DateUtils.getTimestampBlock(period.toNumber(), provider)))
    }))

    return balances;
}

const getBiasPercents = async (gaugeAdress:string, listOfVotes:Vote[], period:BigNumber):Promise<BigNumber[]> => {

    const scanBlockNumber = await DateUtils.getTimestampBlock(period.toNumber(), provider);
    const gaugeController:ethers.Contract = new ethers.Contract(GAUGE_CONTROLLER_ADRESS, curveGaugeControllerABI, provider);
    const gaugeWeight = await gaugeController.points_weight(gaugeAdress, period)
    //const totalSlope = (await gaugeController.points_weight(gaugeAdress, period)).slope
    //const gaugeBias:BigNumber = (await gaugeController.points_weight(gaugeAdress, period)).bias;

    let biasPercents:BigNumber[] = [];
    let totalCalculate = BigNumber.from(0);

    //Get all votes slope and calculate the total
    await Promise.all(listOfVotes.map(async (vote:Vote) => {
        let userSlope = await gaugeController.vote_user_slopes(vote.user, gaugeAdress, {blockTag:scanBlockNumber});

        if(!userSlope.end.lt(period)){
            let userSlopePercent = userSlope.slope.mul(BigNumber.from(100)).div(gaugeWeight.slope);
            let biasUser = gaugeWeight.bias.mul(userSlopePercent);
            totalCalculate = totalCalculate.add(biasUser)
            biasPercents.push(biasUser);
        }
    }))
    console.log("Total : ",gaugeWeight.bias.toString(), " | totalCalculate : ", totalCalculate.toString(), " | Diff :", gaugeWeight.bias.sub(totalCalculate).toString())

    return biasPercents;
}

/**
 * test
 */
const test = async () => {
    const gaugeAdress = "0xF98450B5602fa59CC66e1379DFfB6FDDc724CfC4";
    
    const period = BigNumber.from(1639612800);
    const gaugeUtils:ethers.Contract = new ethers.Contract(GAUGE_UTILS_ADRESS, curveGaugeUtilsABI, provider);
    

    let rewards = await gaugeUtils.rewards_per_gauge(gaugeAdress);
    console.log(rewards)

    let lastEntryVote:Vote[] = await getLastEntryVotes(gaugeAdress, period);
    let test = await getBiasPercents(gaugeAdress, lastEntryVote, period);
}

test();