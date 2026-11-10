import { createClient } from "redis";
import { env } from "./env.js";

let hasConnectedOnce = false;

export const redis = createClient({
  password: env.redis.password,
  database: env.redis.database,
  //disableOfflineQueue: true,
  socket: {
    host: env.redis.host,
    port: env.redis.port,
    reconnectStrategy: (retries, cause) => {
      // During initial startup, allow only 5 retries.
      if (!hasConnectedOnce && retries >= 5) {
        return new Error("Initial Redis connection failed.", {
          cause,
        });
      }

      // After the first successful connection, retry indefinitely
      const delay = Math.min(100 * 2 ** retries, 3_000);

      const jitter = Math.floor(Math.random() * 200);

      console.warn(
        `Redis reconnect attempt ${retries + 1} in ${delay + jitter}ms.`,
        cause.message,
      );

      return delay + jitter;
    },
  },
});

redis.on("ready", () => {
  hasConnectedOnce = true;
  console.log("Redis client ready.");
});

redis.on("error", (error) => {
  console.error("Redis client error.", error);
});

export const connectRedis = async (): Promise<void> => {
  if (!redis.isOpen) {
    await redis.connect();
  }

  await redis.ping();
  console.log(
    `Redis connected at ${env.redis.host}:${env.redis.port}/${env.redis.database}.`,
  );
};

export const disconnectRedis = async (): Promise<void> => {
  if (redis.isOpen) {
    await redis.close()  //quit();
  }
};
