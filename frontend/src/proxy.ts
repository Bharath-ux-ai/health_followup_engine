import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Lightweight gate: unauthenticated visitors to app screens go to /login.
// Real authorisation happens in the API on every request.
const PUBLIC = ["/login", "/forgot-password", "/reset-password", "/book", "/r", "/api", "/_next", "/brand", "/icon", "/apple-icon"];

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname === "/" || PUBLIC.some((p) => pathname === p || pathname.startsWith(p + "/") || pathname.startsWith(p + "."))) {
    return NextResponse.next();
  }
  if (!request.cookies.has("tt_session")) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
