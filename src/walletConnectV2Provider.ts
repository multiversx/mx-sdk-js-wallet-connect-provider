import { Address } from "@multiversx/sdk-core/out/address";
import { Transaction } from "@multiversx/sdk-core/out/transaction";
import { SignableMessage } from "@multiversx/sdk-core/out/signableMessage";
import Client from "@walletconnect/sign-client";
import {
  EngineTypes,
  PairingTypes,
  SessionTypes,
  SignClientTypes,
} from "@walletconnect/types";
import { getSdkError, isValidArray } from "@walletconnect/utils";
import {
  WALLETCONNECT_MULTIVERSX_METHODS,
  WALLETCONNECT_MULTIVERSX_NAMESPACE,
} from "./constants";
import { WalletConnectV2ProviderErrorMessagesEnum } from "./errors";
import { Logger } from "./logger";
import { Operation } from "./operation";

interface SessionEventTypes {
  event: {
    name: string;
    data: any;
  };
  chainId: string;
}

interface ConnectParamsTypes {
  topic?: string;
  events?: SessionTypes.Namespace["events"];
  methods?: string[];
}

interface IClientConnect {
  onClientLogin: () => void;
  onClientLogout(): void;
  onClientEvent: (event: SessionEventTypes["event"]) => void;
}

export {
  PairingTypes,
  SessionTypes,
  SessionEventTypes,
  ConnectParamsTypes,
  EngineTypes,
  WalletConnectV2ProviderErrorMessagesEnum,
};

export class WalletConnectV2Provider {
  walletConnectV2Relay: string;
  walletConnectV2ProjectId: string;
  chainId: string = "";
  address: string = "";
  signature: string = "";
  namespace: string = WALLETCONNECT_MULTIVERSX_NAMESPACE;
  isInitializing: boolean = false;
  walletConnector: Client | undefined;
  session: SessionTypes.Struct | undefined;
  pairings: PairingTypes.Struct[] | undefined;
  events: SessionTypes.Namespace["events"] = [];
  methods: string[] = [];
  processingTopic: string = "";
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

  reset() {
    this.address = "";
    this.signature = "";
    this.namespace = WALLETCONNECT_MULTIVERSX_NAMESPACE;
    this.session = undefined;
  }

  /**
   * Initiates WalletConnect client.
   */
  async init(): Promise<boolean> {
    if (this.isInitialized()) {
      return this.isInitialized();
    } else {
      try {
        if (!this.isInitializing) {
          this.isInitializing = true;
          this.reset();
          const client = await Client.init({
            relayUrl: this.walletConnectV2Relay,
            projectId: this.walletConnectV2ProjectId,
            ...this.options,
          });

          this.walletConnector = client;
          this.isInitializing = false;

          await this.subscribeToEvents(client);
          await this.checkPersistedState(client);
        }
      } catch (error) {
        throw new Error(WalletConnectV2ProviderErrorMessagesEnum.unableToInit);
      } finally {
        this.isInitializing = false;
        return this.isInitialized();
      }
    }
  }

