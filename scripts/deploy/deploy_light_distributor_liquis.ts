export { };
const hre = require("hardhat");

const ethers = hre.ethers;

const network = hre.network.name;


const {
    LIGHT_BOARD_LIQUIS_ADDRESS
} = require('./utils/main_params');

async function main() {

    const deployer = (await hre.ethers.getSigners())[0];

    const MultiMerkleDistributor = await ethers.getContractFactory("MultiMerkleDistributor");
    console.log('Deploying Light Distributor  ...')

    const distributor = await MultiMerkleDistributor.deploy(
        LIGHT_BOARD_LIQUIS_ADDRESS
    )
    await distributor.deployed()

    console.log('Light Distributor : ', distributor.address)

    await distributor.deployTransaction.wait(15);


    await hre.run("verify:verify", {
        address: distributor.address,
        constructorArguments: [
            LIGHT_BOARD_LIQUIS_ADDRESS
        ],
    });
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });