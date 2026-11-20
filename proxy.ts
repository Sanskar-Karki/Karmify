import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { updateSession } from '@/utils/supabase/middleware'
import { verifyOwnerToken } from '@/lib/ownerAccess'
import { isOwnerPath, LOCKED_HOME, OWNER_COOKIE, OWNER_HINT_COOKIE } from '@/lib/ownerPaths'

// Everything except the marketing/auth pages requires a signed-in user.
const isPublicRoute = createRouteMatcher(['/', '/sign-in(.*)', '/sign-up(.*)', '/__clerk(.*)'])

// Other servers call these with no login, and each route checks its own secret.
const isServerToServer = createRouteMatcher(['/api/upaya/webhook/(.*)', '/api/website-orders', '/api/website-products', '/api/cron/sheets-backup'])

export default clerkMiddleware(async (auth, request) => {
  if (isServerToServer(request)) return NextResponse.next()

  if (!isPublicRoute(request)) {
    await auth.protect()
  }

  // Dashboard and Analytics stay locked on a device until the owner unlocks them
  // in Settings (signed cookie, see lib/ownerAccess.ts). A locked device goes to
  // Orders instead, whether it typed the address, followed a link or opened the app.
  if (isOwnerPath(request.nextUrl.pathname) && !(await verifyOwnerToken(request.cookies.get(OWNER_COOKIE)?.value))) {
    const locked = NextResponse.redirect(new URL(LOCKED_HOME, request.url))
    locked.cookies.delete(OWNER_COOKIE)
    locked.cookies.delete(OWNER_HINT_COOKIE)
    return locked
  }

  // Refresh the Supabase session cookies so both Clerk and Supabase session logic runs.
  const supabaseResponse = await updateSession(request)

  return supabaseResponse
})

export const config = {
  matcher: [
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for Clerk's auto-proxy path
    '/__clerk/(.*)',
    '/(api|trpc)(.*)',
  ],
}
