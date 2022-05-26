import { BigNumber } from "ethers"

export interface Balance{
    [adress:string]:{
        questID:BigNumber,
        period:BigNumber,
        earning:string,
        bias:BigNumber,
        rewardPerVote:BigNumber
    }
}