import * as bech32 from "bech32";
import { ErrBadAddress } from "./errors";
import { IAddress } from "./interface";

const HRP = "erd";

export class UserAddress implements IAddress {
    private readonly value: string;

    private constructor(value: string) {
        this.value = value;
    }

    static fromBech32(value: string): UserAddress {
        let decoded;

        try {
            decoded = bech32.decode(value);
        } catch (err: any) {
            throw new ErrBadAddress(value, err);
        }

        if (decoded.prefix != HRP) {
            throw new ErrBadAddress(value);
        }

        return new UserAddress(value);
    }

    bech32(): string {
        return this.value;
    }
}
