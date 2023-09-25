export { };
const hre = require("hardhat");

const ethers = hre.ethers;

const network = hre.network.name;

const {
    GAUGE_CONTROLLER_LIT
} = require('./utils/constant');

const {
    CHEST_ADDRESS
} = require('./utils/main_params');

async function main() {

    const deployer = (await hre.ethers.getSigners())[0];

    const DarkQuestBoard = await ethers.getContractFactory("DarkQuestBoard");

    console.log('Deploying DarkQuestBoard - veLIT version  ...')

    const board = await DarkQuestBoard.deploy(
        GAUGE_CONTROLLER_LIT,
        CHEST_ADDRESS
    )
    await board.deployed()

    console.log('DarkQuestBoard : ', board.address)

    await board.deployTransaction.wait(15);


    await hre.run("verify:verify", {
        address: board.address,
        constructorArguments: [
            GAUGE_CONTROLLER_LIT,
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