  /**
   * Returns true if init() was previously called successfully
   */
  isInitialized(): boolean {
    return !!this.walletConnector && !this.isInitializing;
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

  async connect(options?: ConnectParamsTypes): Promise<{
    uri?: string;
    approval: () => Promise<SessionTypes.Struct>;
  }> {
    if (typeof this.walletConnector === "undefined") {
      throw new Error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
    }

    const connectParams = this.getConnectionParams(options);

    try {
      const response = await this.walletConnector.connect({
        pairingTopic: options?.topic,
        ...connectParams,
      });
      this.events =
        connectParams?.requiredNamespaces?.[
          WALLETCONNECT_MULTIVERSX_NAMESPACE
        ]?.events;

      this.methods =
        connectParams?.requiredNamespaces?.[
          WALLETCONNECT_MULTIVERSX_NAMESPACE
        ]?.methods;

      return response;
    } catch (error) {
      this.reset();
      Logger.error(
        options?.topic
          ? WalletConnectV2ProviderErrorMessagesEnum.unableToConnectExisting
          : WalletConnectV2ProviderErrorMessagesEnum.unableToConnect
      );

      throw new Error(
        options?.topic
          ? WalletConnectV2ProviderErrorMessagesEnum.unableToConnectExisting
          : WalletConnectV2ProviderErrorMessagesEnum.unableToConnect
      );
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
      throw new Error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
    }

    if (typeof this.session !== "undefined") {
      await this.logout({ topic: this.session?.topic });
    }

    try {
      if (options && options.approval) {
        const session = await options.approval();

        if (options.token) {
          const address = this.getAddressFromSession(session);
          const { signature }: { signature: string } =
            await this.walletConnector.request({
              chainId: `${this.namespace}:${this.chainId}`,
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
            Logger.error(
              WalletConnectV2ProviderErrorMessagesEnum.unableToSignLoginToken
            );
            throw new Error(
              WalletConnectV2ProviderErrorMessagesEnum.unableToSignLoginToken
            );
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
      this.reset();
      Logger.error(WalletConnectV2ProviderErrorMessagesEnum.unableToLogin);
      throw new Error(WalletConnectV2ProviderErrorMessagesEnum.unableToLogin);
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
      Logger.error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
      throw new Error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
    }

    try {
      if (
        this.processingTopic ===
        (options?.topic || this.getCurrentTopic(this.walletConnector))
      ) {
        return true;
      }

      if (options?.topic) {
        this.processingTopic = options.topic;
        await this.walletConnector.disconnect({
          topic: options.topic,
          reason: getSdkError("USER_DISCONNECTED"),
        });
      } else {
        const currentSessionTopic = this.getCurrentTopic(this.walletConnector);
        this.processingTopic = currentSessionTopic;
        await this.walletConnector.disconnect({
          topic: currentSessionTopic,
          reason: getSdkError("USER_DISCONNECTED"),
        });

        this.reset();

        await this.cleanupPendingPairings({ deletePairings: true });
      }
    } catch {
      Logger.error(WalletConnectV2ProviderErrorMessagesEnum.alreadyLoggedOut);
    } finally {
      this.processingTopic = "";
    }

    return true;
  }

  /**
   * Fetches the WalletConnect address
   */
  async getAddress(): Promise<string> {
    if (typeof this.walletConnector === "undefined") {
      Logger.error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
      throw new Error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
    }

    return this.address;
  }

  /**
   * Fetches the WalletConnect signature
   */
  async getSignature(): Promise<string> {
    if (typeof this.walletConnector === "undefined") {
      Logger.error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
      throw new Error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
    }

    return this.signature;
  }

  /**
   * Fetches the WalletConnect pairings
   */
  async getPairings(): Promise<PairingTypes.Struct[] | undefined> {
    if (typeof this.walletConnector === "undefined") {
      Logger.error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
      throw new Error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
    }

    return (
      this.walletConnector?.core?.pairing?.pairings?.getAll({ active: true }) ??
      []
    );
  }

  /**
   * Signs a message and returns it signed
   * @param message
   */
  async signMessage(message: SignableMessage): Promise<SignableMessage> {
    if (typeof this.walletConnector === "undefined") {
      Logger.error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
      throw new Error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
    }

    if (typeof this.session === "undefined") {
      Logger.error(
        WalletConnectV2ProviderErrorMessagesEnum.sessionNotConnected
      );
      this.onClientConnect.onClientLogout();
      throw new Error(
        WalletConnectV2ProviderErrorMessagesEnum.sessionNotConnected
      );
    }

    const address = await this.getAddress();
    const { signature }: { signature: string } =
      await this.walletConnector.request({
        chainId: `${this.namespace}:${this.chainId}`,
        topic: this.getCurrentTopic(this.walletConnector),
        request: {
          method: Operation.SIGN_MESSAGE,
          params: {
            address,
            message: message.message.toString(),
          },
        },
      });

    if (!signature) {
      Logger.error(
        WalletConnectV2ProviderErrorMessagesEnum.invalidMessageResponse
      );
      throw new Error(
        WalletConnectV2ProviderErrorMessagesEnum.invalidMessageResponse
      );
    }

    try {
      message.applySignature(Buffer.from(signature, "hex"));
    } catch (error) {
      Logger.error(
        WalletConnectV2ProviderErrorMessagesEnum.invalidMessageSignature
      );
      throw new Error(
        WalletConnectV2ProviderErrorMessagesEnum.invalidMessageSignature
      );
    }

    return message;
  }

  /**
   * Signs a transaction and returns it signed
   * @param transaction
   */
  async signTransaction(transaction: Transaction): Promise<Transaction> {
    if (typeof this.walletConnector === "undefined") {
      Logger.error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
      throw new Error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
    }

    if (typeof this.session === "undefined") {
      Logger.error(
        WalletConnectV2ProviderErrorMessagesEnum.sessionNotConnected
      );
      this.onClientConnect.onClientLogout();
      throw new Error(
        WalletConnectV2ProviderErrorMessagesEnum.sessionNotConnected
      );
    }

    const plainTransaction = transaction.toPlainObject();

    if (this.chainId !== transaction.getChainID().valueOf()) {
      Logger.error(
        WalletConnectV2ProviderErrorMessagesEnum.requestDifferentChain
      );
      throw new Error(
        WalletConnectV2ProviderErrorMessagesEnum.requestDifferentChain
      );
    }

    try {
      const { signature }: { signature: string } =
        await this.walletConnector.request({
          chainId: `${this.namespace}:${this.chainId}`,
          topic: this.getCurrentTopic(this.walletConnector),
          request: {
            method: Operation.SIGN_TRANSACTION,
            params: {
              transaction: plainTransaction,
            },
          },
        });

      if (!signature) {
        Logger.error(
          WalletConnectV2ProviderErrorMessagesEnum.requestDifferentChain
        );
        throw new Error(
          WalletConnectV2ProviderErrorMessagesEnum.requestDifferentChain
        );
      }

      transaction.applySignature(Buffer.from(signature, "hex"));
      // TODO: in future minor version, call setOptions(), setGuardian(), applyGuardianSignature(), as well (if applicable).

      return transaction;
    } catch (error) {
      throw new Error(
        WalletConnectV2ProviderErrorMessagesEnum.transactionError
      );
    }
  }

  /**
   * Signs an array of transactions and returns it signed
   * @param transactions
   */
  async signTransactions(transactions: Transaction[]): Promise<Transaction[]> {
    if (typeof this.walletConnector === "undefined") {
      Logger.error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
      throw new Error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
    }

    if (typeof this.session === "undefined") {
      Logger.error(
        WalletConnectV2ProviderErrorMessagesEnum.sessionNotConnected
      );
      this.onClientConnect.onClientLogout();
      throw new Error(
        WalletConnectV2ProviderErrorMessagesEnum.sessionNotConnected
      );
    }

    const plainTransactions = transactions.map((transaction) => {
      if (this.chainId !== transaction.getChainID().valueOf()) {
        Logger.error(
          WalletConnectV2ProviderErrorMessagesEnum.requestDifferentChain
        );
        throw new Error(
          WalletConnectV2ProviderErrorMessagesEnum.requestDifferentChain
        );
      }
      return transaction.toPlainObject();
    });

    try {
      const { signatures }: { signatures: { signature: string }[] } =
        await this.walletConnector.request({
          chainId: `${this.namespace}:${this.chainId}`,
          topic: this.getCurrentTopic(this.walletConnector),
          request: {
            method: Operation.SIGN_TRANSACTIONS,
            params: {
              transactions: plainTransactions,
            },
          },
        });

      if (!signatures || !Array.isArray(signatures)) {
        Logger.error(
          WalletConnectV2ProviderErrorMessagesEnum.invalidTransactionResponse
        );
      }

      if (transactions.length !== signatures.length) {
        Logger.error(
          WalletConnectV2ProviderErrorMessagesEnum.invalidTransactionResponse
        );
      }

      for (const [index, transaction] of transactions.entries()) {
        transaction.applySignature(
          Buffer.from(signatures[index].signature, "hex")
        );
      }

      return transactions;
    } catch (error) {
      throw new Error(
        WalletConnectV2ProviderErrorMessagesEnum.transactionError
      );
    }
  }

  /**
   * Sends a custom request
   * @param request
   */

  async sendCustomRequest(options?: {
    request: EngineTypes.RequestParams["request"];
  }): Promise<any> {
    if (typeof this.walletConnector === "undefined") {
      Logger.error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
      throw new Error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
    }

    if (typeof this.session === "undefined") {
      Logger.error(
        WalletConnectV2ProviderErrorMessagesEnum.sessionNotConnected
      );
      this.onClientConnect.onClientLogout();
      throw new Error(
        WalletConnectV2ProviderErrorMessagesEnum.sessionNotConnected
      );
    }

    if (options?.request?.method) {
      const request = { ...options.request };
      let { method } = request;

      const { response }: { response: any } =
        await this.walletConnector.request({
          chainId: `${this.namespace}:${this.chainId}`,
          topic: this.getCurrentTopic(this.walletConnector),
          request: { ...request, method },
        });

      if (!response) {
        Logger.error(
          WalletConnectV2ProviderErrorMessagesEnum.invalidCustomRequestResponse
        );
        throw new Error(
          WalletConnectV2ProviderErrorMessagesEnum.invalidCustomRequestResponse
        );
      }

      return response;
    }
  }

  /**
   * Ping helper
   */

  async ping(): Promise<boolean> {
    if (typeof this.walletConnector === "undefined") {
      Logger.error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
      throw new Error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
    }

    if (typeof this.session === "undefined") {
      Logger.error(
        WalletConnectV2ProviderErrorMessagesEnum.sessionNotConnected
      );
    }

    try {
      const topic = this.getCurrentTopic(this.walletConnector);

      await this.walletConnector.ping({
        topic,
      });
      return true;
    } catch (error) {
      Logger.error(WalletConnectV2ProviderErrorMessagesEnum.pingFailed);
      return false;
    }
  }

  private async loginAccount(options?: {
    address: string;
    signature?: string;
  }): Promise<string> {
    if (!options) {
      return "";
    }

    if (this.addressIsValid(options.address)) {
      this.address = options.address;
      if (options.signature) {
        this.signature = options.signature;
      }
      this.onClientConnect.onClientLogin();

      return this.address;
    }

    Logger.error(
      `${WalletConnectV2ProviderErrorMessagesEnum.invalidAddress} ${options.address}`
    );
    if (this.walletConnector) {
      await this.logout();
    }

    return "";
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

      return address;
    }

    return "";
  }

  private async handleTopicUpdateEvent({
    topic,
  }: {
    topic: string;
  }): Promise<void> {
    if (typeof this.walletConnector === "undefined") {
      throw new Error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
    }

    try {
      const existingPairings = await this.getPairings();

      if (this.address && !this.isInitializing && existingPairings) {
        if (existingPairings?.length === 0) {
          this.onClientConnect.onClientLogout();
        } else {
          const lastActivePairing =
            existingPairings[existingPairings.length - 1];

          if (lastActivePairing?.topic === topic) {
            this.onClientConnect.onClientLogout();
          }
        }
      }
    } catch (error) {
      Logger.error(
        WalletConnectV2ProviderErrorMessagesEnum.unableToHandleTopic
      );
    } finally {
      this.pairings = await this.getPairings();
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
      throw new Error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
    }
    if (this.session && this.session?.topic !== topic) {
      return;
    }

    const { event } = params;
    if (event?.name && this.getCurrentTopic(this.walletConnector) === topic) {
      const eventData = event.data;

      this.onClientConnect.onClientEvent(eventData);
    }
  }

  private async subscribeToEvents(client: Client): Promise<void> {
    if (typeof client === "undefined") {
      throw new Error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
    }

    try {
      // Session Events
      client.on("session_update", ({ topic, params }) => {
        if (!this.session || this.session?.topic !== topic) {
          return;
        }

        const { namespaces } = params;
        const _session = client.session.get(topic);
        const updatedSession = { ..._session, namespaces };
        this.onSessionConnected({ session: updatedSession });
      });

      client.on("session_event", this.handleSessionEvents.bind(this));

      client.on("session_delete", async ({ topic }) => {
        if (!this.session || this.session?.topic !== topic) {
          return;
        }

        Logger.error(WalletConnectV2ProviderErrorMessagesEnum.sessionDeleted);

        this.onClientConnect.onClientLogout();

        this.reset();
        await this.cleanupPendingPairings({ deletePairings: true });
      });

      client.on("session_expire", async ({ topic }) => {
        if (!this.session || this.session?.topic !== topic) {
          return;
        }

        Logger.error(WalletConnectV2ProviderErrorMessagesEnum.sessionExpired);
        this.onClientConnect.onClientLogout();

        this.reset();
        await this.cleanupPendingPairings({ deletePairings: true });
      });

      // Pairing Events
      client.core?.pairing?.events.on(
        "pairing_delete",
        this.handleTopicUpdateEvent.bind(this)
      );

      client.core?.pairing?.events.on(
        "pairing_expire",
        this.handleTopicUpdateEvent.bind(this)
      );
    } catch (error) {
      Logger.error(
        WalletConnectV2ProviderErrorMessagesEnum.unableToHandleEvent
      );
    }
  }

  private async checkPersistedState(
    client: Client
  ): Promise<SessionTypes.Struct | undefined> {
    if (typeof client === "undefined") {
      throw new Error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
    }

    this.pairings = await this.getPairings();

    if (typeof this.session !== "undefined") {
      return;
    }

    // Populates existing session to state (assume only the top one)
    if (client.session.length && !this.address && !this.isInitializing) {
      const session = this.getCurrentSession(client);
      if (session) {
        await this.onSessionConnected({ session });

        return session;
      }
    }

    return;
  }

  private async cleanupPendingPairings(
    options: { deletePairings?: boolean } = {}
  ): Promise<void> {
    if (typeof this.walletConnector === "undefined") {
      return;
    }

    try {
      const inactivePairings =
        this.walletConnector.core?.pairing?.pairings?.getAll({ active: false });

      if (!isValidArray(inactivePairings)) {
        return;
      }

      for (const pairing of inactivePairings) {
        if (options.deletePairings) {
          this.walletConnector.core?.expirer?.set(pairing.topic, 0);
        } else {
          await this.walletConnector.core?.relayer?.subscriber?.unsubscribe(
            pairing.topic
          );
        }
      }
    } catch (error) {
      Logger.error(
        WalletConnectV2ProviderErrorMessagesEnum.unableToHandleCleanup
      );
    }
  }

  private getCurrentSession(client: Client): SessionTypes.Struct {
    if (typeof client === "undefined") {
      throw new Error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
    }

    const acknowledgedSessions = client
      .find(this.getConnectionParams())
      .filter((s) => s.acknowledged);

    if (acknowledgedSessions.length > 0) {
      const lastKeyIndex = acknowledgedSessions.length - 1;
      const session = acknowledgedSessions[lastKeyIndex];

      return session;
    } else if (client.session.length > 0) {
      const lastKeyIndex = client.session.keys.length - 1;
      const session = client.session.get(client.session.keys[lastKeyIndex]);

      return session;
    } else {
      Logger.error(
        WalletConnectV2ProviderErrorMessagesEnum.sessionNotConnected
      );
      throw new Error(
        WalletConnectV2ProviderErrorMessagesEnum.sessionNotConnected
      );
    }
  }

  private getCurrentTopic(client: Client): SessionTypes.Struct["topic"] {
    if (typeof client === "undefined") {
      throw new Error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
    }

    const session = this.getCurrentSession(client);
    if (session?.topic) {
      return session.topic;
    } else {
      throw new Error(
        WalletConnectV2ProviderErrorMessagesEnum.sessionNotConnected
      );
    }
  }

  private getConnectionParams(
    options?: ConnectParamsTypes
  ): EngineTypes.FindParams {
    const methods = [
      ...WALLETCONNECT_MULTIVERSX_METHODS,
      ...(options?.methods ?? []),
    ];
    const chains = [`${WALLETCONNECT_MULTIVERSX_NAMESPACE}:${this.chainId}`];
    const events = options?.events ?? [];

    return {
      requiredNamespaces: {
        [WALLETCONNECT_MULTIVERSX_NAMESPACE]: {
          methods,
          chains,
          events,
        },
      },
    };
  }

  private addressIsValid(destinationAddress: string): boolean {
    try {
      const addr = Address.fromBech32(destinationAddress);
      return !!addr;
    } catch {
      return false;
    }
  }

  private getAddressFromSession(session: SessionTypes.Struct): string {
    const selectedNamespace = session.namespaces[this.namespace];

    if (selectedNamespace && selectedNamespace.accounts) {
      // Use only the first address in case of multiple provided addresses
      const currentSession = selectedNamespace.accounts[0];
      const [namespace, reference, address] = currentSession.split(":");

      return address;
    }

    return "";
  }
}
