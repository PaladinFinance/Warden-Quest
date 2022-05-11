import { ethers } from "ethers";

export class DateUtils {
  static getTimestampBlock = async (reference: number, provider: ethers.providers.JsonRpcProvider): Promise<number> => {
    const currentBlock = await provider.getBlockNumber();

    let block = await provider.getBlock(currentBlock);

    let blockNumber = currentBlock;

    const averageBlockTime = 30;

    while (block.timestamp > reference) {
      let decreaseBlocks = Math.trunc((block.timestamp - reference) / averageBlockTime);

      if (decreaseBlocks < 1) break;

      blockNumber = blockNumber - decreaseBlocks;

      block = await provider.getBlock(blockNumber);
    }

    while (block.timestamp > reference) {
      blockNumber--;
      block = await provider.getBlock(blockNumber);
    }

    return blockNumber + 1;
  };

  static delay = (time: number) => {
    return new Promise((resolve) => setTimeout(resolve, time));
  };
}
