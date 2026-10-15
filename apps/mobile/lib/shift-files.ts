import * as FileSystem from 'expo-file-system';
import { tNow } from './translator';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { CriticomClient } from '@criticom/db';
import { buildReportCsv, buildReportHtml, type ReportContext } from './inspection-187c';
import { decodeBase64 } from './sync';

/** Upload one inspection photo; returns its storage path. */
export async function uploadShiftPhoto(client: CriticomClient, folder: string, localUri: string, name: string) {
  const base64 = await FileSystem.readAsStringAsync(localUri, { encoding: FileSystem.EncodingType.Base64 });
  const bytes = decodeBase64(base64);
  const path = `${folder}/${name}.jpg`;
  const { error } = await client.storage
    .from('shift-inspections')
    .upload(path, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, {
      contentType: 'image/jpeg',
      upsert: true,
    });
  if (error) throw new Error(`Photo upload failed: ${error.message}`);
  return path;
}

async function share(uri: string, mimeType: string, uti: string, title: string) {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(uri, { mimeType, UTI: uti, dialogTitle: title });
}

function fileBase(ctx: ReportContext) {
  const ref = ctx.record.inspection?.inspection_ref ?? `SHIFT-${Date.now()}`;
  return ref.replace(/[^A-Za-z0-9_-]/g, '_');
}

export async function exportShiftPdf(ctx: ReportContext) {
  const { uri } = await Print.printToFileAsync({ html: buildReportHtml(ctx) });
  // Give the file the reference as its name so it is recognisable once shared.
  const target = `${FileSystem.cacheDirectory}${fileBase(ctx)}.pdf`;
  await FileSystem.deleteAsync(target, { idempotent: true });
  await FileSystem.moveAsync({ from: uri, to: target });
  await share(target, 'application/pdf', 'com.adobe.pdf', tNow('Start of shift report (PDF)'));
}

export async function exportShiftCsv(ctx: ReportContext) {
  const target = `${FileSystem.cacheDirectory}${fileBase(ctx)}.csv`;
  // BOM so Excel reads the em dashes and ticks as UTF-8.
  await FileSystem.writeAsStringAsync(target, `﻿${buildReportCsv(ctx)}`, {
    encoding: FileSystem.EncodingType.UTF8,
  });
  await share(target, 'text/csv', 'public.comma-separated-values-text', tNow('Start of shift report (CSV)'));
}

export async function printShiftReport(ctx: ReportContext) {
  await Print.printAsync({ html: buildReportHtml(ctx) });
}
