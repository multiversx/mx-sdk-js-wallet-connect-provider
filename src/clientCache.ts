import Client from "@walletconnect/sign-client";
import { SignClientTypes } from "@walletconnect/types";

const sharedClients = new Map<string, Promise<Client>>();

const getClientKey = (options: SignClientTypes.Options) =>
  [
    options.projectId ?? "",
    options.relayUrl ?? "",
    options.customStoragePrefix ?? "",
  ].join("|");

/**
 * Returns one WalletConnect SignClient per page for the same project, relay and storage prefix.
 *
 * Every `Client.init()` creates a new WalletConnect Core
 *
 * The init promise is cached, so concurrent callers wait for the same client.
 * A failed init is removed from the cache so the next call can retry.
 * The first caller's options (metadata, storage, logger) are the ones used.
 */
export function getSharedClient(
  options: SignClientTypes.Options,
): Promise<Client> {
  const key = getClientKey(options);
  const existingClient = sharedClients.get(key);

  if (existingClient) {
    return existingClient;
  }

  const clientPromise = Client.init(options);
  sharedClients.set(key, clientPromise);

  clientPromise.catch(() => {
    if (sharedClients.get(key) === clientPromise) {
      sharedClients.delete(key);
    }
  });

  return clientPromise;
}
