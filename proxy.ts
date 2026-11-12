import { clerkMiddleware, createRouteMatcher } from '@clerk/nextjs/server'
import { NextResponse } from 'next/server'
import { updateSession } from '@/utils/supabase/middleware'

// Everything except the marketing/auth pages requires a signed-in user.
const isPublicRoute = createRouteMatcher(['/', '/sign-in(.*)', '/sign-up(.*)', '/__clerk(.*)'])

// Other servers call these with no login, and each route checks its own secret.
const isServerToServer = createRouteMatcher(['/api/upaya/webhook/(.*)', '/api/website-orders', '/api/website-products'])

export default clerkMiddleware(async (auth, request) => {
  if (isServerToServer(request)) return NextResponse.next()

  if (!isPublicRoute(request)) {
    await auth.protect()
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
