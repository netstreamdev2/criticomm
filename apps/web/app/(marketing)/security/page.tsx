import { LandingSite, landingMetadata } from '@/components/landing/site';

export const metadata = landingMetadata('security');

export default function SecurityPage() {
  return <LandingSite page="security" />;
}
