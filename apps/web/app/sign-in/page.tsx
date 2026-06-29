import { SignIn } from '@clerk/nextjs';

/**
 * Public sign-in surface (capability `web-client-foundation`). The `clerkMiddleware`
 * redirects an unauthenticated visitor here from a protected route. Hash routing keeps
 * Clerk's internal steps in the URL fragment, so the route stays a single static page —
 * no catch-all segment for `next-typesafe-url` to model.
 */
export default function SignInPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <SignIn routing="hash" />
    </main>
  );
}
