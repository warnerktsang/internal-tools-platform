import type { Metadata } from 'next';
import Link from 'next/link';
import { PrincipalSwitcher } from '@/components/principal-switcher';
import '@/app/globals.css';
import '@/apps/register';
import { registeredResources } from '@/substrate/registry';
import { currentPrincipal, selectablePrincipals } from '@/substrate/session';

export const metadata: Metadata = {
  title: 'Internal Tools Platform',
  description: 'One governed substrate carrying three internal tools.',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [principal, principals] = await Promise.all([currentPrincipal(), selectablePrincipals()]);
  const resources = registeredResources();

  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-200 bg-white px-6 py-3">
          <Link href="/" className="text-sm font-semibold">
            Internal Tools Platform
          </Link>
          <PrincipalSwitcher principals={principals} current={principal} returnTo="/" />
        </header>

        <div className="mx-auto flex max-w-6xl gap-6 px-6 py-6">
          <nav className="w-48 shrink-0 space-y-1 text-sm">
            {resources.map((entry) => (
              <Link
                key={entry.path}
                href={`/r/${entry.path}`}
                className="block rounded-md px-2 py-1 text-neutral-700 hover:bg-white hover:text-neutral-900"
              >
                {entry.nav}
              </Link>
            ))}
            <Link
              href="/audit"
              className="block rounded-md px-2 py-1 text-neutral-700 hover:bg-white hover:text-neutral-900"
            >
              Audit trail
            </Link>
          </nav>
          <main className="min-w-0 flex-1 space-y-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
