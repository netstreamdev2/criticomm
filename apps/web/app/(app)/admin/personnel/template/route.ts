/** The HR template moved into Staff Maintenance; old links still download it. */
export function GET(request: Request) {
  return Response.redirect(new URL('/modules/staff/template', request.url), 308);
}
