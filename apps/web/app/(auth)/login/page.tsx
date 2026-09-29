import { Suspense } from 'react';
import type { Metadata } from 'next';
import { LoginShell } from './login-shell';
import { LoginForm } from './login-form';
import '../../landing-home.css';
import './login.css';

export const metadata: Metadata = { title: 'Sign in · HikTech' };

export default function LoginPage() {
  return (
    <LoginShell>
      <Suspense>
        <LoginForm />
      </Suspense>
    </LoginShell>
  );
}
