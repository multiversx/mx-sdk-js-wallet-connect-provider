import QRCodeModal from "@walletconnect/qrcode-modal";
import { WalletConnectProvider } from "../out/walletConnectProvider";

const BridgeUrl = "https://bridge.walletconnect.org";

export class MyApp {
    constructor() {
        let callbacks = {
            onClientLogin: async function () {
                alert("onClientLogin()");
            },
            onClientLogout: async function () {
                alert("onClientLogout()");
            }
        };

        this.provider = new WalletConnectProvider(BridgeUrl, callbacks);
    }

    async login() {
        await this.provider.init();
        let connectorUri = await this.provider.login();
        QRCodeModal.open(connectorUri);
    }

    async sign() {
        let transaction = await this.provider.signTransaction(new DummyTransaction());
        alert(`Transaction signature = ${transaction.signature}.`);
    }
}

function DummyTransaction() {
    this.getNonce = () => 0;
    this.getValue = () => "1000000000000000000";
    this.getReceiver = () => "erd1uv40ahysflse896x4ktnh6ecx43u7cmy9wnxnvcyp7deg299a4sq6vaywa";
    this.getData = () => "";
    this.getGasPrice = () => 1000000000;
    this.getGasLimit = () => 50000;
    this.getChainID = () => "T";
    this.getVersion = () => 1;
    this.signature = "?";
    this.signedBy = "?";

    this.applySignature = function(signature, signedBy) {
        this.signature = signature.hex();
        this.signedBy = signedBy.bech32();
        console.log("DummyTransaction.applySignature()", this.signature, this.signedBy);
    }
}
