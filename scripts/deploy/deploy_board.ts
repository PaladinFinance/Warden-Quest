export { };
const hre = require("hardhat");

const ethers = hre.ethers;

const network = hre.network.name;

const {
    GAUGE_CONTROLLER
} = require('./utils/constant');

const {
    CHEST_ADDRESS
} = require('./utils/main_params');

async function main() {

    const deployer = (await hre.ethers.getSigners())[0];

    const QuestBoard = await ethers.getContractFactory("QuestBoard");

    console.log('Deploying QuestBoard  ...')

    const board = await QuestBoard.deploy(
        GAUGE_CONTROLLER,
        CHEST_ADDRESS
    )
    await board.deployed()

    console.log('QuestBoard : ', board.address)

    await board.deployTransaction.wait(15);


    await hre.run("verify:verify", {
        address: board.address,
        constructorArguments: [
            GAUGE_CONTROLLER,
            CHEST_ADDRESS
        ],
    });
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });