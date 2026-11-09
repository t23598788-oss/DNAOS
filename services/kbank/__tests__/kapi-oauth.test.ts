import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { getKBankAccessToken, isTokenValid, clearKBankTokenCache } from "../kapi-oauth";

function createFetchMock(responses: Array<{ status: number; body: string }>) {
  let index = 0;
  return vi.fn(async () => {
    const r = responses[index % responses.length];
    index += 1;
    const res = new Response(r.body, { status: r.status });
    return Promise.resolve(res);
  });
}

describe("services/kbank/kapi-oauth", () => {
  let origEnv: NodeJS.ProcessEnv;
  let fetchMock: ReturnType<typeof createFetchMock>;

  beforeEach(() => {
    origEnv = { ...process.env };
    clearKBankTokenCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    Object.assign(process.env, origEnv);
    clearKBankTokenCache();
  });

  describe("getKBankAccessToken", () => {
    it("fetches token from correct URL with correct headers", async () => {
      process.env.KBANK_KGP_BASE_URL = "https://openapi.sandbox.kasikornbank.com";
      process.env.KBANK_KGP_CONSUMER_ID = "cid";
      process.env.KBANK_KGP_CONSUMER_SECRET = "csecret";
      process.env.KBANK_KGP_ENV_ID = "mpp-paycard";
      fetchMock = createFetchMock([{ status: 200, body: JSON.stringify({ access_token: "t1", token_type: "Bearer", expires_in: 3600 }) }]);
      vi.stubGlobal("fetch", fetchMock);
      await getKBankAccessToken("kbiz");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const call = fetchMock.mock.calls[0] as unknown as [RequestInfo, RequestInit];
      const url = call[0];
      const opts = call[1] as RequestInit;
      const headers = opts.headers instanceof Headers ? opts.headers : new Headers(opts.headers);
      expect(headers.get("Authorization")).toBe("Basic Y2lkOmNzZWNyZXQ=");
      expect(headers.get("x-test-mode")).toBe("true");
      expect(headers.get("env-id")).toBe("mpp-paycard");
      expect(opts.body).toContain("grant_type=client_credentials");
      expect(url).toBe("https://openapi.sandbox.kasikornbank.com/v2/oauth/token");
    });

    it("caches token on second call (no second fetch)", async () => {
      process.env.KBANK_KGP_BASE_URL = "https://openapi.sandbox.kasikornbank.com";
      process.env.KBANK_KGP_CONSUMER_ID = "cid";
      process.env.KBANK_KGP_CONSUMER_SECRET = "csecret";
      process.env.KBANK_KGP_ENV_ID = "mpp-paycard";
      fetchMock = createFetchMock([{ status: 200, body: JSON.stringify({ access_token: "t1", token_type: "Bearer", expires_in: 3600 }) }]);
      vi.stubGlobal("fetch", fetchMock);
      const result1 = await getKBankAccessToken("kbiz");
      const result2 = await getKBankAccessToken("kbiz");
      expect(result1).toBe(result2);
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("refreshes token when expired", async () => {
      process.env.KBANK_KGP_BASE_URL = "https://openapi.sandbox.kasikornbank.com";
      process.env.KBANK_KGP_CONSUMER_ID = "cid";
      process.env.KBANK_KGP_CONSUMER_SECRET = "csecret";
      process.env.KBANK_KGP_ENV_ID = "mpp-paycard";
      fetchMock = createFetchMock([{ status: 200, body: JSON.stringify({ access_token: "t1", token_type: "Bearer", expires_in: 3600 }) }]);
      vi.stubGlobal("fetch", fetchMock);
      const call1 = fetchMock.mock.calls.length;
      await getKBankAccessToken("kbiz");
      const originalNow = Date.now;
      Date.now = () => originalNow() + 3700 * 1000;
      try {
        const call2 = fetchMock.mock.calls.length;
        await getKBankAccessToken("kbiz");
        expect(call2).toBe(call1 + 1);
      } finally {
        Date.now = originalNow;
      }
    });

    it("throws when env vars missing", async () => {
      const envBackup = { ...process.env };
      delete process.env.KBANK_KGP_BASE_URL;
      delete process.env.KBANK_KGP_CONSUMER_ID;
      delete process.env.KBANK_KGP_CONSUMER_SECRET;
      delete process.env.KBANK_KGP_ENV_ID;
      try {
        await expect(getKBankAccessToken("kbiz")).rejects.toThrow("KBank credentials not configured for: kbiz");
      } finally {
        Object.assign(process.env, envBackup);
        clearKBankTokenCache();
      }
    });

    it("throws on non-200 response", async () => {
      fetchMock = createFetchMock([{ status: 500, body: "boom" }]);
      vi.stubGlobal("fetch", fetchMock);
      process.env.KBANK_KGP_BASE_URL = "https://openapi.sandbox.kasikornbank.com";
      process.env.KBANK_KGP_CONSUMER_ID = "cid";
      process.env.KBANK_KGP_CONSUMER_SECRET = "csecret";
      process.env.KBANK_KGP_ENV_ID = "mpp-paycard";
      vi.stubGlobal("fetch", fetchMock);
      await expect(getKBankAccessToken("kplus")).rejects.toThrow("KBank OAuth failed: 500");
    });

    it("returns a token string", async () => {
      process.env.KBANK_KGP_BASE_URL = "https://openapi.sandbox.kasikornbank.com";
      process.env.KBANK_KGP_CONSUMER_ID = "cid";
      process.env.KBANK_KGP_CONSUMER_SECRET = "csecret";
      process.env.KBANK_KGP_ENV_ID = "mpp-paycard";
      fetchMock = createFetchMock([{ status: 200, body: JSON.stringify({ access_token: "t1", token_type: "Bearer", expires_in: 3600 }) }]);
      vi.stubGlobal("fetch", fetchMock);
      const token = await getKBankAccessToken("truemoney");
      expect(typeof token).toBe("string");
      expect(token.length).toBeGreaterThan(0);
    });
  });

  describe("isTokenValid", () => {
    it("returns false when no token", () => {
      expect(isTokenValid("kbiz")).toBe(false);
    });

    it("returns true when token not expired", async () => {
      const envBackup = { ...process.env };
      process.env.KBANK_KGP_BASE_URL = "https://openapi.sandbox.kasikornbank.com";
      process.env.KBANK_KGP_CONSUMER_ID = "cid";
      process.env.KBANK_KGP_CONSUMER_SECRET = "csecret";
      process.env.KBANK_KGP_ENV_ID = "mpp-paycard";
      vi.stubGlobal("fetch", vi.fn());
      const originalNow = Date.now;
      Date.now = () => originalNow() + 60 * 1000;
      try {
        await getKBankAccessToken("kbiz");
        expect(isTokenValid("kbiz")).toBe(true);
      } finally {
        Date.now = originalNow;
        Object.assign(process.env, envBackup);
        clearKBankTokenCache();
      }
    });

    it("returns false when token expired", () => {
      const envBackup = { ...process.env };
      process.env.KBANK_KGP_BASE_URL = "https://openapi.sandbox.kasikornbank.com";
      process.env.KBANK_KGP_CONSUMER_ID = "cid";
      process.env.KBANK_KGP_CONSUMER_SECRET = "csecret";
      process.env.KBANK_KGP_ENV_ID = "mpp-paycard";
      vi.stubGlobal("fetch", vi.fn());
      try {
        expect(isTokenValid("kbiz")).toBe(false);
      } finally {
        Object.assign(process.env, envBackup);
        clearKBankTokenCache();
      }
    });
  });
});
