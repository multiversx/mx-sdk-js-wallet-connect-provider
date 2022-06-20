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

  toPlainObject(sender?: IAddress): any;

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
  message: Buffer;
  applySignature(signature: ISignature, signedBy: IAddress): void;
}
