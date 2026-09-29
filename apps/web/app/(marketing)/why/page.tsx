import { LandingSite, landingMetadata } from '@/components/landing/site';

export const metadata = landingMetadata('why');

export default function WhyPage() {
  return <LandingSite page="why" />;
}
