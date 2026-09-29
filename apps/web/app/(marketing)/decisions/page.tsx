import { LandingSite, landingMetadata } from '@/components/landing/site';

export const metadata = landingMetadata('decisions');

export default function DecisionsPage() {
  return <LandingSite page="decisions" />;
}
