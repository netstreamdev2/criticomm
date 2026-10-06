import { BODYCAMS_TEMPLATE_NAME, buildBodycamsTemplate } from '@/lib/register/asset-templates';

/**
 * The bodycam template, built on request so it always carries the current
 * columns. Open to whoever may open the register (the /police/bodycams rule).
 */
export function GET() {
  return new Response(buildBodycamsTemplate() as BodyInit, {
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="${BODYCAMS_TEMPLATE_NAME}"`,
      'Cache-Control': 'no-store',
    },
  });
}
