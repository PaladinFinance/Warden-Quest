export { };
const hre = require("hardhat");

const ethers = hre.ethers;

const network = hre.network.name;


async function main() {

    const deployer = (await hre.ethers.getSigners())[0];

    const ROOT_MANAGER = "0x2F793E40CF7473A371A3E6f3d3682F81070D3041" // Quest manager

    const ExtraRewardsMultiMerkle = await ethers.getContractFactory("ExtraRewardsMultiMerkle");
    console.log('Deploying Extra Rewards Distributor  ...')

    const distributor = await ExtraRewardsMultiMerkle.deploy(
        ROOT_MANAGER
    )
    await distributor.deployed()

    console.log('Extra Rewards Distributor : ', distributor.address)

    await distributor.deployTransaction.wait(15);


    await hre.run("verify:verify", {
        address: distributor.address,
        constructorArguments: [
            ROOT_MANAGER
        ],
    });
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });