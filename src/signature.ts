import { ISignature } from "./interface";

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
