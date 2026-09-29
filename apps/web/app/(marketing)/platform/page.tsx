import { LandingSite, landingMetadata } from '@/components/landing/site';

export const metadata = landingMetadata('platform');

export default function PlatformPage() {
  return <LandingSite page="platform" />;
}
