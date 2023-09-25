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
  BOARD_LIT_ADDRESS
} = require(param_file_path);




const WEEK = BigNumber.from(86400 * 7)
const UNIT = ethers.utils.parseEther('1')

// Quest params : 

//Quest 1
/*
const gauge_address = "0x13A227b851ed1274e205535b3CF1daF6e2bA1E5a"

const target_votes = ethers.utils.parseEther('65000')
const reward_per_vote = ethers.utils.parseEther('0.001')

const rewards_per_period = target_votes.mul(reward_per_vote).div(UNIT)

const duration = 8

const total_rewards_amount = rewards_per_period.mul(duration)
const total_fees = total_rewards_amount.mul(400).div(10000)

const token_address = "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984"
const minTokenAmount = ethers.utils.parseEther("0.0001")*/

//Quest 2

const gauge_address = "0x7a5252e430C58E527016B2cFF68641C8b8BE21B7"

const target_votes = ethers.utils.parseEther('15000')
const reward_per_vote = ethers.utils.parseEther('0.075')

const rewards_per_period = target_votes.mul(reward_per_vote).div(UNIT)

const duration = 8

const total_rewards_amount = rewards_per_period.mul(duration)
const total_fees = total_rewards_amount.mul(400).div(10000)

const token_address = "0x6B175474E89094C44Da98b954EedeAC495271d0F"
const minTokenAmount = ethers.utils.parseEther("0.005")



async function main() {

    let tx;

    const deployer = (await hre.ethers.getSigners())[0];

    const QuestBoard = await ethers.getContractFactory("QuestBoard");

    const board = QuestBoard.attach(BOARD_LIT_ADDRESS);
    const token = IERC20__factory.connect(token_address, hre.ethers.provider);

    /*console.log()
    console.log('Whitelisting token ...')
    tx = await board.connect(deployer).whitelistToken(token_address, minTokenAmount)
    await tx.wait(10)*/

    console.log()
    console.log('Approving QuestBoard ...')
    tx = await token.connect(deployer).approve(board.address, ethers.constants.MaxUint256)
    await tx.wait(10)

    console.log()
    console.log('Creating Quest ...')
    tx = await board.connect(deployer).createQuest(
        gauge_address,
        token_address,
        duration,
        target_votes,
        reward_per_vote,
        total_rewards_amount,
        total_fees
    )
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