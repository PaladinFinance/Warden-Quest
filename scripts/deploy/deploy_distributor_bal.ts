export { };
const hre = require("hardhat");

const ethers = hre.ethers;

const network = hre.network.name;


const {
    BOARD_BAL_ADDRESS
} = require('./utils/main_params');

async function main() {

    const deployer = (await hre.ethers.getSigners())[0];

    const MultiMerkleDistributor = await ethers.getContractFactory("MultiMerkleDistributor");
    console.log('Deploying Distributor - veBAL version  ...')

    const distributor = await MultiMerkleDistributor.deploy(
        BOARD_BAL_ADDRESS
    )
    await distributor.deployed()

    console.log('Distributor : ', distributor.address)

    await distributor.deployTransaction.wait(15);


    await hre.run("verify:verify", {
        address: distributor.address,
        constructorArguments: [
            BOARD_BAL_ADDRESS
        ],
    });
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });