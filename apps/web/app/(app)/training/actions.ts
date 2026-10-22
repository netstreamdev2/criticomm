'use server';

import { revalidatePath } from 'next/cache';
import { addTrainingRecord, addCertification } from '@criticom/api';
import type { CriticomClient, Silo } from '@criticom/db';
import { getSession } from '@/lib/session';

/** A certificate file: a PDF or a photo/scan of it, up to 10 MB. */
const CERT_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const CERT_MAX_BYTES = 10 * 1024 * 1024;

export async function addTrainingAction(formData: FormData) {
  const { supabase, silo } = await getSession();
  await addTrainingRecord(supabase, {
    silo: silo === 'Ethekwini' ? 'MetroPolice' : silo,
    personnel_id: String(formData.get('personnel_id')),
    training_name: String(formData.get('training_name')),
    date_completed: String(formData.get('date_completed')),
    notes_learned: String(formData.get('notes_learned') ?? '') || null,
  });
  revalidatePath('/training');
}

/**
 * Stores the certificate in the certifications bucket under the person's
 * folder ({department}/{personnel id}/…), as its storage rules expect (0003,
 * 0046). Null when no file was chosen.
 */
async function storeCertificate(supabase: CriticomClient, silo: Silo, personnelId: string, file: FormDataEntryValue | null): Promise<string | null> {
  if (!(file instanceof File) || file.size === 0) return null;
  if (!CERT_TYPES.includes(file.type)) throw new Error('Upload the certificate as a PDF, JPG or PNG.');
  if (file.size > CERT_MAX_BYTES) throw new Error('The certificate is larger than 10 MB.');
  const safe = file.name.replace(/[^\w.-]+/g, '_').slice(-80) || 'certificate';
  const path = `${silo}/${personnelId}/${Date.now()}-${safe}`;
  const { error } = await supabase.storage.from('certifications').upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(`The certificate could not be uploaded: ${error.message}`);
  return path;
}

export async function addCertificationAction(formData: FormData) {
  const { supabase, silo } = await getSession();
  const department = silo === 'Ethekwini' ? 'MetroPolice' : silo;
  const personnelId = String(formData.get('personnel_id'));
  const filePath = await storeCertificate(supabase, department, personnelId, formData.get('file'));
  try {
    await addCertification(supabase, {
      silo: department,
      personnel_id: personnelId,
      name: String(formData.get('name')),
      expiry_date: String(formData.get('expiry_date')),
      issued_by: String(formData.get('issued_by') ?? '') || null,
      date_achieved: String(formData.get('date_achieved') ?? '') || null,
      remarks: String(formData.get('remarks') ?? '') || null,
      file_path: filePath,
    });
  } catch (e) {
    // The record was refused: the file is not left behind with nothing pointing at it.
    if (filePath) await supabase.storage.from('certifications').remove([filePath]).catch(() => {});
    throw e;
  }
  revalidatePath('/training');
}

/** Attaches (or replaces) the certificate file on a certification already on record. */
export async function attachCertificateAction(formData: FormData) {
  const { supabase } = await getSession();
  const id = String(formData.get('id'));
  const { data: cert, error } = await supabase.from('certifications').select('id, silo, personnel_id, file_path').eq('id', id).single();
  if (error || !cert) throw new Error('Certification not found.');
  const filePath = await storeCertificate(supabase, cert.silo, cert.personnel_id, formData.get('file'));
  if (!filePath) return;
  const { error: saved } = await supabase.from('certifications').update({ file_path: filePath }).eq('id', id);
  if (saved) {
    await supabase.storage.from('certifications').remove([filePath]).catch(() => {});
    throw new Error(saved.message);
  }
  revalidatePath('/training');
}
