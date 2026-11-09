import { Message } from "@multiversx/sdk-core/out/core/message";
import { Address } from "@multiversx/sdk-core/out/core/address";
import { Transaction } from "@multiversx/sdk-core/out/core/transaction";

import Client from "@walletconnect/sign-client";
import {
  EngineTypes,
  PairingTypes,
  SessionTypes,
  SignClientTypes,
} from "@walletconnect/types";
import { getSdkError, isValidArray } from "@walletconnect/utils";
import {
  WALLETCONNECT_MULTIVERSX_NAMESPACE,
  WALLETCONNECT_SIGN_LOGIN_DELAY,
} from "./constants";
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
  isValidSignature,
  ConnectParamsTypes,
  TransactionResponse,
  sleep,
} from "./utils";
import { getSharedClient } from "./clientCache";

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
  Operation,
  OptionalOperation,
};

export interface IProviderAccount {
  address: string;
  signature?: string;
}

export type WalletConnectV2ProviderOptionsType =
  | SignClientTypes.Options
  | undefined;

export class WalletConnectV2Provider {
  walletConnectV2Relay: string;
  walletConnectV2ProjectId: string;
  chainId: string = "";
  isInitializing: boolean = false;
  walletConnector: Client | undefined;
  session: SessionTypes.Struct | undefined;
  pairings: PairingTypes.Struct[] | undefined;
  processingTopic: string = "";
  options: WalletConnectV2ProviderOptionsType = {};

  private onClientConnect: IClientConnect;
  private account: IProviderAccount = { address: "" };
  private initPromise: Promise<boolean> | null = null;
  private isLoggingIn: boolean = false;
  private subscribedClient: Client | undefined;

  constructor(
    onClientConnect: IClientConnect,
    chainId: string,
    walletConnectV2Relay: string,
    walletConnectV2ProjectId: string,
    options?: SignClientTypes.Options,
  ) {
    this.onClientConnect = onClientConnect;
    this.chainId = chainId;
    this.walletConnectV2Relay = walletConnectV2Relay;
    this.walletConnectV2ProjectId = walletConnectV2ProjectId;
    this.options = options;
  }

  /**
   * Clears the account and session state.
   * Keeps the WalletConnect client, so the next connect() reuses it instead of creating a new one.
   */
  private resetSession() {
    this.account = { address: "", signature: "" };
    this.session = undefined;
    this.pairings = undefined;
  }

  /**
   * Initiates WalletConnect client.
   * The client is shared by all providers on the page (see getSharedClient),
   * and concurrent calls wait for the same initialization.
   */
  async init(): Promise<boolean> {
    if (this.isInitialized()) {
      return true;
    }

    if (!this.initPromise) {
      this.initPromise = this.initializeClient().finally(() => {
        this.initPromise = null;
      });
    }

    return this.initPromise;
  }

  private async initializeClient(): Promise<boolean> {
    this.isInitializing = true;

    try {
      const metadata = this.options?.metadata
        ? {
            metadata: getMetadata(this.options?.metadata),
          }
        : {};

      const client = await getSharedClient({
        ...this.options,
        relayUrl: this.walletConnectV2Relay,
        projectId: this.walletConnectV2ProjectId,
        ...metadata,
      });

      this.walletConnector = client;
      this.isInitializing = false;

      this.subscribeToEvents(client);
      await this.checkPersistedState(client);
    } catch (error) {
      Logger.error(WalletConnectV2ProviderErrorMessagesEnum.unableToInit);
    } finally {
      this.isInitializing = false;
    }

    return this.isInitialized();
  }

