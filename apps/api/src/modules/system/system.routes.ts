import type { FastifyPluginCallback } from "fastify";

export const systemRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  fastify.get("/api/version", { config: { isPublic: true } }, () => {
    return {
      commit: process.env.DEPLOY_SHA ?? "unknown",
      branch: process.env.DEPLOY_BRANCH ?? "unknown",
      buildTime: process.env.DEPLOY_TIME ?? "unknown",
      env: process.env.NODE_ENV ?? "unknown",
      app: "BizBil API",
      version: process.env.npm_package_version ?? "1.0.0",
    };
  });

  done();
};

export default systemRoutes;
