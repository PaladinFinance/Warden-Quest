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

 
const closed_period = BigNumber.from('1652313600')

const quest_id = BigNumber.from('1')


async function main() {

    const period_ts = closed_period.div(WEEK).mul(WEEK)

    const merkleRoots_file_path = "../../data/" + period_ts.toString() + "/" + period_ts.toString() + "_quests_merkle_roots.json"

    const quest_roots = require(merkleRoots_file_path)

    let tx;

    const deployer = (await hre.ethers.getSigners())[0];

    const Distributor = await ethers.getContractFactory("MultiMerkleDistributor");

    const distributor = Distributor.attach(DISTRIBUTOR_ADDRESS);

    console.log('Fetching new Merkle Root ...')

    let total_amount = quest_roots[quest_id.toNumber()].tokenTotal
    let root = quest_roots[quest_id.toNumber()].merkleRoot

    console.log(total_amount)
    console.log()
    console.log(await distributor.questRewardsPerPeriod(quest_id, period_ts))

    console.log('Updating the root ...')
    tx = await distributor.connect(deployer).emergencyUpdateQuestPeriod(quest_id, period_ts, total_amount, root)
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