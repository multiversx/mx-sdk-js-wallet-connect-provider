import QRCodeModal from "@walletconnect/qrcode-modal";
import { WalletConnectProvider } from "../out/walletConnectProvider";

export async function main() {
    let bridge = "https://bridge.walletconnect.org";

    let callbacks = {
        onClientLogin: async function () {
            console.log("onClientLogin()");
            await provider.signTransaction(new DummyTransaction());
        },
        onClientLogout: async function () {
            console.log("onClientLogout()");
        }
    };

    let provider = new WalletConnectProvider(bridge, callbacks);
    await provider.init();
    let connectorUri = await provider.login();
    QRCodeModal.open(connectorUri);
}

function DummyTransaction() {
    this.getNonce = () => 0;
    this.getValue = () => "1";
    this.getReceiver = () => "erd1uv40ahysflse896x4ktnh6ecx43u7cmy9wnxnvcyp7deg299a4sq6vaywa";
    this.getData = () => "";
    this.getGasPrice = () => 1000000000;
    this.getGasLimit = () => 50000;
    this.getChainID = () => "T";
    this.getVersion = () => 1;

    this.applySignature = function(signature, signedBy) {
        console.log("DummyTransaction.applySignature()", signature.hex(), signedBy.bech32());
    }
}
