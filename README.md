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

### Usage example for WalletConnect V2

```
const chainId = "T"; // "T", "D" or "1"
const walletConnectV2ProjectId = "..."; // Get a free Project Id from https://cloud.walletconnect.com/app
const walletConnectV2Relay = "wss://relay.walletconnect.com"; // Default Relay Server

export class MyApp {
  constructor() {
    const callbacks = {
      onClientLogin: async function () {
        alert("onClientLogin()");
        QRCodeModal.close();
      },
      onClientLogout: async function () {
        alert("onClientLogout()");
      },
    };

    this.provider = new WalletConnectProviderV2(
      callbacks,
      chainId,
      walletConnectV2Relay,
      walletConnectV2ProjectId
    );
  }

  async login() {
    if (!this.provider.isInitialized()) {
      await this.provider.init();
    }
    let { uri, approval } = await this.provider.connect();
    if (uri) {
      QRCodeModal.open(uri);
    }
    try {
      await this.provider.login({ approval });
    } catch (e) {
      QRCodeModal.close();
    }
  }

  async signTransaction() {
    const transaction = new DummyTransaction(1);
    await this.provider.signTransaction(transaction);
    alert(`Signature = ${transaction.signature}.`);
  }

  async signTransactions() {
    const transactions = [new DummyTransaction(2), new DummyTransaction(3)];
    await this.provider.signTransactions(transactions);
    const signatures = transactions.map((transaction) => transaction.signature);
    alert(`Signatures = ${JSON.stringify(signatures, null, 4)}.`);
  }

  async signMessages() {
    const message = new DummyMessage({
      message: Buffer.from("hello"),
    });

    await this.provider.signMessage(message);
    console.log("Message, upon signing:", message);

    alert(`Signature: ${message.signature}`);
  }
}
```
