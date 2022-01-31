import { BigNumber } from "ethers"

export class Display {

    static displayBigNumber = (num:BigNumber) => {
        let values = num.toString().split(".")
        values[0] = values[0].split("").reverse().map((digit, index) =>
            index != 0 && index % 3 === 0 ? `${digit},` : digit
        ).reverse().join("")
        return values.join(".")
    }
    
}
