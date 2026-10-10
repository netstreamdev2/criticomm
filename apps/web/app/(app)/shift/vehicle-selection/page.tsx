import { redirect } from 'next/navigation';

/**
 * Part of the console's old three-step start of shift, retired: the start of
 * shift is done in the HikTech Responder app. Old links and bookmarks land
 * on the status page.
 */
export default function RetiredShiftStep() {
  redirect('/shift/mental-check');
}
