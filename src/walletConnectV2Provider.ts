import Client from "@walletconnect/sign-client";
import {
  PairingTypes,
  SessionTypes,
  EngineTypes,
  SignClientTypes,
} from "@walletconnect/types";
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

export { PairingTypes, SessionTypes, SessionEventTypes, EngineTypes };

export class WalletConnectV2Provider {
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
  methods: string[] = [];
  options: Omit<SignClientTypes.Options, "relayUrl" | "projectId"> | undefined =
    {};

  private onClientConnect: IClientConnect;

  constructor(
    onClientConnect: IClientConnect,
    chainId: string,
    walletConnectV2Relay: string,
    walletConnectV2ProjectId: string,
    options?: Omit<SignClientTypes.Options, "relayUrl" | "projectId">
  ) {
    this.onClientConnect = onClientConnect;
    this.chainId = chainId;
    this.walletConnectV2Relay = walletConnectV2Relay;
    this.walletConnectV2ProjectId = walletConnectV2ProjectId;
    this.options = options;
  }

  /**
   * Initiates WalletConnect client.
   */
  async init(): Promise<boolean> {
    try {
      const client = await Client.init({
        relayUrl: this.walletConnectV2Relay,
        projectId: this.walletConnectV2ProjectId,
        ...this.options,
      });

      this.walletConnector = client;
      await this.subscribeToEvents(client);
      await this.checkPersistedState(client);
    } catch (error) {
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
   * Returns true if provider is initialized and a valid session is set
   */
  isConnected(): Promise<boolean> {
    return new Promise((resolve, _) =>
      resolve(
        Boolean(this.isInitialized() && typeof this.session !== "undefined")
      )
    );
  }

  async connect(options?: {
    topic?: string;
    events?: SessionTypes.Namespace["events"];
    methods?: string[];
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

    const methods = [...Object.values(Operation), ...(options?.methods ?? [])];
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
      this.methods = methods;

      return response;
    } catch (error) {
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
      await this.connect();
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

        if (options.token) {
          const address = this.getAddressFromSession(session);
          const { signature }: { signature: string } =
            await this.walletConnector.request({
              chainId: `${WALLETCONNECT_ELROND_NAMESPACE}:${this.chainId}`,
              topic: session.topic,
              request: {
                method: Operation.SIGN_LOGIN_TOKEN,
                params: {
                  token: options.token,
                  address,
                },
              },
            });

          if (!signature) {
            Logger.error("login: WalletConnect could not sign login token");
            throw new Error("WalletConnect could not sign login token");
          }

          return await this.onSessionConnected({
            session,
            signature,
          });
        }

        return await this.onSessionConnected({
          session,
          signature: "",
        });
      }
    } catch (error) {
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
      Logger.error("logout: WalletConnect not initialised, call init() first");
      throw new Error("WalletConnect not initialised, call init() first");
    }

    try {
      const topic = options?.topic ?? this.session?.topic;
      if (topic) {
        await this.walletConnector.disconnect({
          topic,
          reason: getSdkError("USER_DISCONNECTED"),
        });
        const newPairings = this.walletConnector.pairing
          .getAll({ active: true })
          .filter((pairing) => pairing.topic !== topic);
        this.pairings = newPairings;
      }
    } catch {
      Logger.error("logout: WalletConnect was unable to logout");
    }
    this.session = undefined;

    return true;
  }

  /**
   * Fetches the WalletConnect address
   */
  async getAddress(): Promise<string> {
    if (typeof this.walletConnector === "undefined") {
      Logger.error(
        "getAddress: WalletConnect not initialised, call init() first"
      );
      throw new Error("WalletConnect not initialised, call init() first");
    }

    return this.address;
  }

  /**
   * Fetches the WalletConnect signature
   */
  async getSignature(): Promise<string> {
    if (typeof this.walletConnector === "undefined") {
      Logger.error(
        "getSignature: WalletConnect not initialised, call init() first"
      );
      throw new Error("WalletConnect not initialised, call init() first");
    }

    return this.signature;
  }

  /**
   * Fetches the WalletConnect pairings
   */
  async getPairings(): Promise<PairingTypes.Struct[] | undefined> {
    if (typeof this.walletConnector === "undefined") {
      Logger.error(
        "getPairings: WalletConnect not initialised, call init() first"
      );
      throw new Error("WalletConnect not initialised, call init() first");
    }

    return (
      this.pairings ?? this.walletConnector.pairing.getAll({ active: true })
    );
  }

  /**
   * Signs a message and returns it signed
   * @param message
   */
  async signMessage<T extends ISignableMessage>(message: T): Promise<T> {
    if (typeof this.walletConnector === "undefined") {
      Logger.error(
        "signMessage: WalletConnect not initialised, call init() first"
      );
      throw new Error("WalletConnect not initialised, call init() first");
    }

    if (typeof this.session === "undefined") {
      Logger.error("signMessage: Session is not connected");
      this.onClientConnect.onClientLogout();
      throw new Error("Session is not connected");
    }

    const address = await this.getAddress();
    const { signature }: { signature: Buffer } =
      await this.walletConnector.request({
        chainId: `${WALLETCONNECT_ELROND_NAMESPACE}:${this.chainId}`,
        topic: this.session!.topic,
        request: {
          method: Operation.SIGN_MESSAGE,
          params: {
            address,
            message: message.message.toString(),
          },
        },
      });

    if (!signature) {
      Logger.error("signMessage: WalletConnect could not sign the message");
      throw new Error("WalletConnect could not sign the message");
    }

    message.applySignature(
      new Signature(signature),
      UserAddress.fromBech32(address)
    );
    return message;
  }

  /**
   * Signs a transaction and returns it signed
   * @param transaction
   */
  async signTransaction<T extends ITransaction>(transaction: T): Promise<T> {
    if (typeof this.walletConnector === "undefined") {
      Logger.error(
        "signTransaction: WalletConnect not initialised, call init() first"
      );
      throw new Error("WalletConnect not initialised, call init() first");
    }

    if (typeof this.session === "undefined") {
      Logger.error("signTransaction: Session is not connected");
      this.onClientConnect.onClientLogout();
      throw new Error("Session is not connected");
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
      await this.walletConnector.request({
        chainId: `${WALLETCONNECT_ELROND_NAMESPACE}:${this.chainId}`,
        topic: this.session!.topic,
        request: {
          method: Operation.SIGN_TRANSACTION,
          params: {
            transaction: wcTransaction,
          },
        },
      });

    if (!signature) {
      Logger.error(
        "signTransaction: WalletConnect could not sign the transaction"
      );
      throw new Error("WalletConnect could not sign the transaction");
    }

    transaction.applySignature(
      Signature.fromHex(signature),
      UserAddress.fromBech32(address)
    );
    return transaction;
  }

  /**
   * Signs an array of transactions and returns it signed
   * @param transactions
   */
  async signTransactions<T extends ITransaction>(
    transactions: T[]
  ): Promise<T[]> {
    if (typeof this.walletConnector === "undefined") {
      Logger.error(
        "signTransactions: WalletConnect not initialised, call init() first"
      );
      throw new Error("WalletConnect not initialised, call init() first");
    }

    if (typeof this.session === "undefined") {
      Logger.error("signTransactions: Session is not connected");
      this.onClientConnect.onClientLogout();
      throw new Error("Session is not connected");
    }

    const address = await this.getAddress();
    const sender = new Address(address);
    const wcTransactions = transactions.map((transaction) => {
      if (this.chainId !== transaction.getChainID().valueOf()) {
        Logger.error(
          "signTransactions: Transaction Chain Id different than Connection Chain Id"
        );
        throw new Error(
          "Transactions Chain Id different than Connection Chain Id"
        );
      }
      return transaction.toPlainObject(sender);
    });
    const { signatures }: { signatures: { signature: string }[] } =
      await this.walletConnector.request({
        chainId: `${WALLETCONNECT_ELROND_NAMESPACE}:${this.chainId}`,
        topic: this.session!.topic,
        request: {
          method: Operation.SIGN_TRANSACTIONS,
          params: {
            transactions: wcTransactions,
          },
        },
      });

    if (!signatures || !Array.isArray(signatures)) {
      Logger.error(
        "signTransactions: WalletConnect could not sign the transactions"
      );
      throw new Error("WalletConnect could not sign the transactions");
    }

    if (transactions.length !== signatures.length) {
      Logger.error(
        "signTransactions: WalletConnect could not sign the transactions. Invalid signatures."
      );
      throw new Error(
        "WalletConnect could not sign the transactions. Invalid signatures."
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

  /**
   * Sends a custom request
   * @param request
   */

  async sendCustomRequest(options?: {
    request: EngineTypes.RequestParams["request"];
  }): Promise<any> {
    if (typeof this.walletConnector === "undefined") {
      Logger.error(
        "sendCustomRequest: WalletConnect not initialised, call init() first"
      );
      throw new Error("WalletConnect not initialised, call init() first");
    }

    if (typeof this.session === "undefined") {
      Logger.error("sendCustomRequest: Session is not connected");
      this.onClientConnect.onClientLogout();
      throw new Error("Session is not connected");
    }

    if (options?.request) {
      const { response }: { response: any } =
        await this.walletConnector.request({
          chainId: `${WALLETCONNECT_ELROND_NAMESPACE}:${this.chainId}`,
          topic: this.session!.topic,
          request: options.request,
        });

      if (!response) {
        Logger.error(
          "sendCustomRequest: WalletConnect could not send the custom request"
        );
        throw new Error("WalletConnect could not send the custom request");
      }

      return response;
    }
  }

  /**
   * Ping helper
   */

  async ping(): Promise<boolean> {
    if (typeof this.walletConnector === "undefined") {
      Logger.error("ping: WalletConnect not initialised, call init() first");
      throw new Error("WalletConnect not initialised, call init() first");
    }

    if (typeof this.session === "undefined") {
      Logger.error("ping: Session is not connected");
      this.onClientConnect.onClientLogout();
      throw new Error("Session is not connected");
    }

    try {
      await this.walletConnector.ping({ topic: this.session!.topic });
      return true;
    } catch (error) {
      Logger.error("ping: Ping failed");
      return false;
    }
  }

  private async loginAccount(options?: {
    address: string;
    signature?: string;
  }): Promise<void> {
    if (!options) {
      return;
    }

    if (this.addressIsValid(options.address)) {
      this.address = options.address;
      if (options.signature) {
        this.signature = options.signature;
      }
      this.onClientConnect.onClientLogin();
      return;
    }

    Logger.error(`WalletConnect invalid address ${options.address}`);
    if (this.session?.topic && this.walletConnector) {
      await this.walletConnector.disconnect({
        topic: this.session.topic,
        reason: getSdkError("USER_DISCONNECTED"),
      });
      const newPairings = this.walletConnector.pairing.getAll({ active: true });
      this.pairings = newPairings;
    }
  }

  private async onSessionConnected(options?: {
    session: SessionTypes.Struct;
    signature?: string;
  }): Promise<string> {
    if (!options) {
      return "";
    }

    this.session = options.session;
    const address = this.getAddressFromSession(options.session);

    if (address) {
      await this.loginAccount({ address, signature: options.signature });
    }

    return "";
  }

  private async handleTopicUpdateEvent({
    topic,
  }: {
    topic: string;
  }): Promise<void> {
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
  }): Promise<void> {
    if (typeof this.walletConnector === "undefined") {
      throw new Error("WalletConnect is not initialized");
    }

    const { event } = params;
    if (event?.name && this.session?.topic === topic) {
      const eventData = event.data;

      this.onClientConnect.onClientEvent(eventData);
    }
  }

  private async subscribeToEvents(client: Client): Promise<void> {
    if (typeof client === "undefined") {
      throw new Error("WalletConnect is not initialized");
    }

    client.on("session_update", ({ topic, params }) => {
      const { namespaces } = params;
      const _session = client.session.get(topic);
      const updatedSession = { ..._session, namespaces };
      this.onSessionConnected({ session: updatedSession });
    });

    client.on("session_event", this.handleSessionEvents.bind(this));
    client.on("session_delete", this.handleTopicUpdateEvent.bind(this));
    client.on("session_expire", this.handleTopicUpdateEvent.bind(this));
  }

  private async checkPersistedState(
    client: Client
  ): Promise<SessionTypes.Struct | undefined> {
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

      await this.onSessionConnected({ session });
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

  private getAddressFromSession(session: SessionTypes.Struct): string {
    const selectedNamespace =
      session.namespaces[WALLETCONNECT_ELROND_NAMESPACE];

    if (selectedNamespace && selectedNamespace.accounts) {
      // Use only the first address in case of multiple provided addresses
      const currentSession = selectedNamespace.accounts[0];
      const [namespace, reference, address] = currentSession.split(":");

      return address;
    }

    return "";
  }
}
