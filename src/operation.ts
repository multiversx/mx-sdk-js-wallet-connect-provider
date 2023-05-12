export enum Operation {
  SIGN_TRANSACTION = "mvx_signTransaction",
  SIGN_TRANSACTIONS = "mvx_signTransactions",
  SIGN_MESSAGE = "mvx_signMessage",
}

export enum OptionalOperation {
  SIGN_LOGIN_TOKEN = "mvx_signLoginToken",
  SIGN_NATIVE_AUTH_TOKEN = "mvx_signNativeAuthToken",
  CANCEL_ACTION = "mvx_cancelAction",
}
