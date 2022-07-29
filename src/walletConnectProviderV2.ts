import Client from "@walletconnect/sign-client";
import { PairingTypes, SessionTypes } from "@walletconnect/types";
import { getSdkError } from "@walletconnect/utils";
import { ISignableMessage, ITransaction } from "./interface";
import { WALLETCONNECT_ELROND_NAMESPACE } from "./constants";
import { Operation } from "./operation";
import { Logger } from "./logger";
import { Signature, Address } from "./primitives";
import { UserAddress } from "./userAddress";

interface SessionEventTypes {
  event: {
    name: string;
    data: any;
  };
  chainId: string;
}

interface IClientConnect {
  onClientLogin: () => void;
  onClientLogout(): void;
  onClientEvent: (event: SessionEventTypes["event"]) => void;
}

export { PairingTypes, SessionTypes, SessionEventTypes };

export enum WalletConnectV2Events {
  erd_signLoginToken = "erd_signLoginToken",
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
  events: SessionTypes.Namespace["events"] = [];

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

  async connect(options?: {
    topic?: string;
    events?: SessionTypes.Namespace["events"];
  }): Promise<{
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
    const events = options?.events ?? [];
    try {
      const response = await this.walletConnector.connect({
        pairingTopic: options?.topic,
        requiredNamespaces: {
          [WALLETCONNECT_ELROND_NAMESPACE]: {
            methods,
            chains,
            events,
          },
        },
      });
      this.events = events;

      return response;
    } catch (e) {
      if (options?.topic) {
        await this.logout({ topic: options.topic });
        Logger.error(
          "connect: WalletConnect is unable to connect to existing pairing"
        );
        throw new Error(
          "connect: WalletConnect is unable to connect to existing pairing"
        );
      } else {
        Logger.error("connect: WalletConnect is unable to connect");
        throw new Error("connect: WalletConnect is unable to connect");
      }
    }
  }

  async login(options?: {
    approval?: () => Promise<SessionTypes.Struct>;
    token?: string;
  }): Promise<string> {
    this.isInitializing = true;
    if (typeof this.walletConnector === "undefined") {
      await this.connect({ events: this.events });
    }

    if (typeof this.walletConnector === "undefined") {
      throw new Error("WalletConnect is not initialized");
    }

    if (typeof this.session !== "undefined") {
      await this.logout();
    }

    try {
      if (options && options.approval) {
        const session = await options.approval();

        if (
          this.events.includes(WalletConnectV2Events.erd_signLoginToken) &&
          options.token
        ) {
          await this.walletConnector.emit({
            topic: session.topic,
            event: {
              name: WalletConnectV2Events.erd_signLoginToken,
              data: { token: options.token },
            },
            chainId: `${WALLETCONNECT_ELROND_NAMESPACE}:${this.chainId}`,
          });
          this.session = session;

          // handle the login in the response event
          return "";
        }

        const address = await this.onSessionConnected(session, "");

        return address;
      }
    } catch (e) {
      Logger.error("login: WalletConnect is unable to login");
      throw new Error("login: WalletConnect is unable to login");
    } finally {
      this.isInitializing = false;
    }

    return "";
  }

  /**
   * Mocks a logout request by returning true
   */
  async logout(options?: { topic?: string }): Promise<boolean> {
    if (typeof this.walletConnector === "undefined") {
      Logger.error("logout: Wallet Connect not initialised, call init() first");
      throw new Error("Wallet Connect not initialised, call init() first");
    }

    try {
      if (options && options.topic) {
        const pairings = await this.getPairings();
        if (pairings && pairings.length > 0) {
          const newPairings = pairings.filter(
            (pairing) =>
              pairing.topic !== options.topic && Boolean(pairing.active)
          );

          this.pairings = newPairings;
        }
      }

      await this.walletConnector.disconnect({
        topic: options?.topic ?? this.session!.topic,
        reason: getSdkError("USER_DISCONNECTED"),
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

    return (
      this.pairings ?? this.walletConnector.pairing.getAll({ active: true })
    );
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
        reason: getSdkError("USER_DISCONNECTED"),
      });
    }
  }

  private async onSessionConnected(
    session: SessionTypes.Struct,
    signature?: any
  ): Promise<string> {
    this.session = session;

    const selectedNamespace =
      session.namespaces[WALLETCONNECT_ELROND_NAMESPACE];

    if (selectedNamespace && selectedNamespace.accounts) {
      // Use only the first address in case of multiple provided addresses
      const currentSession = selectedNamespace.accounts[0];
      const [namespace, reference, address] = currentSession.split(":");

      await this.loginAccount(address, signature);

      return address;
    }

    return "";
  }

  private async handleTopicUpdateEvent({ topic }: { topic: string }) {
    if (typeof this.walletConnector === "undefined") {
      throw new Error("WalletConnect is not initialized");
    }

    this.pairings = this.walletConnector.pairing.getAll({ active: true });
    if (
      this.address &&
      !this.isInitializing &&
      (this?.session?.topic === topic || this.pairings.length === 0)
    ) {
      this.onClientConnect.onClientLogout();
    }
  }

  private async handleSessionEvents({
    topic,
    params,
  }: {
    topic: string;
    params: SessionEventTypes;
  }) {
    if (typeof this.walletConnector === "undefined") {
      throw new Error("WalletConnect is not initialized");
    }

    const { event } = params;
    if (event?.name && this.session?.topic === topic) {
      const eventData = event.data;
      switch (event.name) {
        case WalletConnectV2Events.erd_signLoginToken:
          const { signatures } = eventData;
          if (signatures.length > 0) {
            // Use only the first signature in case of multiple provided signatures
            await this.onSessionConnected(this.session, signatures[0]);
          }
          break;

        default:
          this.onClientConnect.onClientEvent(eventData);
          break;
      }
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

    client.on("session_event", this.handleSessionEvents.bind(this));
    client.on("session_expire", this.handleTopicUpdateEvent.bind(this));
    client.on("session_delete", this.handleTopicUpdateEvent.bind(this));
    client.on("pairing_expire", this.handleTopicUpdateEvent.bind(this));
    client.on("pairing_delete", this.handleTopicUpdateEvent.bind(this));
  }

  private async checkPersistedState(client: Client) {
    if (typeof client === "undefined") {
      throw new Error("WalletConnect is not initialized");
    }

    this.pairings = client.pairing.getAll({ active: true });

    if (typeof this.session !== "undefined") {
      return;
    }

    // Populates existing session to state (assume only the top one)
    if (client.session.length && !this.address && !this.isInitializing) {
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
