import { IncidentsList } from '@/components/incidents-list';

/**
 * My incidents — only what is assigned to this officer or what they are
 * responding to, filtered by where they are on it (opened from Home).
 */
export default function MyIncidentsScreen() {
  return <IncidentsList mineOnly />;
}
