import Client from "@walletconnect/sign-client";
import { PairingTypes, SessionTypes } from "@walletconnect/types";
import { ERROR } from "@walletconnect/utils";
import { ISignableMessage, ITransaction } from "./interface";
import { WALLETCONNECT_ELROND_NAMESPACE } from "./constants";
import { Operation } from "./operation";
import { Logger } from "./logger";
import { Signature, Address } from "./primitives";
import { UserAddress } from "./userAddress";

interface IClientConnect {
  onClientLogin: () => void;
  onClientLogout(): void;
}

export class WalletConnectProviderV2 {
  walletConnectV2Relay: string;
  walletConnectV2ProjectId: string;
  chainId: string = "";
  address: string = "";
  signature: string = "";
  isInitializing: boolean = false;
  walletConnector: Client | undefined;
  session: SessionTypes.Struct | undefined;
  pairings: PairingTypes.Struct[] | undefined;

  private onClientConnect: IClientConnect;

  constructor(
    onClientConnect: IClientConnect,
    chainId: string,
    walletConnectV2Relay: string,
    walletConnectV2ProjectId: string
  ) {
    this.onClientConnect = onClientConnect;
    this.chainId = chainId;
    this.walletConnectV2Relay = walletConnectV2Relay;
    this.walletConnectV2ProjectId = walletConnectV2ProjectId;
  }

  /**
   * Initiates wallet connect client.
   */
  async init(): Promise<boolean> {
    try {
      const client = await Client.init({
        relayUrl: this.walletConnectV2Relay,
        projectId: this.walletConnectV2ProjectId,
      });

      this.walletConnector = client;
      await this.subscribeToEvents(client);
      await this.checkPersistedState(client);
    } catch (err) {
      throw new Error("connect: WalletConnect is unable to init");
    } finally {
      this.isInitializing = false;
    }

    return true;
  }

  /**
   * Returns true if init() was previously called successfully
   */
  isInitialized(): boolean {
    return !!this.walletConnector;
  }

  /**
   * Mocked function, returns isInitialized as an async function
   */
  isConnected(): Promise<boolean> {
    return new Promise((resolve, _) => resolve(this.isInitialized()));
  }

  async connect(pairing?: PairingTypes.Struct): Promise<{
    uri?: string;
    approval: () => Promise<SessionTypes.Struct>;
  }> {
    if (typeof this.walletConnector === "undefined") {
      await this.init();
    }

    if (typeof this.walletConnector === "undefined") {
      throw new Error("WalletConnect is not initialized");
    }

    const methods = Object.values(Operation);
    const chains = [`${WALLETCONNECT_ELROND_NAMESPACE}:${this.chainId}`];
    try {
      const response = await this.walletConnector.connect({
        pairingTopic: pairing?.topic,
        requiredNamespaces: {
          [WALLETCONNECT_ELROND_NAMESPACE]: {
            methods,
            chains,
            events: [],
          },
        },
      });

      return response;
    } catch (e) {
      Logger.error("connect: WalletConnect is unable to connect");
      throw new Error("connect: WalletConnect is unable to connect");
    }
  }

  async login(approval: () => Promise<SessionTypes.Struct>) {
    this.isInitializing = true;
    if (typeof this.walletConnector === "undefined") {
      await this.connect();
    }

    if (typeof this.walletConnector === "undefined") {
      throw new Error("WalletConnect is not initialized");
    }

    if (this.session) {
      await this.logout();
    }

    try {
      const session = await approval();

      await this.onSessionConnected(session);
    } catch (e) {
      Logger.error("login: WalletConnect is unable to login");
      throw new Error("login: WalletConnect is unable to login");
    } finally {
      this.isInitializing = false;
    }
  }

  /**
   * Mocks a logout request by returning true
   */
  async logout(): Promise<boolean> {
    if (typeof this.walletConnector === "undefined") {
      Logger.error("logout: Wallet Connect not initialised, call init() first");
      throw new Error("Wallet Connect not initialised, call init() first");
    }
    if (!this.session) {
      Logger.error("logout: Wallet Connect Session is not connected");
      throw new Error("Wallet Connect Session is not connected");
    }

    try {
      await this.walletConnector.disconnect({
        topic: this.session.topic,
        reason: ERROR.USER_DISCONNECTED.format(),
      });
    } catch {}

    return true;
  }

  /**
   * Fetches the wallet connect address
   */
  async getAddress(): Promise<string> {
    if (typeof this.walletConnector === "undefined") {
      Logger.error(
        "getAddress: Wallet Connect not initialised, call init() first"
      );
      throw new Error("Wallet Connect not initialised, call init() first");
    }

    return this.address;
  }

  /**
   * Fetches the wallet connect signature
   */
  async getSignature(): Promise<string> {
    if (typeof this.walletConnector === "undefined") {
      Logger.error(
        "getSignature: Wallet Connect not initialised, call init() first"
      );
      throw new Error("Wallet Connect not initialised, call init() first");
    }

    return this.signature;
  }

  /**
   * Fetches the wallet connect pairings
   */
  async getPairings(): Promise<PairingTypes.Struct[] | undefined> {
    if (typeof this.walletConnector === "undefined") {
      Logger.error(
        "getPairings: Wallet Connect not initialised, call init() first"
      );
      throw new Error("Wallet Connect not initialised, call init() first");
    }

    this.pairings = this.walletConnector.pairing.values;

    return this.pairings;
  }

  /**
   * Method will be available once the Maiar wallet connect hook is implemented
   * @param _
   */
  async signMessage<T extends ISignableMessage>(message: T): Promise<T> {
    if (typeof this.walletConnector === "undefined") {
      Logger.error(
        "signMessage: Wallet Connect not initialised, call init() first"
      );
      throw new Error("Wallet Connect not initialised, call init() first");
    }

    const address = await this.getAddress();
    const { signature } = await this.walletConnector!.request({
      chainId: `${WALLETCONNECT_ELROND_NAMESPACE}:${this.chainId}`,
      topic: this.session!.topic,
      request: {
        method: Operation.SignMessage,
        params: {
          address,
          message: message.message.toString(),
        },
      },
    });

    if (!signature) {
      Logger.error("signMessage: Wallet Connect could not sign the message");
      throw new Error("Wallet Connect could not sign the message");
    }

    message.applySignature(
      new Signature(signature),
      UserAddress.fromBech32(address)
    );
    return message;
  }

  /**
   * Signs a transaction and returns it
   * @param transaction
   */
  async signTransaction<T extends ITransaction>(transaction: T): Promise<T> {
    if (typeof this.walletConnector === "undefined") {
      Logger.error(
        "signTransaction: Wallet Connect not initialised, call init() first"
      );
      throw new Error("Wallet Connect not initialised, call init() first");
    }

    const address = await this.getAddress();
    const sender = new Address(address);
    const wcTransaction = transaction.toPlainObject(sender);

    if (this.chainId !== transaction.getChainID().valueOf()) {
      Logger.error(
        "signTransaction: Transaction Chain Id different than Connection Chain Id"
      );
      throw new Error(
        "Transaction Chain Id different than Connection Chain Id"
      );
    }
    const { signature }: { signature: string } =
      await this.walletConnector!.request({
        chainId: `${WALLETCONNECT_ELROND_NAMESPACE}:${this.chainId}`,
        topic: this.session!.topic,
        request: {
          method: Operation.SignTransaction,
          params: {
            transaction: wcTransaction,
          },
        },
      });

    if (!signature) {
      Logger.error(
        "signTransaction: Wallet Connect could not sign the transaction"
      );
      throw new Error("Wallet Connect could not sign the transaction");
    }

    transaction.applySignature(
      Signature.fromHex(signature),
      UserAddress.fromBech32(address)
    );
    return transaction;
  }

