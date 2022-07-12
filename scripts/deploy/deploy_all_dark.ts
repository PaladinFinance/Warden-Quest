export { };
const hre = require("hardhat");

const ethers = hre.ethers;

const network = hre.network.name;

const { 
    GAUGE_CONTROLLER
} = require('./utils/constant');

const params_path = () => {
    if (network === 'fork') {
      return './utils/fork_params'
    }
    else {
      return './utils/main_params'
    }
}

const param_file_path = params_path();

const {
    CHEST_ADDRESS
} = require(param_file_path);

async function main() {

    const deployer = (await hre.ethers.getSigners())[0];

    const QuestBoard = await ethers.getContractFactory("DarkQuestBoard");
    const MultiMerkleDistributor = await ethers.getContractFactory("MultiMerkleDistributor");

    console.log()
    console.log('Deploying DarkQuestBoard  ...')

    const board = await QuestBoard.deploy(
        GAUGE_CONTROLLER,
        CHEST_ADDRESS
    )
    await board.deployed()

    console.log('DarkQuestBoard : ', board.address)

    await board.deployTransaction.wait(15);

    console.log()
    console.log('Deploying Distributor  ...')

    const distributor = await MultiMerkleDistributor.deploy(
        board.address
    )
    await distributor.deployed()

    console.log('Distributor : ', distributor.address)

    await distributor.deployTransaction.wait(15);

    console.log()
    console.log('Initiate Distributor  ...')

    let tx;

    tx = await board.connect(deployer).initiateDistributor(distributor.address)
    await tx.wait(10)

    console.log()
    console.log('Approve Manager  ...')

    tx = await board.connect(deployer).approveManager(deployer.address)
    await tx.wait(10)
    /*tx = await chest.connect(deployer).approveManager(deployer.address)
    await tx.wait(10)*/


    if(network === 'mainnet') {
        await hre.run("verify:verify", {
            address: distributor.address,
            constructorArguments: [
                board.address
            ],
        });

        await hre.run("verify:verify", {
            address: board.address,
            constructorArguments: [
                GAUGE_CONTROLLER,
                CHEST_ADDRESS
            ],
        });
    }
}

main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });