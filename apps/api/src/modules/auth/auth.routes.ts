import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from "fastify";

import { AuthError, AuthService } from "./auth.service.js";
import type { AuthResponse, AuthTokens } from "./auth.types.js";
import { loginSchema, logoutSchema, refreshSchema } from "./auth.schema.js";
import { getCookieValue } from "../../plugins/auth.js";

export const authRoutes: FastifyPluginCallback = (fastify, _options, done) => {
  const authService = new AuthService(fastify);

  fastify.post("/api/auth/login", async (request, reply) => {
    const input = loginSchema.parse(request.body);
    return handleAuth(reply, async () => {
      const auth = await authService.login(input);
      setAuthCookies(reply, auth.tokens);
      return toAuthBody(auth);
    });
  });

  fastify.post("/api/auth/refresh", async (request, reply) => {
    return handleAuth(reply, async () => {
      const input = refreshSchema.parse({
        refreshToken: getCookieValue(request.headers.cookie, "refresh_token") ?? readBodyRefreshToken(request),
      });
      const auth = await authService.refresh(input);
      setAuthCookies(reply, auth.tokens);
      return toAuthBody(auth);
    });
  });

  fastify.post("/api/auth/logout", async (request, reply) => {
    return handleAuth(reply, async () => {
      const input = logoutSchema.parse({
        refreshToken: getCookieValue(request.headers.cookie, "refresh_token") ?? readBodyRefreshToken(request),
      });
      await authService.logout(input);
      clearAuthCookies(reply);
      return { status: "ok" };
    });
  });
  done();
};

async function handleAuth<T>(reply: FastifyReply, handler: () => Promise<T>): Promise<T | undefined> {
  try {
    return await handler();
  } catch (error) {
    if (error instanceof AuthError) {
      return reply.status(error.statusCode).send({ error: error.message });
    }

    throw error;
  }
}

function toAuthBody(auth: AuthResponse) {
  return {
    user: auth.user,
  };
}

function setAuthCookies(reply: FastifyReply, tokens: AuthTokens): void {
  reply.header("Set-Cookie", [
    serializeCookie("access_token", tokens.accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      path: "/",
      maxAge: 15 * 60,
    }),
    serializeCookie("refresh_token", tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      path: "/api/auth",
      maxAge: 30 * 24 * 60 * 60,
    }),
  ]);
}

function clearAuthCookies(reply: FastifyReply): void {
  reply.header("Set-Cookie", [
    serializeCookie("access_token", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      path: "/",
      maxAge: 0,
    }),
    serializeCookie("refresh_token", "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "Strict",
      path: "/api/auth",
      maxAge: 0,
    }),
  ]);
}

function serializeCookie(
  name: string,
  value: string,
  options: {
    httpOnly: boolean;
    secure: boolean;
    sameSite: "Strict" | "Lax" | "None";
    path: string;
    maxAge: number;
  },
): string {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${String(options.maxAge)}`,
    `Path=${options.path}`,
    `SameSite=${options.sameSite}`,
  ];

  if (options.httpOnly) {
    parts.push("HttpOnly");
  }

  if (options.secure) {
    parts.push("Secure");
  }

  return parts.join("; ");
}

function readBodyRefreshToken(request: FastifyRequest): string | undefined {
  if (typeof request.body !== "object" || request.body === null || !("refreshToken" in request.body)) {
    return undefined;
  }

  const refreshToken = request.body.refreshToken;
  return typeof refreshToken === "string" ? refreshToken : undefined;
}
