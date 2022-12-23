import { task } from 'hardhat/config';
import { IERC20 } from "../../typechain/IERC20";
import { IERC20__factory } from "../../typechain/factories/IERC20__factory";

require("dotenv").config();

task('fork-get-all-ERC20', 'Steal ERC20 amount from holder to send to receiver on the Fork')
    .addPositionalParam(
        'receiver',
        'User address'
    )
    .setAction(async ({receiver, amount, token, holder}, hre) => {

        const token_list = [
            /*{
                address: "0xba100000625a3754423978a60c9317c58a424e3D", //BAL
                amount: "1250000",
                holder: "0xF977814e90dA44bFA03b6295A0616a897441aceC"
            },
            {
                address: "0xba100000625a3754423978a60c9317c58a424e3D", //BAL
                amount: "250000",
                holder: "0xF977814e90dA44bFA03b6295A0616a897441aceC"
            },*/
            {
                address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", //DAI
                amount: "250000000",
                holder: "0x075e72a5eDf65F0A5f44699c7654C1a76941Ddc8"
            },
            /*{
                address: "0xD533a949740bb3306d119CC777fa900bA034cd52", //CRV
                amount: "5000000",
                holder: "0x32D03DB62e464c9168e41028FFa6E9a05D8C6451"
            },
            /*{
                address: "0xdBdb4d16EdA451D0503b854CF79D55697F90c8DF", //ALCX
                amount: "450000",
                holder: "0x000000000000000000000000000000000000dead"
            },
            {
                address: "0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32", //LDO
                amount: "3500000",
                holder: "0xad4f7415407b83a081a0bee22d05a8fdc18b42da"
            },*/
            {
                address: "0x31429d1856aD1377A8A0079410B297e1a9e214c2", //ANGLE
                amount: "10000000",
                holder: "0x2fc443960971e53fd6223806f0114d5faa8c7c4e"
            },/*
            {
                address: "0x41D5D79431A913C4aE7d69a668ecdfE5fF9DFB68", //INV
                amount: "2500",
                holder: "0xdae6951fb927f40d76da0ef1d5a1a9bee8af944b"
            },
            {
                address: "0xCdF7028ceAB81fA0C6971208e83fa7872994beE5", //T
                amount: "300000000",
                holder: "0xf977814e90da44bfa03b6295a0616a897441acec"
            },
            {
                address: "0x3432B6A60D23Ca0dFCa7761B7ab56459D9C964D0", //FXS
                amount: "1500000",
                holder: "0xf977814e90da44bfa03b6295a0616a897441acec"
            },
            {
                address: "0x2e9d63788249371f1DFC918a52f8d799F4a38C94", //TOKE
                amount: "350000",
                holder: "0x23a5efe19aa966388e132077d733672cf5798c03"
            },*/
        ]

        if (hre.network.name != 'fork') {
            console.log('Wrong network - Connect to Fork')
            process.exit(1)
        }

        hre.ethers.provider = new hre.ethers.providers.JsonRpcProvider(process.env.FORK_URI)

        const getERC20 = async (token: string, amount: string, holder: string) => {

            const ERC20 = IERC20__factory.connect(token, hre.ethers.provider);


            console.log("Token", token)
            console.log("Sending", amount, " tokens to", receiver)
        
            await hre.network.provider.request({
                method: "hardhat_setBalance",
                params: [holder, hre.ethers.utils.parseEther("50000000").toHexString()],
            });

            await hre.network.provider.request({
                method: "hardhat_impersonateAccount",
                params: [holder],
            });
            const signer = await hre.ethers.getSigner(holder)
        
            await ERC20.connect(signer).transfer(receiver, hre.ethers.utils.parseEther(amount));
        
            await hre.network.provider.request({
                method: "hardhat_stopImpersonatingAccount",
                params: [holder],
            });

        }

        for(let t of token_list){
            await getERC20(t.address, t.amount, t.holder)

            console.log()
        }


    })