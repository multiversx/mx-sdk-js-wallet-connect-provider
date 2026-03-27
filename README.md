# mx-sdk-js-wallet-connect-provider

Signing provider for dApps: WalletConnect.

Documentation is available on [docs.multiversx.com](https://docs.multiversx.com/sdk-and-tools/sdk-js/sdk-js-signing-providers/#the-wallet-connect-provider), while an integration example can be found [here](https://github.com/multiversx/mx-sdk-js-examples/tree/main/signing-providers).

Note that **we recommend using [sdk-dapp](https://github.com/multiversx/mx-sdk-dapp)** instead of integrating the signing provider on your own.

You can check out the integration with `sdk-dapp` in the [Template dApp](https://github.com/multiversx/mx-template-dapp) repository with a live example [here](https://devnet.template-dapp.multiversx.com).

## Distribution

[npm](https://www.npmjs.com/package/@multiversx/sdk-wallet-connect-provider)

## Installation

`sdk-wallet-connect-provider` is delivered via [npm](https://www.npmjs.com/package/@multiversx/sdk-wallet-connect-provider), therefore it can be installed as follows:

```bash
npm install @multiversx/sdk-wallet-connect-provider
```

### Building the library

In order to compile the library, run the following:

```bash
npm install
npm run compile
```

## Project ID

The WalletConnect 2.0 Signing Provider can use the [WalletConnect Cloud Relay](https://docs.walletconnect.com/2.0/cloud/relay) default address: `wss://relay.walletconnect.com`, in order to be able to access the Cloud Relay you will need to generate a Project ID

The Project ID can be generated for free here: [https://cloud.walletconnect.com/sign-in](https://cloud.walletconnect.com/sign-in)

The WalletConnect Project ID grants you access to the WalletConnect Cloud Relay that securely manages communication between the device and the dApp.

## Usage Examples

For this example we will use the WalletConnect 2.0 provider since 1.0 is [deprecated](https://medium.com/walletconnect/weve-reset-the-clock-on-the-walletconnect-v1-0-shutdown-now-scheduled-for-june-28-2023-ead2d953b595)

First, let's see a (simple) way to build a QR dialog using [`qrcode`](https://www.npmjs.com/package/qrcode) (and bootstrap):



### Disconnect Example

When you want to close the WalletConnect session and clear all active connections:

```ts
import { WalletConnectProvider } from "@multiversx/sdk-wallet-connect-provider";

async function disconnectWallet(provider: WalletConnectProvider) {
  try {
    await provider.disconnect();
    console.log("Wallet disconnected successfully");
  } catch (error) {
    console.error("Error disconnecting wallet:", error);
  }
}
```

You can also listen for the `disconnect` event to handle UI updates:

```ts
provider.on("disconnect", () => {
  console.log("Session terminated");
});
```

```js
import QRCode from "qrcode";

async function openModal(connectorUri) {
  const svg = await QRCode.toString(connectorUri, { type: "svg" });

  // The referenced elements must be added to your page, in advance
  $("#MyWalletConnectQRContainer").html(svg);
  $("#MyWalletConnectModal").modal("show");
}

function closeModal() {
  $("#MyWalletConnectModal").modal("hide");
}
```

In order to create an instance of the provider, do as follows:

```js
import { WalletConnectV2Provider } from "@multiversx/sdk-wallet-connect-provider";

// Generate your own WalletConnect 2 ProjectId here:
// https://cloud.walletconnect.com/app
const projectId = "9b1a9564f91cb6...";
// The default WalletConnect V2 Cloud Relay
const relayUrl = "wss://relay.walletconnect.com";
// T for Testnet, D for Devnet and 1 for Mainnet
const chainId = "T";

const callbacks = {
  onClientLogin: async function () {
    // closeModal() is defined above
    closeModal();
    const address = await provider.getAddress();
    console.log("Address:", address);
  },
  onClientLogout: async function () {
    console.log("onClientLogout()");
  },
  onClientEvent: async function (event) {
    console.log("onClientEvent()", event);
  },
};

const provider = new WalletConnectProvider(
  callbacks,
  chainId,
  relayUrl,
  projectId
);
```

> You can customize the Core WalletConnect functionality by passing `WalletConnectProvider` an optional 5th parameter: `options`
> For example `metadata` and `storage` for [React Native](https://docs.walletconnect.com/2.0/javascript/guides/react-native) or `{ logger: 'debug' }` for a detailed under the hood logging

Before performing any operation, make sure to initialize the provider:

```js
await provider.init();
```

### Login and logout

Then, ask the user to login using xPortal on her phone:

```js
const { uri, approval } = await provider.connect();
// connect will provide the uri required for the qr code display
// and an approval Promise that will return the connection session
// once the user confirms the login

// openModal() is defined above
openModal(uri);

// pass the approval Promise
await provider.login({ approval });
```

The `login()` method supports the `token` parameter (similar to other providers):

```js
// A custom identity token (opaque to the signing provider)
const authToken = "aaaabbbbaaaabbbb";

await provider.login({ approval, token: authToken });

console.log("Address:", provider.address);
console.log("Token signature:", provider.signature);
```

> The pairing proposal between a wallet and a dapp is made using an [URI](https://docs.walletconnect.com/2.0/specs/clients/core/pairing/pairing-uri). In WalletConnect v2.0 the session and pairing are decoupled from each other. This means that a URI is shared to construct a pairing proposal, and only after settling the pairing the dapp can propose a session using that pairing. In simpler words, the dapp generates an URI that can be used by the wallet for pairing.

Once the user confirms the login, the `onClientLogin()` callback (declared above) is executed.

In order to log out, do as follows:

```js
await provider.logout();
```

### Signing transactions

Transactions can be signed as follows:

```js
import { Transaction } from "@multiversx/sdk-core";

const firstTransaction = new Transaction({ ... });
const secondTransaction = new Transaction({ ... });

await provider.signTransactions([firstTransaction, secondTransaction]);

// "firstTransaction" and "secondTransaction" can now be broadcasted.
```

Alternatively, one can sign a single transaction using the method `signTransaction()`.

### Signing messages

Arbitrary messages can be signed as follows:

```js
import { SignableMessage } from "@multiversx/sdk-core";

const message = new SignableMessage({
  message: Buffer.from("hello"),
});

await provider.signMessage(message);

console.log(message.toJSON());
```

## Namespaces

MultiversX Namespace: `mvx`

Reference: `1` for `Mainnet`, `T` for `Testnet`, `D` for `Devnet` ( same as the MultiversX chainID )

The MultiversX namespaces respect the [CAIP Standards](https://namespaces.chainagnostic.org).

### Example of a MultiversX WalletConnect Proposal Namespace

```json
{
  "optionalNamespaces": {
    "mvx": {
      "chains": ["mvx:D"],
      "methods": [
        "mvx_signTransaction",
        "mvx_signTransactions",
        "mvx_signMessage"
      ],
      "events": []
    }
  }
}
```

If the wallet (or the user) does NOT approve the session, then it is rejected. Otherwise, the wallet responds with a slightly different namespace schema: Session Namespace.

### Example of a MultiversX WalletConnect Session Namespace

```json
{
  "sessionNamespaces": {
    "mvx": {
      "chains": ["mvx:D"],
      "methods": [
        "mvx_signTransaction",
        "mvx_signTransactions",
        "mvx_signMessage"
      ],
      "events": [],
      "accounts": [
        "mvx:D:erd1p47hljmqsetgzc4yqp700z6443r655zfkkg9lfkh0tx2wzyxl8sa5jdjq"
      ]
    }
  }
}
```

### Optional Methods

The default methods are `mvx_signTransaction`, `mvx_signTransactions` and `mvx_signMessage`.

A detailed documentation for the default methods is available [here](https://specs.walletconnect.com/2.0/blockchain-rpc/multiversx-rpc).

Any additional methods must be passed in the `.connect` step

```js
const { uri, approval } = await provider.connect({
  methods: ["mvx_signNativeAuthToken", "mvx_cancelAction"],
});
```

- `mvx_signLoginToken` - Included by default for now for compatibility reasons. Subject to change as it will be replaced by the `mvx_signNativeAuthToken` method soon.
- `mvx_signNativeAuthToken` - Used while logging in with a nativeAuth token, this will offer a special UI based on that format.
- `mvx_cancelAction` - The dApp can trigger a `sendCustomRequest` event that will cancel the current signing flow on the device.

### WalletConnect JSON-RPC Methods

The available MultiversX JSON-RPC Methods and the structure can be checked on [MultiversX Docs](https://docs.multiversx.com/integrators/walletconnect-json-rpc-methods).
