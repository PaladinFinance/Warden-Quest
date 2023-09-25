import { ethers } from "ethers";

require("dotenv").config();

const provider = new ethers.providers.JsonRpcProvider(process.env.FORK_URI);

const faster_maurice = async () => {
  const sevenDays = 7 * 24 * 60 * 60;

  await provider.send("evm_increaseTime", [sevenDays]);
};

faster_maurice();