  /**
   * Detaches this provider from the shared WalletConnect client.
   * Call it when the provider is discarded, so its callbacks stop receiving session events.
   * It doesn't disconnect the WalletConnect session (use logout() for that).
   */
  destroy(): void {
    this.unsubscribeFromEvents();
    this.resetSession();
    this.walletConnector = undefined;
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
  isConnected(): boolean {
    return Boolean(this.isInitialized() && typeof this.session !== "undefined");
  }

  /**
   * Returns the current account
   */
  getAccount(): IProviderAccount | null {
    return this.account;
  }

  /**
   * Sets the current account
   * @param account
   */
  setAccount(account: IProviderAccount): void {
    this.account = account;
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
      if (options?.topic) {
        try {
          this.walletConnector.core?.expirer?.set(options.topic, 0);
        } catch (error) {
          Logger.error(
            WalletConnectV2ProviderErrorMessagesEnum.unableToHandleCleanup,
          );
        }
      }

      this.resetSession();
      Logger.error(
        options?.topic
          ? WalletConnectV2ProviderErrorMessagesEnum.unableToConnectExisting
          : WalletConnectV2ProviderErrorMessagesEnum.unableToConnect,
      );

      throw new Error(
        options?.topic
          ? WalletConnectV2ProviderErrorMessagesEnum.unableToConnectExisting
          : WalletConnectV2ProviderErrorMessagesEnum.unableToConnect,
      );
    }
  }

