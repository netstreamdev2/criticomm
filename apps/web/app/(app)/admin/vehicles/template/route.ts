import { buildVehiclesTemplate, VEHICLES_TEMPLATE_NAME } from '@/lib/register/asset-templates';

/**
 * The fleet template, built on request so it always carries the current
 * columns. Administrators only (the /admin route rule).
 */
export function GET() {
  return new Response(buildVehiclesTemplate() as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${VEHICLES_TEMPLATE_NAME}"`,
      'Cache-Control': 'no-store',
    },
  });
}
