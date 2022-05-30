export class DummyTransaction {
    constructor(nonce) {
        this.nonce = nonce;
        this.signature = "?";
        this.signedBy = "?";
    }

    getNonce() {
        return this.nonce;
    }

    getValue() {
        return "1000000000000000000";
    }

    getReceiver() {
        return "erd1uv40ahysflse896x4ktnh6ecx43u7cmy9wnxnvcyp7deg299a4sq6vaywa";
    }

    getData() {
        return "";
    }

    getGasPrice() {
        return 1000000000;
    }

    getGasLimit() {
        return 50000;
    }

    getChainID() {
        return "T";
    }

    getVersion() {
        return 1;
    }

    applySignature(signature, signedBy) {
        this.signature = signature.hex();
        this.signedBy = signedBy.bech32();
        console.log("DummyTransaction.applySignature()", this.signature, this.signedBy);
    }
}
