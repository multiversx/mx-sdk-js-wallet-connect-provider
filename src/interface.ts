export interface IDappProvider {
    init(): Promise<boolean>;
    login(options?: {callbackUrl?: string; token?: string; addressIndex?: number}): Promise<string>;
    logout(options?: {callbackUrl?: string}): Promise<boolean>;
    getAddress(): Promise<string>;
    isInitialized(): boolean;
    isConnected(): Promise<boolean>;
    signTransaction(transaction: ITransaction, options?: {callbackUrl?: string}): Promise<ITransaction>;
    signTransactions(transaction: Array<ITransaction>, options?: {callbackUrl?: string}): Promise<Array<ITransaction>>;
    signMessage(transaction: ISignableMessage, options?: {callbackUrl?: string}): Promise<ISignableMessage>;
}

export interface ISignature {
    hex(): string;
}

export interface IAddress {
    bech32(): string;
    toString(): string;
}

export interface ITransaction {
    getNonce(): INonce;
    getReceiver(): IAddress;
    getValue(): ITransactionValue;
    getGasPrice(): IGasPrice;
    getGasLimit(): IGasLimit;
    getData(): ITransactionData;
    getChainID(): IChainID;
    getVersion(): ITransactionVersion;

    applySignature(signature: ISignature, signedBy: IAddress): void;
}

export interface INonce {
    valueOf(): number;
}

export interface ITransactionValue {
    toString(): string;
}

export interface IGasPrice {
    valueOf(): number;
}

export interface IGasLimit {
    valueOf(): number;
}

export interface ITransactionData {
    toString(): string;
}

export interface IChainID {
    valueOf(): string;
}

export interface ITransactionVersion {
    valueOf(): number;
}

export interface ISignableMessage {
    applySignature(signature: ISignature): void;
}
