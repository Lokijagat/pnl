import { NonRetryableError } from "../../jobs/queue";
import type { LoadedIntegration } from "../../services/integrationCreds";

export class ShopifyError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
  extensions?: { cost?: { throttleStatus?: { currentlyAvailable: number; restoreRate: number } } };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function normalizeShopDomain(input: string) {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}

export class ShopifyClient {
  readonly shop: string;
  private token: string;
  private version: string;

  constructor(integ: LoadedIntegration) {
    const shop = integ.config.shopDomain;
    const token = integ.secrets.adminAccessToken;
    if (!shop || !token) throw new NonRetryableError("Shopify shop domain / access token missing");
    this.shop = normalizeShopDomain(shop);
    this.token = token;
    this.version = integ.config.apiVersion || "2025-10";
  }

  /** GraphQL call with throttle-aware retry */
  async gql<T>(query: string, variables: Record<string, unknown> = {}, attempt = 0): Promise<T> {
    let res: Response;
    try {
      // SHOPIFY_API_BASE_OVERRIDE: sirf local testing (mock server) ke liye; production mein set mat karo
      const base = process.env.NODE_ENV !== "production" && process.env.SHOPIFY_API_BASE_OVERRIDE
        ? process.env.SHOPIFY_API_BASE_OVERRIDE
        : `https://${this.shop}`;
      res = await fetch(`${base}/admin/api/${this.version}/graphql.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": this.token },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      if (attempt < 3) {
        await sleep(2000 * (attempt + 1));
        return this.gql(query, variables, attempt + 1);
      }
      throw new ShopifyError(`Shopify se connect nahi ho paaya: ${(err as Error).message}`);
    }

    if (res.status === 401 || res.status === 403) {
      throw new NonRetryableError("Shopify ne token reject kiya (401/403) — access token / scopes check karo");
    }
    if (res.status === 404) throw new NonRetryableError("Shop nahi mila — shop domain check karo");
    if (res.status === 429 || res.status >= 500) {
      if (attempt < 5) {
        const retryAfter = Number(res.headers.get("Retry-After")) || 2 * (attempt + 1);
        await sleep(retryAfter * 1000);
        return this.gql(query, variables, attempt + 1);
      }
      throw new ShopifyError(`Shopify HTTP ${res.status}`, res.status);
    }

    const body = (await res.json()) as GraphQLResponse<T>;
    if (body.errors?.length) {
      const throttled = body.errors.some((e) => e.extensions?.code === "THROTTLED");
      if (throttled && attempt < 8) {
        await sleep(2000 * (attempt + 1));
        return this.gql(query, variables, attempt + 1);
      }
      const accessDenied = body.errors.some((e) => e.extensions?.code === "ACCESS_DENIED");
      const msg = body.errors.map((e) => e.message).join("; ");
      if (accessDenied) throw new NonRetryableError(`Shopify access denied — scopes check karo: ${msg}`);
      throw new ShopifyError(msg);
    }

    // bucket khali hone wala ho to thoda ruko
    const t = body.extensions?.cost?.throttleStatus;
    if (t && t.currentlyAvailable < 200) await sleep(1000);

    if (!body.data) throw new ShopifyError("Shopify empty response");
    return body.data;
  }
}
