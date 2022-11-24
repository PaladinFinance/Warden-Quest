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
  BOARD_ANGLE_ADDRESS
} = require(param_file_path);




const WEEK = BigNumber.from(86400 * 7)
const UNIT = ethers.utils.parseEther('1')

// Tokens params : 

const token_list = [
    "0x6B175474E89094C44Da98b954EedeAC495271d0F",
    "0x31429d1856aD1377A8A0079410B297e1a9e214c2",
]
const minTokenAmounts = [
    ethers.utils.parseEther("0.0001"),
    ethers.utils.parseEther("0.000025"),
]



async function main() {

    let tx;

    const deployer = (await hre.ethers.getSigners())[0];

    const QuestBoard = await ethers.getContractFactory("QuestBoard");

    const board = QuestBoard.attach(BOARD_ANGLE_ADDRESS);

    console.log()
    console.log('Whitelisting tokens ...')
    tx = await board.connect(deployer).whitelistMultipleTokens(token_list, minTokenAmounts)
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