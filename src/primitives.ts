import { IAddress } from "./interface";

export class Address implements IAddress {
  private readonly value: string;

  public constructor(value: string) {
    this.value = value;
  }

  bech32(): string {
    return this.value;
  }
}
