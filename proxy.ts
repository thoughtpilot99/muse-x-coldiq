import { NextResponse, type NextRequest } from "next/server";

// Optional HTTP Basic auth for the whole UI. Shareable reports (/report/<token> and Offer Check's
// /o/<token>) stay open: the token is unguessable and the pages contain no customer or personal data.
export function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();
  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    const decoded = atob(header.slice(6));
    if (decoded.slice(decoded.indexOf(":") + 1) === password) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="ICP Detective"' },
  });
}

export const config = {
  matcher: ["/((?!report/|o/|_next/static|_next/image|favicon.ico).*)"],
};
