'use server';

import { revalidatePath } from 'next/cache';
import { createDutyTask, logAudit, raiseAlert, updateDutyTask } from '@criticom/api';
import type { Silo } from '@criticom/db';
import { getSession } from '@/lib/session';

const S = (fd: FormData, k: string) => {
  const v = String(fd.get(k) ?? '').trim();
  return v === '' ? undefined : v;
};

export async function createDutyTaskAction(formData: FormData) {
  const { supabase, silo, userId, fullName } = await getSession();
  const boardSilo = (S(formData, 'silo') as Silo | undefined)
    ?? (silo === 'Ethekwini' ? 'MetroPolice' : silo);

  const assignedUserId = S(formData, 'assigned_user_id');
  const task = await createDutyTask(supabase, {
    title: S(formData, 'title') ?? '',
    details: S(formData, 'details'),
    silo: boardSilo,
    assignedUserId,
    assignedName: S(formData, 'assigned_name'),
    unitRef: S(formData, 'unit_ref'),
    sectionCode: S(formData, 'section_code'),
    dueDate: S(formData, 'due_date'),
    createdBy: userId,
    createdName: fullName,
  });

  await logAudit(supabase, {
    silo: boardSilo, action_type: 'DutyTaskCreated', entity_type: 'duty_task',
    entity_id: task.id, user_name: fullName, details: `${task.task_number} ${task.title}`,
  }).catch(() => {});

  // The assignee hears about it immediately, phone included.
  if (assignedUserId) {
    await raiseAlert(supabase, {
      silo: boardSilo,
      targetUserId: assignedUserId,
      kind: 'info',
      severity: 'Low',
      title: `Task assigned: ${task.title}`,
      body: `${task.task_number}${task.due_date ? ` · due ${task.due_date}` : ''}`,
      link: '/duty-tasks',
      createdByName: fullName,
    }).catch(() => {});
  }

  revalidatePath('/duty-tasks');
  revalidatePath('/command');
}

export async function updateDutyTaskAction(formData: FormData) {
  const { supabase, fullName } = await getSession();
  const id = String(formData.get('id'));
  const status = S(formData, 'status') as
    | 'Pending' | 'In Progress' | 'Completed' | 'Cancelled' | undefined;
  const progressRaw = formData.get('progress');
  const progress = progressRaw === null || progressRaw === '' ? undefined : Number(progressRaw);

  await updateDutyTask(supabase, { id, status, progress });
  await logAudit(supabase, {
    silo: 'Ethekwini', action_type: 'DutyTaskUpdated', entity_type: 'duty_task',
    entity_id: id, user_name: fullName, details: status ?? `progress ${progress}%`,
  }).catch(() => {});

  revalidatePath('/duty-tasks');
  revalidatePath('/command');
}
