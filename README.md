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

### Running the examples

Make sure you have the package `http-server` installed globally.

```
npm install --global http-server
```

Note that the examples can only be served via HTTPS (a dummy certificate is included in the `examples` folder).

When you are ready, build the examples:

```
npm run compile-examples
```

Start the server and navigate to `https://localhost:8080/examples/index.html`

```
http-server -S --port=8080
```
