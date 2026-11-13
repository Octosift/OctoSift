/**
 * Hand-written demo answers for the Acme Invoices leads: varied scores,
 * reasons that name what the post asks for, and replies that answer it.
 * Demo mode feeds them to the fake model, so the inbox reads like real use.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import type { ScriptedLead } from '../ai/fake-responder';

const scriptedLeadSchema = z.object({
  score: z.number().int().min(0).max(100),
  reason: z.string().min(1).max(240),
  angle: z.string().min(1).max(200),
  advice: z.string().min(1),
  pitch: z.string().min(1).optional(),
  dm: z.string().min(1).optional(),
  review: z
    .object({
      decision: z.enum(['APPROVE', 'REVISE', 'REJECT']),
      reasons: z.array(z.string()),
      fixes: z.array(z.string()),
    })
    .optional(),
});

const fileSchema = z.object({
  product: z.string(),
  note: z.string(),
  leads: z.record(z.string(), scriptedLeadSchema),
});

export function loadScriptedLeads(
  root = resolve(process.cwd(), 'fixtures/demo'),
): Map<string, ScriptedLead> {
  const raw: unknown = JSON.parse(readFileSync(resolve(root, 'acme-invoices-leads.json'), 'utf8'));
  return new Map(Object.entries(fileSchema.parse(raw).leads));
}
