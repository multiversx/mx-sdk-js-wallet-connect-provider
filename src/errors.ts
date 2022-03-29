/**
 * The base class for exceptions (errors).
 */
 export class Err extends Error {
    inner: Error | undefined = undefined;

    public constructor(message: string, inner?: Error) {
        super(message);
        this.inner = inner;
    }
}

/**
 * Signals that a method is not yet implemented
 */
export class ErrNotImplemented extends Err {
    public constructor() {
        super("Method not yet implemented");
    }
}

/**
 * Signals a bad address.
 */
 export class ErrBadAddress extends Err {
    public constructor(value: string, inner?: Error) {
        super(`Bad address: ${value}`, inner);
    }
}
