import { randomBytes } from "node:crypto";

import { hash, verify } from "@node-rs/argon2";
import type { FastifyInstance } from "fastify";

import { AuthRepository, type RefreshTokenWithUser, type UserWithTenant } from "./auth.repository.js";
import type { AuthResponse, AuthTokens, LoginInput, LogoutInput, RefreshInput, RegisterInput } from "./auth.types.js";

export class AuthError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export class AuthService {
  private readonly repository: AuthRepository;
  private readonly accessTokenExpiresIn: string;
  private readonly refreshTokenDays: number;

  constructor(private readonly fastify: FastifyInstance) {
    this.repository = new AuthRepository(fastify.prisma);
    this.accessTokenExpiresIn = process.env.JWT_EXPIRES_IN ?? "15m";
    this.refreshTokenDays = parseDays(process.env.REFRESH_TOKEN_EXPIRES_IN ?? "30d");
  }

  async register(input: RegisterInput): Promise<AuthResponse> {
    const passwordHash = await hashPassword(input.password);

    try {
      const user = await this.repository.createTenantWithOwner(input, passwordHash);
      return {
        user: toAuthUser(user),
        tokens: await this.createTokens(user),
      };
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new AuthError("Tenant slug or owner email already exists", 409);
      }

      throw error;
    }
  }

  async login(input: LoginInput): Promise<AuthResponse> {
    const user = await this.repository.findUserForLogin(input.tenantSlug, input.identifier);

    if (!user || !(await verify(user.passwordHash, input.password))) {
      throw new AuthError("Invalid username/email or password", 401);
    }

    if (user.tenant.status === "SUSPENDED") {
      throw new AuthError("Account suspended. Contact your RetailOS administrator to reactivate access.", 403);
    }

    return {
      user: toAuthUser(user),
      tokens: await this.createTokens(user),
    };
  }

  async refresh(input: RefreshInput): Promise<AuthResponse> {
    const parsed = parseRefreshToken(input.refreshToken);
    const storedToken = await this.repository.findRefreshToken(parsed.id);

    if (!isRefreshTokenUsable(storedToken) || !(await verify(storedToken.tokenHash, parsed.secret))) {
      throw new AuthError("Invalid refresh token", 401);
    }

    if (storedToken.tenant.status === "SUSPENDED") {
      throw new AuthError("Account suspended. Contact your RetailOS administrator to reactivate access.", 403);
    }

    await this.repository.revokeRefreshToken(storedToken.id);

    const user = {
      ...storedToken.user,
      tenant: {
        id: storedToken.tenantId,
        slug: "",
        status: storedToken.tenant.status,
      },
    };

    return {
      user: toAuthUser(user),
      tokens: await this.createTokens(user),
    };
  }

  async logout(input: LogoutInput): Promise<void> {
    if (!input.refreshToken) {
      return;
    }

    const parsed = parseRefreshToken(input.refreshToken);
    await this.repository.revokeRefreshToken(parsed.id);
  }

  private async createTokens(user: UserWithTenant): Promise<AuthTokens> {
    const refreshToken = await this.createRefreshToken(user);
    const accessToken = this.fastify.jwt.sign(
      {
        userId: user.id,
        tenantId: user.tenantId,
        role: user.role,
      },
      {
        expiresIn: this.accessTokenExpiresIn,
      },
    );

    return {
      accessToken,
      refreshToken,
      expiresIn: this.accessTokenExpiresIn,
    };
  }

  private async createRefreshToken(user: UserWithTenant): Promise<string> {
    const id = randomBytes(18).toString("base64url");
    const secret = randomBytes(48).toString("base64url");
    const tokenHash = await hashPassword(secret);
    const expiresAt = new Date(Date.now() + this.refreshTokenDays * 24 * 60 * 60 * 1000);

    await this.repository.createRefreshToken({
      id,
      tenantId: user.tenantId,
      userId: user.id,
      tokenHash,
      expiresAt,
    });

    return `${id}.${secret}`;
  }
}

function toAuthUser(user: UserWithTenant) {
  return {
    id: user.id,
    tenantId: user.tenantId,
    name: user.name,
    email: user.email,
    username: user.username,
    role: user.role,
  };
}

function parseRefreshToken(refreshToken: string): { id: string; secret: string } {
  const [id, secret] = refreshToken.split(".");

  if (!id || !secret) {
    throw new AuthError("Invalid refresh token", 401);
  }

  return { id, secret };
}

function isRefreshTokenUsable(token: RefreshTokenWithUser | null): token is RefreshTokenWithUser {
  return Boolean(token && !token.revokedAt && token.expiresAt > new Date());
}

async function hashPassword(value: string): Promise<string> {
  return hash(value, {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  });
}

function parseDays(value: string): number {
  const match = /^(\d+)d$/.exec(value);
  return match ? Number(match[1]) : 30;
}

function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}
