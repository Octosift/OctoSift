import type { Metadata } from 'next';
import { BRAND } from '@/core/brand';
import { safeNextPath } from '../lib/auth';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return (
    <main className="flex min-h-dvh items-center justify-center px-4">
      <div className="w-full max-w-xs">
        <h1 className="text-base font-semibold">{BRAND.name}</h1>
        <p className="mt-1 mb-6 text-sm text-muted-foreground">
          This dashboard is protected by a password.
        </p>
        <LoginForm next={safeNextPath(next)} />
      </div>
    </main>
  );
}
