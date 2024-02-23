import { Operation, OptionalOperation } from "./operation";

// WalletConnect Namespace for MultiversX
export const WALLETCONNECT_MULTIVERSX_NAMESPACE = "mvx";
// WalletConnect default methods for Multiversx
export const WALLETCONNECT_MULTIVERSX_METHODS = Object.values(Operation);
// WalletConnect optional methods for Multiversx
export const WALLETCONNECT_MULTIVERSX_OPTIONAL_METHODS =
  Object.values(OptionalOperation);
// Delay the sign login token action for 600ms to allow the relay to update properly
export const WALLETCONNECT_SIGN_LOGIN_DELAY = 600;
