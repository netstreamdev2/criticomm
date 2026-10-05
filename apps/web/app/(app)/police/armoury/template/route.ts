import { buildFirearmsTemplate, FIREARMS_TEMPLATE_NAME } from '@/lib/register/asset-templates';

/**
 * The armoury template, built on request so it always carries the current
 * columns. Open to whoever may open the armoury (the /police/armoury rule).
 */
export function GET() {
  return new Response(buildFirearmsTemplate() as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${FIREARMS_TEMPLATE_NAME}"`,
      'Cache-Control': 'no-store',
    },
  });
}
