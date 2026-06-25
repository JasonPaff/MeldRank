import { healthy, PACKAGE_NAME } from '@meldrank/shared';

export default function Home() {
  // Smoke import: if the cross-package alias breaks, this fails typecheck/build.
  const status = healthy('web');

  return (
    <main>
      <h1>MeldRank</h1>
      <p>
        Imported from <code>{PACKAGE_NAME}</code>: {status.service} is {status.ok ? 'ok' : 'down'}.
      </p>
    </main>
  );
}
