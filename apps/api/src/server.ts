import { buildServer } from "./app.js";
import { getEnv } from "./config/env.js";

const env = getEnv();
const server = await buildServer();

try {
  await server.listen({
    port: env.port,
    host: env.host,
  });
} catch (error) {
  server.log.error(error);
  process.exit(1);
}
