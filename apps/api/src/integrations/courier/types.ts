import type { LoadedIntegration } from "../../services/integrationCreds";
import type { NormalizedShipment } from "./common";

export interface CourierAdapter {
  /** Credentials check; info integration.meta mein save hota hai */
  test(integ: LoadedIntegration): Promise<{ info?: Record<string, unknown> }>;
  /** `since` se shipments laao; har page par onPage (save + match) — returns count */
  sync(integ: LoadedIntegration, since: Date, onPage: (list: NormalizedShipment[]) => Promise<void>): Promise<number>;
}
