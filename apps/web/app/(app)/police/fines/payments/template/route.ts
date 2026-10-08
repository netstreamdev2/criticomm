import { NextResponse } from 'next/server';
import { PAYMENT_COLUMNS } from '@criticom/db';

export const dynamic = 'force-static';

/** The payments template: the headings the import reads, and one example row. */
export function GET() {
  const cell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const csv = [
    PAYMENT_COLUMNS.map((c) => cell(c.header)).join(','),
    PAYMENT_COLUMNS.map((c) => cell(c.example ?? '')).join(','),
  ].join('\r\n');
  return new NextResponse(`﻿${csv}\r\n`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="fine-payments-template.csv"',
    },
  });
}
