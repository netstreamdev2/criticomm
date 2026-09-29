import { LandingSite, landingMetadata } from '@/components/landing/site';

export const metadata = landingMetadata('story');

export default function StoryPage() {
  return <LandingSite page="story" />;
}
