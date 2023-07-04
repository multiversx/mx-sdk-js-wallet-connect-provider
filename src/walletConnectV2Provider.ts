import { SignableMessage, Transaction } from "@multiversx/sdk-core";
import { Signature } from "@multiversx/sdk-core/out/signature";
import Client from "@walletconnect/sign-client";
import {
  EngineTypes,
  PairingTypes,
  SessionTypes,
  SignClientTypes,
} from "@walletconnect/types";
import { getSdkError, isValidArray } from "@walletconnect/utils";
import { WALLETCONNECT_MULTIVERSX_NAMESPACE } from "./constants";
import { WalletConnectV2ProviderErrorMessagesEnum } from "./errors";
import { Logger } from "./logger";
import { Operation, OptionalOperation } from "./operation";
import {
  applyTransactionSignature,
  addressIsValid,
  getCurrentSession,
  getCurrentTopic,
  getAddressFromSession,
  getConnectionParams,
  getMetadata,
  ConnectParamsTypes,
  TransactionResponse,
} from "./utils";

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
  isInitializing: boolean = false;
  walletConnector: Client | undefined;
  session: SessionTypes.Struct | undefined;
  pairings: PairingTypes.Struct[] | undefined;
  processingTopic: string = "";
  options: SignClientTypes.Options | undefined = {};

  private onClientConnect: IClientConnect;

  constructor(
    onClientConnect: IClientConnect,
    chainId: string,
    walletConnectV2Relay: string,
    walletConnectV2ProjectId: string,
    options?: SignClientTypes.Options
  ) {
    this.onClientConnect = onClientConnect;
    this.chainId = chainId;
    this.walletConnectV2Relay = walletConnectV2Relay;
    this.walletConnectV2ProjectId = walletConnectV2ProjectId;
    this.options = options;
  }

  private reset() {
    this.address = "";
    this.signature = "";
    this.walletConnector = undefined;
    this.session = undefined;
    this.pairings = undefined;
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
          const metadata = this.options?.metadata
            ? {
                metadata: getMetadata(this.options?.metadata),
              }
            : {};

          const client = await Client.init({
            ...this.options,
            relayUrl: this.walletConnectV2Relay,
            projectId: this.walletConnectV2ProjectId,
            ...metadata,
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

    const connectParams = getConnectionParams(this.chainId, options);

    try {
      const response = await this.walletConnector.connect({
        pairingTopic: options?.topic,
        ...connectParams,
      });

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
          const address = getAddressFromSession(session);

          const selectedNamespace =
            session.namespaces[WALLETCONNECT_MULTIVERSX_NAMESPACE];
          const method = selectedNamespace.methods.includes(
            OptionalOperation.SIGN_NATIVE_AUTH_TOKEN
          )
            ? OptionalOperation.SIGN_NATIVE_AUTH_TOKEN
            : OptionalOperation.SIGN_LOGIN_TOKEN;

          const { signature }: { signature: string } =
            await this.walletConnector.request({
              chainId: `${WALLETCONNECT_MULTIVERSX_NAMESPACE}:${this.chainId}`,
              topic: session.topic,
              request: {
                method,
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
        (options?.topic || getCurrentTopic(this.chainId, this.walletConnector))
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
        const currentSessionTopic = getCurrentTopic(
          this.chainId,
          this.walletConnector
        );
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

    try {
      const address = await this.getAddress();
      const { signature }: { signature: string } =
        await this.walletConnector.request({
          chainId: `${WALLETCONNECT_MULTIVERSX_NAMESPACE}:${this.chainId}`,
          topic: getCurrentTopic(this.chainId, this.walletConnector),
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
        message.applySignature(new Signature(signature));
      } catch (error) {
        Logger.error(
          WalletConnectV2ProviderErrorMessagesEnum.invalidMessageSignature
        );
        throw new Error(
          WalletConnectV2ProviderErrorMessagesEnum.invalidMessageSignature
        );
      }
    } catch (error) {
      throw new Error(WalletConnectV2ProviderErrorMessagesEnum.unableToSign);
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
      const response: TransactionResponse = await this.walletConnector.request({
        chainId: `${WALLETCONNECT_MULTIVERSX_NAMESPACE}:${this.chainId}`,
        topic: getCurrentTopic(this.chainId, this.walletConnector),
        request: {
          method: Operation.SIGN_TRANSACTION,
          params: {
            transaction: plainTransaction,
          },
        },
      });

      return applyTransactionSignature({ transaction, response });
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
      const { signatures }: { signatures: TransactionResponse[] } =
        await this.walletConnector.request({
          chainId: `${WALLETCONNECT_MULTIVERSX_NAMESPACE}:${this.chainId}`,
          topic: getCurrentTopic(this.chainId, this.walletConnector),
          request: {
            method: Operation.SIGN_TRANSACTIONS,
            params: {
              transactions: plainTransactions,
            },
          },
        });

      if (!signatures) {
        Logger.error(
          WalletConnectV2ProviderErrorMessagesEnum.invalidTransactionResponse
        );
        throw new Error(
          WalletConnectV2ProviderErrorMessagesEnum.invalidTransactionResponse
        );
      }

      if (
        !Array.isArray(signatures) ||
        transactions.length !== signatures.length
      ) {
        throw new Error(
          WalletConnectV2ProviderErrorMessagesEnum.invalidTransactionResponse
        );
      }

      for (const [index, transaction] of transactions.entries()) {
        const response = signatures[index];
        applyTransactionSignature({ transaction, response });
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
      try {
        const request = { ...options.request };
        let { method } = request;

        const { response }: { response: any } =
          await this.walletConnector.request({
            chainId: `${WALLETCONNECT_MULTIVERSX_NAMESPACE}:${this.chainId}`,
            topic: getCurrentTopic(this.chainId, this.walletConnector),
            request: { ...request, method },
          });

        if (!response) {
          Logger.error(
            WalletConnectV2ProviderErrorMessagesEnum.invalidCustomRequestResponse
          );
        }
      } catch (error) {
        Logger.error(
          WalletConnectV2ProviderErrorMessagesEnum.invalidCustomRequestResponse
        );
      }

      return;
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
      const topic = getCurrentTopic(this.chainId, this.walletConnector);
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

    if (addressIsValid(options.address)) {
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

    const address = getAddressFromSession(options.session);

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
    if (
      event?.name &&
      getCurrentTopic(this.chainId, this.walletConnector) === topic
    ) {
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
      const session = getCurrentSession(this.chainId, client);
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
          try {
            await this.walletConnector.core?.relayer?.subscriber?.unsubscribe(
              pairing.topic
            );
          } catch (error) {
            Logger.error(
              WalletConnectV2ProviderErrorMessagesEnum.unableToHandleCleanup
            );
          }
        }
      }
    } catch (error) {
      Logger.error(
        WalletConnectV2ProviderErrorMessagesEnum.unableToHandleCleanup
      );
    }
  }
}