  async login(options?: {
    approval?: () => Promise<SessionTypes.Struct>;
    token?: string;
  }): Promise<IProviderAccount | null> {
    if (typeof this.walletConnector === "undefined") {
      throw new Error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
    }

    // Kept separate from isInitializing, so isInitialized() stays true while waiting for approval
    this.isLoggingIn = true;

    if (typeof this.session !== "undefined") {
      await this.logout({ topic: this.session?.topic });
    }

    try {
      if (options && options.approval) {
        const session = await options.approval();

        if (options.token) {
          await sleep(WALLETCONNECT_SIGN_LOGIN_DELAY); // Delay the sign login token action to allow the UI to update properly
          const address = getAddressFromSession(session, this.chainId);

          if (!address) {
            Logger.error(
              WalletConnectV2ProviderErrorMessagesEnum.invalidAddress,
            );
            throw new Error(
              WalletConnectV2ProviderErrorMessagesEnum.invalidAddress,
            );
          }

          const selectedNamespace =
            session.namespaces[WALLETCONNECT_MULTIVERSX_NAMESPACE];
          const method = selectedNamespace.methods.includes(
            OptionalOperation.SIGN_NATIVE_AUTH_TOKEN,
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
              WalletConnectV2ProviderErrorMessagesEnum.unableToSignLoginToken,
            );
            throw new Error(
              WalletConnectV2ProviderErrorMessagesEnum.unableToSignLoginToken,
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
      this.resetSession();
      Logger.error(WalletConnectV2ProviderErrorMessagesEnum.unableToLogin);
      throw new Error(WalletConnectV2ProviderErrorMessagesEnum.unableToLogin);
    } finally {
      this.isLoggingIn = false;
    }

    return null;
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
          this.walletConnector,
        );
        this.processingTopic = currentSessionTopic;
        await this.walletConnector.disconnect({
          topic: currentSessionTopic,
          reason: getSdkError("USER_DISCONNECTED"),
        });

        this.resetSession();

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
  getAddress(): string {
    if (typeof this.walletConnector === "undefined") {
      Logger.error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
      throw new Error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
    }

    return this.account.address;
  }

  /**
   * Fetches the WalletConnect signature
   */
  getSignature(): string | undefined {
    if (typeof this.walletConnector === "undefined") {
      Logger.error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
      throw new Error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
    }

    return this.account.signature;
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
  async signMessage(messageToSign: Message): Promise<Message> {
    const message = new Message({
      data: Buffer.from(messageToSign.data),
      address:
        messageToSign.address ?? Address.newFromBech32(this.account.address),
      signer: "wallet-connect-v2",
      version: messageToSign.version,
    });

    if (typeof this.walletConnector === "undefined") {
      Logger.error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
      throw new Error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
    }

    if (typeof this.session === "undefined") {
      Logger.error(
        WalletConnectV2ProviderErrorMessagesEnum.sessionNotConnected,
      );
      this.onClientConnect.onClientLogout();
      throw new Error(
        WalletConnectV2ProviderErrorMessagesEnum.sessionNotConnected,
      );
    }

    try {
      const address = this.getAddress();
      const { signature }: { signature: string } =
        await this.walletConnector.request({
          chainId: `${WALLETCONNECT_MULTIVERSX_NAMESPACE}:${this.chainId}`,
          topic: getCurrentTopic(this.chainId, this.walletConnector),
          request: {
            method: Operation.SIGN_MESSAGE,
            params: {
              address,
              message: message.data.toString(),
            },
          },
        });

      if (!signature) {
        Logger.error(
          WalletConnectV2ProviderErrorMessagesEnum.invalidMessageResponse,
        );
        throw new Error(
          WalletConnectV2ProviderErrorMessagesEnum.invalidMessageResponse,
        );
      }

      if (!isValidSignature(signature)) {
        Logger.error(
          WalletConnectV2ProviderErrorMessagesEnum.invalidMessageSignature,
        );
        throw new Error(
          WalletConnectV2ProviderErrorMessagesEnum.invalidMessageSignature,
        );
      }

      message.signature = Buffer.from(signature, "hex");
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
        WalletConnectV2ProviderErrorMessagesEnum.sessionNotConnected,
      );
      this.onClientConnect.onClientLogout();
      throw new Error(
        WalletConnectV2ProviderErrorMessagesEnum.sessionNotConnected,
      );
    }

    const plainTransaction = transaction.toPlainObject();

    if (this.chainId !== transaction.chainID.valueOf()) {
      Logger.error(
        WalletConnectV2ProviderErrorMessagesEnum.requestDifferentChain,
      );
      throw new Error(
        WalletConnectV2ProviderErrorMessagesEnum.requestDifferentChain,
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
        WalletConnectV2ProviderErrorMessagesEnum.transactionError,
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
        WalletConnectV2ProviderErrorMessagesEnum.sessionNotConnected,
      );
      this.onClientConnect.onClientLogout();
      throw new Error(
        WalletConnectV2ProviderErrorMessagesEnum.sessionNotConnected,
      );
    }

    const plainTransactions = transactions.map((transaction) => {
      if (this.chainId !== transaction.chainID.valueOf()) {
        Logger.error(
          WalletConnectV2ProviderErrorMessagesEnum.requestDifferentChain,
        );
        throw new Error(
          WalletConnectV2ProviderErrorMessagesEnum.requestDifferentChain,
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
          WalletConnectV2ProviderErrorMessagesEnum.invalidTransactionResponse,
        );
        throw new Error(
          WalletConnectV2ProviderErrorMessagesEnum.invalidTransactionResponse,
        );
      }

      if (
        !Array.isArray(signatures) ||
        transactions.length !== signatures.length
      ) {
        throw new Error(
          WalletConnectV2ProviderErrorMessagesEnum.invalidTransactionResponse,
        );
      }

      for (const [index, transaction] of transactions.entries()) {
        const response = signatures[index];
        applyTransactionSignature({ transaction, response });
      }

      return transactions;
    } catch (error) {
      throw new Error(
        WalletConnectV2ProviderErrorMessagesEnum.transactionError,
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
        WalletConnectV2ProviderErrorMessagesEnum.sessionNotConnected,
      );
      this.onClientConnect.onClientLogout();
      throw new Error(
        WalletConnectV2ProviderErrorMessagesEnum.sessionNotConnected,
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
            WalletConnectV2ProviderErrorMessagesEnum.invalidCustomRequestResponse,
          );
        }
      } catch (error) {
        Logger.error(
          WalletConnectV2ProviderErrorMessagesEnum.invalidCustomRequestResponse,
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
        WalletConnectV2ProviderErrorMessagesEnum.sessionNotConnected,
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
      this.account.address = options.address;
      if (options.signature) {
        this.account.signature = options.signature;
      }
      this.onClientConnect.onClientLogin();

      return this.account.address;
    }

    Logger.error(
      `${WalletConnectV2ProviderErrorMessagesEnum.invalidAddress} ${options.address}`,
    );
    if (this.walletConnector) {
      await this.logout();
    }

    return "";
  }

  private async onSessionConnected(options?: {
    session: SessionTypes.Struct;
    signature?: string;
  }): Promise<IProviderAccount | null> {
    if (!options) {
      return null;
    }

    const address = getAddressFromSession(options.session, this.chainId);

    if (!address) {
      Logger.error(WalletConnectV2ProviderErrorMessagesEnum.invalidAddress);
      return null;
    }

    this.session = options.session;
    this.account.signature = options.signature || "";

    const loggedInAddress = await this.loginAccount({
      address,
      signature: options.signature,
    });

    if (!loggedInAddress) {
      return null;
    }

    return this.account;
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

  // Handlers are kept as fields so destroy() can remove them from the shared client
  private readonly onSessionUpdate = ({
    topic,
    params,
  }: SignClientTypes.EventArguments["session_update"]) => {
    if (!this.walletConnector || this.session?.topic !== topic) {
      return;
    }

    const { namespaces } = params;
    const _session = this.walletConnector.session.get(topic);
    const updatedSession = { ..._session, namespaces };
    this.onSessionConnected({ session: updatedSession });
  };

  private readonly onSessionEvent = (
    args: SignClientTypes.EventArguments["session_event"],
  ) => this.handleSessionEvents(args);

  private readonly onSessionDelete = async ({
    topic,
  }: SignClientTypes.EventArguments["session_delete"]) => {
    if (this.isLoggingIn) {
      this.onClientConnect.onClientLogout();
      this.resetSession();
    }

    if (!this.session || this.session?.topic !== topic) {
      return;
    }

    Logger.error(WalletConnectV2ProviderErrorMessagesEnum.sessionDeleted);

    this.onClientConnect.onClientLogout();

    this.resetSession();
    await this.cleanupPendingPairings({ deletePairings: true });
  };

  private readonly onSessionExpire = async ({
    topic,
  }: SignClientTypes.EventArguments["session_expire"]) => {
    if (!this.session || this.session?.topic !== topic) {
      return;
    }

    Logger.error(WalletConnectV2ProviderErrorMessagesEnum.sessionExpired);
    this.onClientConnect.onClientLogout();

    this.resetSession();
    await this.cleanupPendingPairings({ deletePairings: true });
  };

  private subscribeToEvents(client: Client): void {
    if (this.subscribedClient === client) {
      return;
    }

    this.unsubscribeFromEvents();

    try {
      client.on("session_update", this.onSessionUpdate);
      client.on("session_event", this.onSessionEvent);
      client.on("session_delete", this.onSessionDelete);
      client.on("session_expire", this.onSessionExpire);
      this.subscribedClient = client;
    } catch (error) {
      Logger.error(
        WalletConnectV2ProviderErrorMessagesEnum.unableToHandleEvent,
      );
    }
  }

  private unsubscribeFromEvents(): void {
    const client = this.subscribedClient;
    this.subscribedClient = undefined;

    if (!client) {
      return;
    }

    try {
      client.off("session_update", this.onSessionUpdate);
      client.off("session_event", this.onSessionEvent);
      client.off("session_delete", this.onSessionDelete);
      client.off("session_expire", this.onSessionExpire);
    } catch (error) {
      Logger.error(
        WalletConnectV2ProviderErrorMessagesEnum.unableToHandleEvent,
      );
    }
  }

  private async checkPersistedState(
    client: Client,
  ): Promise<SessionTypes.Struct | undefined> {
    if (typeof client === "undefined") {
      throw new Error(WalletConnectV2ProviderErrorMessagesEnum.notInitialized);
    }

    this.pairings = await this.getPairings();

    if (typeof this.session !== "undefined") {
      return;
    }

    // Populates existing session to state (assume only the top one)
    if (
      client.session.length &&
      !this.account.address &&
      !this.isInitializing &&
      !this.isLoggingIn
    ) {
      const session = getCurrentSession(this.chainId, client);
      if (session) {
        await this.onSessionConnected({ session });

        return session;
      }
    }

    return;
  }

  private async cleanupPendingPairings(
    options: { deletePairings?: boolean } = {},
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
              pairing.topic,
            );
          } catch (error) {
            Logger.error(
              WalletConnectV2ProviderErrorMessagesEnum.unableToHandleCleanup,
            );
          }
        }
      }
    } catch (error) {
      Logger.error(
        WalletConnectV2ProviderErrorMessagesEnum.unableToHandleCleanup,
      );
    }
  }
}
