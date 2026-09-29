import { LandingSite, landingMetadata } from '@/components/landing/site';

export const metadata = landingMetadata('manual');

export default function ManualPage() {
  return <LandingSite page="manual" />;
}
