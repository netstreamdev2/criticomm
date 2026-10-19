import { redirect } from 'next/navigation';

/** The HR staff-list import moved into Staff Maintenance; old links land there. */
export default function ImportMovedPage() {
  redirect('/modules/staff/import');
}
