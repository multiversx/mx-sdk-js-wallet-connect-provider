import QRCodeModal from "@walletconnect/qrcode-modal";
import { WalletConnectProvider } from "../../out/walletConnectProvider";
import { DummyTransaction } from "./dummyTransaction";

const bridgeUrl = "https://bridge.walletconnect.org";

export class MyApp {
    constructor() {
        this.provider = new WalletConnectProvider2();
    }

    async login() {
        // TBD
    }

    async signTransaction() {
        // TBD
    }

    async signTransactions() {
        // TBD
    }
}
