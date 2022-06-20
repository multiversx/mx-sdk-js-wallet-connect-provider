import { IAddress } from "./interface";
import { ISignature } from "./interface";

export class Address implements IAddress {
  private readonly value: string;

  public constructor(value: string) {
    this.value = value;
  }

  bech32(): string {
    return this.value;
  }
}

export class Signature implements ISignature {
  private readonly buffer: Buffer;

  constructor(buffer: Buffer) {
    this.buffer = buffer;
  }

  static fromHex(hex: string) {
    return new Signature(Buffer.from(hex, "hex"));
  }

  hex() {
    return this.buffer.toString("hex");
  }
}
