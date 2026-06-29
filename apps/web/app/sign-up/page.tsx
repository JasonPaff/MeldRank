import { SignUp } from '@clerk/nextjs';

/**
 * Public sign-up surface (capability `web-client-foundation`), the registration
 * counterpart to the sign-in page. Hash routing keeps it a single static route.
 */
export default function SignUpPage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <SignUp routing="hash" />
    </main>
  );
}
