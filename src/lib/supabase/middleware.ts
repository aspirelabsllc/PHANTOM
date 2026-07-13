import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

// Refreshes the auth session on every request and guards protected routes.
export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: do not run code between createServerClient and getUser().
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isAuthed = !!user;

  // Protected surfaces — everything past the threshold.
  const protectedPrefixes = ["/gallery", "/invocation", "/manifest"];
  const needsAuth = protectedPrefixes.some((p) => path.startsWith(p));

  if (needsAuth && !isAuthed) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.searchParams.set("veil", "sealed");
    return NextResponse.redirect(url);
  }

  // Already crossed over — send away from the threshold.
  if (path === "/" && isAuthed) {
    const url = request.nextUrl.clone();
    url.pathname = "/gallery";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
