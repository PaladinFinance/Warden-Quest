export { };
const hre = require("hardhat");

const ethers = hre.ethers;

const network = hre.network.name;


const {
    DARK_BOARD_BALANCER_ADDRESS
} = require('./utils/main_params');

async function main() {

    const deployer = (await hre.ethers.getSigners())[0];

    const MultiMerkleDistributor = await ethers.getContractFactory("MultiMerkleDistributor");
    console.log('Deploying Dark Distributor  ...')

    const distributor = await MultiMerkleDistributor.deploy(
        DARK_BOARD_BALANCER_ADDRESS
    )
    await distributor.deployed()

    console.log('Dark Distributor : ', distributor.address)

    await distributor.deployTransaction.wait(15);


    await hre.run("verify:verify", {
        address: distributor.address,
        constructorArguments: [
            DARK_BOARD_BALANCER_ADDRESS
        ],
    });
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });