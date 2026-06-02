import { z } from 'zod';

export const RenderWorkflowDiagramInputSchema = z.object({
  definition: z.object({
    name: z.string().optional(),
    description: z.string().optional(),
    steps: z.array(z.object({
      id: z.string(),
      name: z.string(),
      type: z.string().optional(),
      executor: z.string().optional(),
      description: z.string().optional(),
      verdicts: z.record(z.string(), z.object({ target: z.string() })).optional(),
      plugin: z.string().optional(),
      agent: z.object({ model: z.string().optional() }).passthrough().optional(),
    }).passthrough()),
    transitions: z.array(z.object({
      from: z.string(),
      to: z.string(),
      when: z.string().optional(),
    })),
    triggers: z.array(z.object({
      type: z.string(),
      name: z.string(),
      schedule: z.string().optional(),
    })).optional(),
    triggerInput: z.array(z.object({
      name: z.string(),
      type: z.string().optional(),
      required: z.boolean().optional(),
      description: z.string().optional(),
    })).optional(),
  }),
});

export type RenderWorkflowDiagramInput = z.infer<typeof RenderWorkflowDiagramInputSchema>;

const TYPE_COLORS: Record<string, { border: string; bg: string; badge: string; badgeText: string }> = {
  creation: { border: '#bfdbfe', bg: '#eff6ff', badge: '#dbeafe', badgeText: '#1d4ed8' },
  review:   { border: '#fde68a', bg: '#fffbeb', badge: '#fef3c7', badgeText: '#b45309' },
  decision: { border: '#c4b5fd', bg: '#f5f3ff', badge: '#ede9fe', badgeText: '#7c3aed' },
  terminal: { border: '#d1d5db', bg: '#f9fafb', badge: '#e5e7eb', badgeText: '#374151' },
};

const EXECUTOR_LABELS: Record<string, { label: string; color: string; bg: string }> = {
  human:  { label: '👤 Human',  color: '#2563eb', bg: '#dbeafe' },
  agent:  { label: '🤖 Agent',  color: '#7c3aed', bg: '#ede9fe' },
  script: { label: '⚙️ Script', color: '#d97706', bg: '#fef3c7' },
  cowork: { label: '🤝 Cowork', color: '#0d9488', bg: '#ccfbf1' },
};

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function renderWorkflowDiagram(input: RenderWorkflowDiagramInput): string {
  const { definition: def } = input;
  const steps = def.steps;
  const transitions = def.transitions;
  const triggers = def.triggers ?? [];
  const triggerInput = def.triggerInput ?? [];

  const transitionsByFrom = new Map<string, typeof transitions>();
  for (const t of transitions) {
    const list = transitionsByFrom.get(t.from) ?? [];
    list.push(t);
    transitionsByFrom.set(t.from, list);
  }

  const stepBoxes: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const type = step.type ?? 'creation';
    const colors = TYPE_COLORS[type] ?? TYPE_COLORS.creation;
    const executor = step.executor ? EXECUTOR_LABELS[step.executor] ?? null : null;

    let executorHtml = '';
    if (executor) {
      executorHtml = `<span style="display:inline-block;padding:1px 8px;border-radius:9999px;font-size:11px;background:${executor.bg};color:${executor.color};font-weight:500">${executor.label}</span>`;
    }

    let modelHtml = '';
    if (step.agent?.model) {
      modelHtml = `<span style="font-size:11px;color:#6b7280;margin-left:4px">(${escapeHtml(step.agent.model)})</span>`;
    }

    let verdictsHtml = '';
    if (step.verdicts && Object.keys(step.verdicts).length > 0) {
      const pills = Object.entries(step.verdicts).map(([key, v]) => {
        const isApprove = key === 'approve' || key === 'accept';
        const bg = isApprove ? '#dcfce7' : '#fee2e2';
        const color = isApprove ? '#166534' : '#991b1b';
        return `<span style="display:inline-block;padding:2px 8px;border-radius:9999px;font-size:11px;background:${bg};color:${color}">${escapeHtml(key)} → ${escapeHtml(v.target)}</span>`;
      }).join(' ');
      verdictsHtml = `<div style="display:flex;gap:6px;margin-top:8px;flex-wrap:wrap">${pills}</div>`;
    }

    let descriptionHtml = '';
    if (step.description) {
      const desc = step.description.length > 100 ? step.description.slice(0, 100) + '…' : step.description;
      descriptionHtml = `<div style="font-size:12px;color:#6b7280;margin-top:4px">${escapeHtml(desc)}</div>`;
    }

    stepBoxes.push(`
      <div style="width:100%;max-width:420px;border:2px solid ${colors.border};border-radius:8px;padding:12px 16px;background:${colors.bg}">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
          <span style="font-weight:600;font-size:14px">${escapeHtml(step.name)}</span>
          <span style="display:inline-block;padding:1px 8px;border-radius:9999px;font-size:11px;background:${colors.badge};color:${colors.badgeText}">${escapeHtml(type)}</span>
        </div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:6px">
          ${executorHtml}${modelHtml}
        </div>
        ${descriptionHtml}
        ${verdictsHtml}
      </div>
    `);

    if (i < steps.length - 1) {
      const outgoing = transitionsByFrom.get(step.id) ?? [];
      const verdictTargets = step.verdicts ? Object.values(step.verdicts).map(v => v.target) : [];

      if (outgoing.length > 0) {
        if (outgoing.length === 1 && !outgoing[0].when) {
          stepBoxes.push('<div style="color:#9ca3af;font-size:24px;text-align:center">↓</div>');
        } else {
          const labels = outgoing.map(t => {
            const cond = t.when ? escapeHtml(t.when) : '';
            return `<div style="text-align:center"><div style="font-size:11px;color:#6b7280;margin-bottom:2px">${cond}</div><div style="color:#9ca3af;font-size:20px">↓ ${escapeHtml(t.to)}</div></div>`;
          }).join('');
          stepBoxes.push(`<div style="display:flex;gap:24px;justify-content:center">${labels}</div>`);
        }
      } else if (verdictTargets.length > 0) {
        stepBoxes.push('<div style="color:#9ca3af;font-size:18px;text-align:center">⤷ via verdicts</div>');
      } else {
        stepBoxes.push('<div style="color:#9ca3af;font-size:24px;text-align:center">↓</div>');
      }
    }
  }

  const triggerPills = triggers.map(t => {
    const icon = t.type === 'cron' ? '⏰' : t.type === 'webhook' ? '🔗' : '👆';
    const label = t.schedule ? `${t.name} (${t.schedule})` : t.name;
    return `<span style="display:inline-block;padding:4px 12px;border-radius:9999px;font-size:12px;background:#f3f4f6;color:#374151">${icon} ${escapeHtml(label)}</span>`;
  }).join(' ');

  let triggerInputHtml = '';
  if (triggerInput.length > 0) {
    const fields = triggerInput.map(f => {
      const req = f.required ? '<span style="color:#dc2626">*</span>' : '';
      const desc = f.description ? ` — ${escapeHtml(f.description)}` : '';
      return `<li style="font-size:12px;color:#4b5563"><code style="background:#f3f4f6;padding:1px 4px;border-radius:3px">${escapeHtml(f.name)}</code>${req}${desc}</li>`;
    }).join('');
    triggerInputHtml = `
      <div style="margin-top:16px;padding:12px;border:1px solid #e5e7eb;border-radius:8px;background:#fafafa">
        <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:6px">📝 Trigger input</div>
        <ul style="margin:0;padding-left:20px;list-style:disc">${fields}</ul>
      </div>
    `;
  }

  return `
    <div style="max-width:480px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif">
      <h2 style="font-size:18px;font-weight:700;margin:0 0 4px">${escapeHtml(def.name ?? 'Workflow')}</h2>
      ${def.description ? `<p style="font-size:13px;color:#6b7280;margin:0 0 12px">${escapeHtml(def.description)}</p>` : ''}
      ${triggerPills ? `<div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">${triggerPills}</div>` : ''}
      <div style="display:flex;flex-direction:column;align-items:center;gap:6px">
        ${stepBoxes.join('\n')}
      </div>
      ${triggerInputHtml}
    </div>
  `.trim();
}

export function renderWorkflowDiagramHandler(
  input: RenderWorkflowDiagramInput,
): { html: string } {
  return { html: renderWorkflowDiagram(input) };
}
