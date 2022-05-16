export { };
const hre = require("hardhat");

const ethers = hre.ethers;

const network = hre.network.name;


async function main() {

    const deployer = (await hre.ethers.getSigners())[0];

    const QuestTreasureChest = await ethers.getContractFactory("QuestTreasureChest");

    console.log('Deploying TresaureChest  ...')

    const chest = await QuestTreasureChest.deploy()
    await chest.deployed()

    console.log('TreasureChest : ', chest.address)

    await chest.deployTransaction.wait(15);


    await hre.run("verify:verify", {
        address: chest.address,
        constructorArguments: [],
    });
}

main()
    .then(() => process.exit(0))
    .catch(error => {
      console.error(error);
      process.exit(1);
    });