import { BigNumber, ethers } from "ethers"
import { TO_MILISECOND, WEEK } from "../constants/gauge.constants"

export class DateUtils {

    static printTimeStamp = (timestamp:BigNumber) => {
        
        console.log( (new Date((timestamp.div(WEEK).mul(WEEK).toNumber()*TO_MILISECOND))).toString() )
    }

    static isThisWeek = (timestamp:BigNumber):boolean => {

        return (Date.now() - timestamp.div(WEEK).mul(WEEK).toNumber()*TO_MILISECOND)/(WEEK*TO_MILISECOND) < 1
    }

    static isAfterTimestamp = (timestamp:BigNumber, reference:BigNumber):boolean => {

        return !(timestamp.div(WEEK).mul(WEEK).sub(reference).isNegative())
    }

    static isBeforeTimestamp = (timestamp:BigNumber, reference:BigNumber):boolean => {

        return (timestamp.div(WEEK).mul(WEEK).sub(reference).isNegative() || (timestamp.div(WEEK).mul(WEEK).sub(reference).isZero()))
    }

    static getTimestampBlock = async (reference: number, provider: ethers.providers.JsonRpcProvider):Promise<number> => {

        const currentBlock = await provider.getBlockNumber()
    
        let block = await provider.getBlock(currentBlock)
    
        let blockNumber = currentBlock
        
        const averageBlockTime = 30
    
        while(block.timestamp > reference){
            let decreaseBlocks = Math.trunc((block.timestamp - reference) / averageBlockTime)
    
            if(decreaseBlocks < 1 ) break;
    
            blockNumber = blockNumber - decreaseBlocks
    
            block = await provider.getBlock(blockNumber)
        }
    
        while(block.timestamp > reference){
            blockNumber--
            block = await provider.getBlock(blockNumber)
        }

        return blockNumber+1
    
    }

}