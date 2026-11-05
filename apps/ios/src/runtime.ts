import * as SecureStore from "expo-secure-store";
import { Session } from "./session";

const key = "turtle.session.v1";
// The token stays available to this device after first unlock, including during a call.
const options = { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY };
export const session = new Session({
  read: () => SecureStore.getItemAsync(key, options),
  write: value => SecureStore.setItemAsync(key, value, options),
  remove: () => SecureStore.deleteItemAsync(key, options),
});
