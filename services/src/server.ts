import { createServer, type Server } from "node:http";
import { SERVICE_NAME } from "./config/constants.js";
import { env } from "./config/env.js";
import { app } from "./app.js";
import { connectRedis, disconnectRedis } from "./config/redis.js";
import { disconnectNats } from "./config/nats.js";
import {
  startNotificationConsumer,
  stopNotificationConsumer,
} from "./events/consumer.js";
import { initializeMessagingSocket } from "./modules/messaging/messaging.socket.js";
import { startPayoutCron } from "./modules/payouts/payouts.cron.js";
import { closeDatabase } from "./database/client.js";

let server: Server | undefined;
let isShuttingDown = false;

const listen = (server: Server, port: number): Promise<void> =>
  new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, () => {
      server.off("error", reject);
      resolve();
    });
});

const start = async (): Promise<void> => {
  await connectRedis();
  await startNotificationConsumer();

  const httpServer = createServer(app);
  initializeMessagingSocket(httpServer);

  startPayoutCron();

  server = httpServer;

  await listen(httpServer, env.port);
  console.log(
    `${SERVICE_NAME} listening on http://localhost:${env.port} in ${env.nodeEnv} mode`,
  );
  // server.listen(env.port, () => {
  //   console.log(
  //     `${SERVICE_NAME} listening on http://localhost:${env.port} in ${env.nodeEnv} mode`,
  //   );
  // });
};

const closeHttpServer = async (): Promise<void> => {
  if (!server) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    server!.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
};

const cleanup = async (): Promise<void> => {
  await closeHttpServer();
  await stopNotificationConsumer();
  await disconnectNats();
  await disconnectRedis();
  await closeDatabase()
};

const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;
  console.log(`${signal} received. Closing services.`);

  try {
    await cleanup();
  } catch (error) {
    console.error("Failed to shut down cleanly.", error);
    process.exitCode = 1
  }
};

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));

void start().catch(async (error) => {
  console.error(`Failed to start ${SERVICE_NAME}.`, error);
  try {
    await cleanup();
  } catch (cleanupError) {
    console.error("Failed to clean up after startup failure.", cleanupError);
  }
  process.exitCode = 1
});
