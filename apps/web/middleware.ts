import { NextResponse, type NextRequest } from "next/server";

const blockedPaths = ["/store", "/store/"];

export function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (blockedPaths.includes(pathname) || pathname.startsWith("/store/")) {
    return NextResponse.redirect(new URL("/", request.url), 308);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/store", "/store/:path*"],
};
