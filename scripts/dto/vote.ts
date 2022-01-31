import { BigNumber } from "ethers";

export interface Vote {
    gaugeAdress: string;
    user: string;
    time: BigNumber;
    weight: BigNumber;
}