  /**
   * Signs an array of transactions and returns it
   * @param transactions
   */
  async signTransactions<T extends ITransaction>(
    transactions: T[]
  ): Promise<T[]> {
    if (typeof this.walletConnector === "undefined") {
      Logger.error(
        "signTransactions: Wallet Connect not initialised, call init() first"
      );
      throw new Error("Wallet Connect not initialised, call init() first");
    }

    const address = await this.getAddress();
    const sender = new Address(address);
    const wcTransactions = transactions.map((transaction) => {
      if (this.chainId !== transaction.getChainID().valueOf()) {
        Logger.error(
          "signTransaction: Transaction Chain Id different than Connection Chain Id"
        );
        throw new Error(
          "Transaction Chain Id different than Connection Chain Id"
        );
      }
      return transaction.toPlainObject(sender);
    });
    const { signatures }: { signatures: { signature: string }[] } =
      await this.walletConnector!.request({
        chainId: `${WALLETCONNECT_ELROND_NAMESPACE}:${this.chainId}`,
        topic: this.session!.topic,
        request: {
          method: Operation.SignTransactions,
          params: {
            transactions: wcTransactions,
          },
        },
      });

    if (!signatures || !Array.isArray(signatures)) {
      Logger.error(
        "signTransactions: Wallet Connect could not sign the transactions"
      );
      throw new Error("Wallet Connect could not sign the transactions");
    }

    if (transactions.length !== signatures.length) {
      Logger.error(
        "signTransactions: Wallet Connect could not sign the transactions. Invalid signatures."
      );
      throw new Error(
        "Wallet Connect could not sign the transactions. Invalid signatures."
      );
    }

    for (const [index, transaction] of transactions.entries()) {
      transaction.applySignature(
        Signature.fromHex(signatures[index].signature),
        UserAddress.fromBech32(address)
      );
    }

    return transactions;
  }

  private async loginAccount(address: string, signature?: string) {
    if (this.addressIsValid(address)) {
      this.address = address;
      if (signature) {
        this.signature = signature;
      }
      this.onClientConnect.onClientLogin();
      return;
    }

    Logger.error(`Wallet Connect invalid address ${address}`);
    if (this.session && this.walletConnector) {
      await this.walletConnector.disconnect({
        topic: this.session.topic,
        reason: ERROR.USER_DISCONNECTED.format(),
      });
    }
  }

  private async onSessionConnected(session: SessionTypes.Struct) {
    this.session = session;

    const selectedNamespace =
      session.namespaces[WALLETCONNECT_ELROND_NAMESPACE];
    if (selectedNamespace && selectedNamespace.accounts && !this.address) {
      // Use only the first address in case of multiple provided addresses
      const currentSession = selectedNamespace.accounts[0];
      const [namespace, reference, providedAddress] = currentSession.split(":");
      const [address, signature] = providedAddress.split(".");
      await this.loginAccount(address, signature);
    }
  }

  private async subscribeToEvents(client: Client) {
    if (typeof client === "undefined") {
      throw new Error("WalletConnect is not initialized");
    }

    client.on("session_update", ({ topic, params }) => {
      const { namespaces } = params;
      const _session = client.session.get(topic);
      const updatedSession = { ..._session, namespaces };
      this.onSessionConnected(updatedSession);
    });

    client.on("session_delete", () => {
      this.onClientConnect.onClientLogout();
    });
  }

  private async checkPersistedState(client: Client) {
    if (typeof client === "undefined") {
      throw new Error("WalletConnect is not initialized");
    }

    this.pairings = client.pairing.values;

    if (typeof this.session !== "undefined") {
      return;
    }

    // Populates existing session to state (assume only the top one)
    if (client.session.length) {
      const lastKeyIndex = client.session.keys.length - 1;
      const session = client.session.get(client.session.keys[lastKeyIndex]);

      await this.onSessionConnected(session);
      return session;
    }

    return;
  }

  private addressIsValid(destinationAddress: string): boolean {
    try {
      const addr = UserAddress.fromBech32(destinationAddress);
      return !!addr;
    } catch {
      return false;
    }
  }
}
