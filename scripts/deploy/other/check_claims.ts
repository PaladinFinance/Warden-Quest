export { };
const hre = require("hardhat");
import { BigNumber } from "@ethersproject/bignumber";

const ethers = hre.ethers;

const network = hre.network.name;

const params_path = () => {
  if (network === 'fork') {
    return '../utils/fork_params'
  }
  else {
    return '../utils/main_params'
  }
}

const param_file_path = params_path();

const { 
    DISTRIBUTOR_ADDRESS
} = require(param_file_path);




const WEEK = BigNumber.from(86400 * 7)
const UNIT = ethers.utils.parseEther('1')

 
const period_to_check = BigNumber.from('1652313600')

const quest_id = BigNumber.from('1')

async function main() {

    const period_ts = period_to_check.div(WEEK).mul(WEEK)

    const Distributor = await ethers.getContractFactory("MultiMerkleDistributor");

    const distributor = Distributor.attach(DISTRIBUTOR_ADDRESS);

    console.log('Check Claims ...')

    
    for(let i = 0; i < 100; i++){
        
        const result = await distributor.isClaimed(quest_id, period_ts, BigNumber.from(i))

        console.log("Index", i, " => claimed :", result)
    }

}

main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });