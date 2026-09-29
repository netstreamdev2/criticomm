import { LandingSite, landingMetadata } from '@/components/landing/site';

export const metadata = landingMetadata('faq');

export default function FaqPage() {
  return <LandingSite page="faq" />;
}
