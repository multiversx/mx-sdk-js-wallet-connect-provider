# Elrond SDK for JavaScript: Wallet Connect provider

Signing provider for dApps: Wallet Connect. 

## Distribution

[npm](https://www.npmjs.com/package/@elrondnetwork/erdjs-wallet-connect-provider)

## Installation

`erdjs-wallet-connect-provider` is delivered via [npm](https://www.npmjs.com/package/@elrondnetwork/erdjs-wallet-connect-provider), therefore it can be installed as follows:

```
npm install @elrondnetwork/erdjs-wallet-connect-provider
```

### Building the library

In order to compile the library, run the following:

```
npm install
npm run compile
```

### Usage example

```
const bridgeUrl = "https://bridge.walletconnect.org";

export class MyApp {
    constructor() {
        const callbacks = {
            onClientLogin: async function () {
                alert("onClientLogin()");
            },
            onClientLogout: async function () {
                alert("onClientLogout()");
            }
        };

        this.provider = new WalletConnectProvider(bridgeUrl, callbacks);
    }

    async login() {
        await this.provider.init();
        let connectorUri = await this.provider.login();
        QRCodeModal.open(connectorUri);
    }

    async signTransaction() {
        const transaction = new DummyTransaction(1);
        await this.provider.signTransaction(transaction);
        alert(`Signature = ${transaction.signature}.`);
    }

    async signTransactions() {
        const transactions = [new DummyTransaction(2), new DummyTransaction(3)];
        await this.provider.signTransactions(transactions);
        const signatures = transactions.map(transaction => transaction.signature);
        alert(`Signatures = ${JSON.stringify(signatures, null, 4)}.`);
    }
}
```