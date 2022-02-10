import { BigNumber } from "ethers";

export interface Quest{
    questID:BigNumber;
    creator:string;
    gauge:string;
    rewardToken:string;
    duration:BigNumber;
    startPeriod:BigNumber;
    objectiveVotes:BigNumber;
    rewardPerVote:BigNumber;
}