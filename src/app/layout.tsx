import { BookText, Code2 } from 'lucide-react';
import type { Metadata } from 'next';
import { Breadcrumbs } from '@/components/shell/breadcrumbs';
import { Sidebar } from '@/components/shell/sidebar';
import '@/app/globals.css';
import '@/apps/register';
import { registeredResources } from '@/substrate/registry';
import { currentPrincipal, selectablePrincipals } from '@/substrate/session';

export const metadata: Metadata = {
  title: 'Internal Tools Platform',
  description: 'One governed substrate carrying three internal tools.',
};

const REPO = 'https://github.com/warnerktsang/internal-tools-platform';

const PLATFORM_LABELS: Record<string, string> = {
  '/platform': 'Platform',
  '/platform/roles': 'Roles & permissions',
  '/platform/resource-types': 'Resource types',
  '/platform/policies': 'Deny rules',
  '/audit': 'Audit logs',
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const [principal, principals] = await Promise.all([currentPrincipal(), selectablePrincipals()]);
  const resources = registeredResources();

  const labels = {
    ...PLATFORM_LABELS,
    ...Object.fromEntries(resources.map((entry) => [`/r/${entry.path}`, entry.nav])),
  };

  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        <div className="flex min-h-screen">
          <Sidebar resources={resources} principal={principal} principals={principals} />

          <div className="flex min-w-0 flex-1 flex-col">
            <header className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-neutral-200 bg-white px-6">
              <Breadcrumbs labels={labels} />
              <div className="flex items-center gap-4 text-sm text-neutral-500">
                <a
                  className="flex items-center gap-1.5 hover:text-neutral-900"
                  href={`${REPO}#readme`}
                >
                  <BookText className="h-4 w-4" aria-hidden />
                  Docs
                </a>
                <a className="flex items-center gap-1.5 hover:text-neutral-900" href={REPO}>
                  <Code2 className="h-4 w-4" aria-hidden />
                  Source
                </a>
              </div>
            </header>

            <main className="min-w-0 flex-1 px-8 py-6">
              <div className="mx-auto max-w-5xl space-y-6">{children}</div>
            </main>
          </div>
        </div>
      </body>
    </html>
  );
}
