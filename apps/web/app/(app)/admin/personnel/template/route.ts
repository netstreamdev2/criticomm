import { buildStaffListTemplate, TEMPLATE_FILE_NAME } from '@/lib/register/template';

/**
 * The staff-list template, for an administrator to send to HR. Built on
 * request, so it always carries the current columns. Administrators only
 * (the /admin route rule).
 */
export function GET() {
  const bytes = buildStaffListTemplate();
  return new Response(bytes as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${TEMPLATE_FILE_NAME}"`,
      'Cache-Control': 'no-store',
    },
  });
}
