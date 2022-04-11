import { BigNumber } from "ethers";
import merkleBalance from "../scripts/data/1639612800/0_balance.json" ;

const getTotal = () => {
    const values = Object.values(merkleBalance);
    let total = BigNumber.from(0);
    values.forEach((value:string) => {
        total = total.add(BigNumber.from(value))
    })
    console.log(total)
    
}

getTotal();