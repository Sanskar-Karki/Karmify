import { clerkMiddleware } from '@clerk/nextjs/server'
import { updateSession } from '@/utils/supabase/middleware'

export default clerkMiddleware(async (auth, request) => {
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
