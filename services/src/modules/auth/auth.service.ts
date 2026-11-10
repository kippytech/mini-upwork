import { createClerkClient } from "@clerk/backend";
import { env } from "../../config/env.js";
import { ApiError } from "../../utils/api-error.js";
import { db } from "../../database/client.js";
import { accounts } from "../../database/schema.js";
import { redis } from "../../config/redis.js";
import {
  ACCOUNT_AUTH_CACHE_TTL_SECONDS,
  getAccountAuthCacheKey,
} from "../../config/constants.js";
import { eq } from "drizzle-orm";

export interface SignupInput {
  userId: string;
  sessionId?: string;
  role: "client" | "freelancer";
  accountExists: boolean;
  isOnboarded: boolean;
}

const toDatabaseRole = (role: SignupInput["role"]): "CLIENT" | "FREELANCER" =>
  role === "client" ? "CLIENT" : "FREELANCER";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const getClerkUserWithRetry = async (
  clerk: ReturnType<typeof createClerkClient>,
  userId: string,
) => {
  const delaysMs = [300, 600];
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await clerk.users.getUser(userId);
    } catch (error) {
      if (attempt >= delaysMs.length) throw error;
      await sleep(delaysMs[attempt]!);
    }
  }
};

// export const receiveSignup = async (input: SignupInput): Promise<void> => {
//   if (input.accountExists) {
//     return;
//   }

//   const clerk = createClerkClient({ secretKey: env.clerkSecretKey });
//   const user = await getClerkUserWithRetry(clerk, input.userId);
//   const email =
//     user.primaryEmailAddress?.emailAddress ??
//     user.emailAddresses.at(0)?.emailAddress;

//   if (!email) {
//     throw new ApiError(400, "The authenticated account has no email address.");
//   }

//   const now = new Date();

//   await db
//     .insert(accounts)
//     .values({
//       auth_id: input.userId,
//       email,
//       role: toDatabaseRole(input.role),
//       identityVerified: false,
//       isOnboardingComplete: false,
//       created_at: now,
//       updated_at: now,
//     })
//     .onConflictDoNothing({
//       target: accounts.auth_id,
//     });

//   await redis.setEx(
//     getAccountAuthCacheKey(input.userId, input.role),
//     ACCOUNT_AUTH_CACHE_TTL_SECONDS,
//     JSON.stringify({
//       userId: input.userId,
//       role: input.role,
//       accountExists: true,
//       isOnboarded: false,
//     }),
//   );
// };

export const receiveSignup = async (input: SignupInput): Promise<void> => {
  const databaseRole = toDatabaseRole(input.role);

  // Check PostgreSQL first. Redis-derived accountExists isn't authoritative.
  const [existingAccount] = await db
    .select({
      id: accounts.id,
      role: accounts.role,
      isOnboardingComplete: accounts.isOnboardingComplete,
    })
    .from(accounts)
    .where(eq(accounts.auth_id, input.userId))
    .limit(1);

  if (existingAccount) {
    if (existingAccount.role !== databaseRole) {
      throw new ApiError(409, "An account already exists with a different role.");
    }

    await cacheAccountAuth(input.userId, input.role, {
      accountExists: true,
      isOnboarded: existingAccount.isOnboardingComplete!,
    });

    return;
  }

  const clerk = createClerkClient({ secretKey: env.clerkSecretKey });
  const user = await getClerkUserWithRetry(clerk, input.userId);

  const email =
    user.primaryEmailAddress?.emailAddress ??
    user.emailAddresses.at(0)?.emailAddress;

  if (!email) {
    throw new ApiError(400, "The authenticated account has no email address.");
  }

  await db
    .insert(accounts)
    .values({
      auth_id: input.userId,
      email,
      role: databaseRole,
      identityVerified: false,
      isOnboardingComplete: false,
    })
    .onConflictDoNothing({
      target: accounts.auth_id //target: [accounts.auth_id, accounts.role], 
    });

  // Re-read because another concurrent signup could have inserted first.
  const [account] = await db
    .select({
      role: accounts.role,
      isOnboardingComplete: accounts.isOnboardingComplete,
    })
    .from(accounts)
    .where(eq(accounts.auth_id, input.userId))
    .limit(1);

  if (!account || account.role !== databaseRole) {
    throw new ApiError(409, "Unable to create the requested account.");
  }

  await cacheAccountAuth(input.userId, input.role, {
    accountExists: true,
    isOnboarded: account.isOnboardingComplete!,
  });
};

const cacheAccountAuth = async (
  userId: string,
  role: "client" | "freelancer",
  account: {
    accountExists: boolean;
    isOnboarded: boolean;
  },
): Promise<void> => {
  try {
    await redis.setEx(
      getAccountAuthCacheKey(userId, role),
      ACCOUNT_AUTH_CACHE_TTL_SECONDS,
      JSON.stringify({
        userId,
        role,
        ...account,
      }),
    );
  } catch (error) {
    console.error("Failed to cache account authorization state.", error);
  }
};