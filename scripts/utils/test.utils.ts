import { BigNumber, ethers } from "ethers";
import { Interface } from "ethers/lib/utils";
import curveGaugeControllerABI from '../../abi/curveGaugeController.json'
import { DateUtils } from "./date.utils";

const provider = new ethers.providers.JsonRpcProvider("http://164.132.55.131:8546/")
export const GAUGE_CONTROLLER_ADRESS = "0x2F50D538606Fa9EDD2B11E2446BEb18C9D5846bB";

export const getGauges = async (reference:BigNumber) => {
    const iGaugeController = new Interface(curveGaugeControllerABI);
    const voteForGaugeTopic = iGaugeController.getEventTopic("NewGauge");
    const scanBlockNumber = await DateUtils.getTimestampBlock(reference.toNumber(), provider);
    

    //Get the events of voting
    const filter = {
        fromBlock: 0,
        toBlock: scanBlockNumber,
        topics: [voteForGaugeTopic]
      };
    const logs = await provider.getLogs(filter);
    const gauges: ethers.utils.LogDescription[] = 
        logs
        .filter((log) => {
            return (log.removed === false)
        }).map((log) => {
            return iGaugeController.parseLog(log)
        })

    return gauges;
}

const test = async () => {
    //getGauges(BigNumber.from('1646870400'))
    const sevenDays = 7 * 24 * 60 * 60;
    await provider.send('evm_increaseTime', [sevenDays]);
}

test();