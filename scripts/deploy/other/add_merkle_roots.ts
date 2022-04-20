export { };
const hre = require("hardhat");
import { BigNumber } from "@ethersproject/bignumber";
import { IERC20 } from "../../../typechain/IERC20";
import { IERC20__factory } from "../../../typechain/factories/IERC20__factory";

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
    BOARD_ADDRESS
} = require(param_file_path);




const WEEK = BigNumber.from(86400 * 7)
const UNIT = ethers.utils.parseEther('1')

 
const closed_period = BigNumber.from('1650499200')


async function main() {

    const period_ts = closed_period.div(WEEK).mul(WEEK)

    let tx;

    const deployer = (await hre.ethers.getSigners())[0];

    const QuestBoard = await ethers.getContractFactory("QuestBoard");

    const board = QuestBoard.attach(BOARD_ADDRESS);

    console.log('Fetching Merkle Roots ...')

    let quest_ids: BigNumber[] = []
    let total_amounts: BigNumber[] = []
    let roots: String[] = []


    console.log('Adding Merkle Roots to the contracts ...')
    tx = await board.connect(deployer).addMultipleMerkleRoot(quest_ids, period_ts, total_amounts, roots)
    await tx.wait(10)

    console.log()
    console.log('Done !')

}

main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });