import { healthy, PACKAGE_NAME } from '@meldrank/shared';
import { env } from '../lib/env';

export default function Home() {
  // Smoke import: if the cross-package alias breaks, this fails typecheck/build.
  const status = healthy('web');

  return (
    <main>
      <h1>MeldRank</h1>
      <p>
        Imported from <code>{PACKAGE_NAME}</code>: {status.service} is {status.ok ? 'ok' : 'down'}.
      </p>
      <p>
        API base URL: <code>{env.NEXT_PUBLIC_API_URL}</code>
      </p>
    </main>
  );
}
