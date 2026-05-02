import jwt from "@fastify/jwt";
import type { FastifyInstance, FastifyRequest } from "fastify";
import fp from "fastify-plugin";

import { getEnv } from "../config/env.js";

export const authPlugin = fp(async (fastify) => {
  const env = getEnv();

  await fastify.register(jwt, {
    secret: env.jwtSecret,
  });

  fastify.decorate("authenticate", async (request, reply) => {
    try {
      verifyRequestJwt(fastify, request);
    } catch {
      await reply.status(401).send({ error: "Unauthorized" });
    }
  });
});

export function verifyRequestJwt(fastify: FastifyInstance, request: FastifyRequest): void {
  const token = getBearerToken(request) ?? getCookieValue(request.headers.cookie, "access_token");

  if (!token) {
    throw new Error("Missing access token");
  }

  request.user = fastify.jwt.verify(token);
}

export function getCookieValue(cookieHeader: string | undefined, name: string): string | undefined {
  if (!cookieHeader) {
    return undefined;
  }

  const cookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name}=`));

  if (!cookie) {
    return undefined;
  }

  return decodeURIComponent(cookie.slice(name.length + 1));
}

function getBearerToken(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization;
  const match = /^Bearer\s+(.+)$/i.exec(header ?? "");
  return match?.[1];
}
