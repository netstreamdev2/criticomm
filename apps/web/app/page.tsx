import type { Metadata } from 'next';
import { LandingHome } from '@/components/landing/home';
import './landing-home.css';

export const metadata: Metadata = {
  title: 'HikTech — Emergency Command Platform',
  description: 'One platform for emergency dispatch, field response and the record that follows — across Metro Police, Fire & Rescue, EMS and Disaster Management.',
};

export default function HomePage() {
  return <LandingHome />;
}
