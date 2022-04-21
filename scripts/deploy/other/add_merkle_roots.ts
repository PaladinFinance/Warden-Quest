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
    BOARD_ADDRESS, DISTRIBUTOR_ADDRESS
} = require(param_file_path);




const WEEK = BigNumber.from(86400 * 7)
const UNIT = ethers.utils.parseEther('1')

 
const closed_period = BigNumber.from('1651104000')


async function main() {

    const period_ts = closed_period.div(WEEK).mul(WEEK)

    const merkleRoots_file_path = "../../data/" + period_ts.toString() + "/" + period_ts.toString() + "_quests_merkle_roots.json"

    const quest_roots = require(merkleRoots_file_path)

    let tx;

    const deployer = (await hre.ethers.getSigners())[0];

    const QuestBoard = await ethers.getContractFactory("QuestBoard");

    const board = QuestBoard.attach(BOARD_ADDRESS);

    const Distributor = await ethers.getContractFactory("MultiMerkleDistributor");

    const distributor = Distributor.attach(DISTRIBUTOR_ADDRESS);

    console.log('Fetching Merkle Roots ...')

    let quest_ids: BigNumber[] = []
    let total_amounts: BigNumber[] = []
    let roots: String[] = []

    for(let i = 0; i < quest_roots.length; i++){
        quest_ids[i] = quest_roots[i].questId
        roots[i] = quest_roots[i].merkleRoot
        total_amounts[i] = BigNumber.from(quest_roots[i].tokenTotal)
    }

    console.log(total_amounts)
    console.log()
    console.log(await distributor.questRewardsPerPeriod(quest_ids[0], period_ts))
    console.log(await distributor.questRewardsPerPeriod(quest_ids[1], period_ts))
    console.log(await distributor.questRewardsPerPeriod(quest_ids[2], period_ts))

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