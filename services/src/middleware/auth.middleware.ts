import { verifyToken } from "@clerk/backend";
import { RequestHandler } from "express";
import { asyncHandler } from "../utils/async-handler.js";
import { ApiError } from "../utils/api-error.js";
import { env } from "../config/env.js";
import {
  ACCOUNT_AUTH_CACHE_TTL_SECONDS,
  getAccountAuthCacheKey,
} from "../config/constants.js";
import { redis } from "../config/redis.js";
import { db } from "../database/client.js";
import { accounts } from "../database/schema.js";
import { and, eq } from "drizzle-orm";

const accountRoles = ["client", "freelancer"] as const;
type AccountRole = (typeof accountRoles)[number];

interface CachedAccountAuth {
  userId: string;
  role: "client" | "freelancer";
  accountExists: boolean;
  isOnboarded: boolean;
}

const isAccountRole = (value: unknown): value is AccountRole =>
  typeof value === "string" &&
  accountRoles.some((accountRole) => accountRole === value);

export const getBearerToken = (authorizationHeader: string | undefined) => {
  if (!authorizationHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authorizationHeader?.slice("Bearer ".length).trim();
  return token || null;
};

const isCachedAccountAuth = (
  value: unknown,
  userId: string,
  role: AccountRole,
): value is CachedAccountAuth => {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const cached = value as Record<string, unknown>;

  return (
    cached.userId === userId &&
    cached.role === role &&
    typeof cached.accountExists === "boolean" &&
    typeof cached.isOnboarded === "boolean"
  );
};

const isAccountAvailable = async (
  requestedRole: "client" | "freelancer",
  userId: string,
): Promise<CachedAccountAuth> => {
  const cacheKey = getAccountAuthCacheKey(userId, requestedRole);
  // const cachedValue = await redis.get(cacheKey);

  // if (cachedValue) {
  //   await redis.expire(cacheKey, ACCOUNT_AUTH_CACHE_TTL_SECONDS);
  //   return JSON.parse(cachedValue) as CachedAccountAuth;
  // }

  // 1. Try Redis. A Redis failure must not prevent the DB lookup.
  try {
    const cachedValue = await redis.get(cacheKey);

    if (cachedValue) {
      await redis.expire(cacheKey, ACCOUNT_AUTH_CACHE_TTL_SECONDS);

      const parsed: unknown = JSON.parse(cachedValue);

      if (isCachedAccountAuth(parsed, userId, requestedRole)) {
        return parsed;
      }

      // Malformed or unexpected cached data: discard it.
      await redis.del(cacheKey);
    }
  } catch (error) {
    console.warn("Redis cache read failed; falling back to PostgreSQL.", error);
  }

  // 2. Cache miss, malformed cache, or Redis failure: query PostgreSQL.
  const databaseRole = requestedRole === "client" ? "CLIENT" : "FREELANCER";

  const [account] = await db
    .select({ isOnboardingComplete: accounts.isOnboardingComplete })
    .from(accounts)
    .where(and(eq(accounts.auth_id, userId), eq(accounts.role, databaseRole)))
    .limit(1);

  const accountAuth: CachedAccountAuth = {
    userId,
    accountExists: Boolean(account),
    role: requestedRole,
    isOnboarded: account?.isOnboardingComplete === true,
  };

  // 3. Cache the result, but don't fail authorization if caching fails.
  try {
    await redis.setEx(
      cacheKey,
      ACCOUNT_AUTH_CACHE_TTL_SECONDS,
      JSON.stringify(accountAuth),
    );
  } catch (error) {
    console.warn("Redis cache write failed.", error);
  }

  return accountAuth;
};

export const authenticateAccount = async (
  token: unknown,
  requestedRole: unknown,
) => {
  if (typeof token !== "string" || !token) {
    throw new ApiError(401, "Authentication token is required.");
  }
  if (!isAccountRole(requestedRole)) {
    throw new ApiError(400, "A valid account role is required.");
  }
  if (!env.clerkSecretKey) {
    throw new ApiError(503, "Authentication is not configured.");
  }

  try {
    const claims = await verifyToken(token, { secretKey: env.clerkSecretKey });
    return {
      ...(await isAccountAvailable(requestedRole, claims.sub)),
      sessionId: typeof claims.sid === "string" ? claims.sid : undefined,
    };
  } catch (error) {
    console.error("JWT verification failed:", error);
    if (error instanceof ApiError) throw error;
    throw new ApiError(401, "Authentication token is invalid or expired.");
  }
};

export const isAuthenticated: RequestHandler = asyncHandler(
  async (request, _response, next) => {
    const token = getBearerToken(request?.headers.authorization);
    const requestedRole = request.body?.role ?? request?.query.role;

    if (!token) {
      throw new ApiError(401, "Please do login to access this API!");
    }

    if (!isAccountRole(requestedRole)) {
      throw new ApiError(400, "A valid account role is required.");
    }

    let claims: Awaited<ReturnType<typeof verifyToken>>;

    try {
      claims = await verifyToken(token, {
        secretKey: env.clerkSecretKey,
      });
    } catch (error) {
      console.error("JWT verification failed:", error);
      throw new ApiError(401, "Authentication token is invalid or expired.");
    }

    const accountAuth = await isAccountAvailable(requestedRole, claims.sub);

    request.auth = {
      userId: claims.sub,
      sessionId: typeof claims.sid === "string" ? claims.sid : undefined,
      role: requestedRole,
      accountExists: accountAuth.accountExists,
      isOnboarded: accountAuth.isOnboarded,
    };

    next();
  },
);
