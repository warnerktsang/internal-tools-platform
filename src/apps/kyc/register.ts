/**
 * The KYC app's entire integration surface: one resource registration. The review queue,
 * the case screen, the masked fields, the reveal link, the approval box and the history are
 * all generated from the declaration.
 */
import { registerResource } from '@/substrate/registry';
import { CaseDecisionPanel } from '@/apps/kyc/case-panel';
import { kycCaseResource } from '@/apps/kyc/resource';

export function registerKyc(): void {
  registerResource({
    def: kycCaseResource,
    path: 'kyc-cases',
    nav: 'Review queue',
    app: 'KYC',
    titleField: 'reference',
    // Oldest SLA first: the queue's order is the app's opinion, not the substrate's.
    orderBy: { slaDueAt: 'asc' },
    columns: [
      { field: 'reference', label: 'Case' },
      { field: 'customerName', label: 'Customer' },
      { field: 'ssn', label: 'SSN' },
      { field: 'riskScore', label: 'Risk' },
      { field: 'state', label: 'State', format: 'state' },
      { field: 'assigneeId', label: 'Assignee' },
      { field: 'businessUnitId', label: 'Business unit' },
      { field: 'slaDueAt', label: 'SLA due', format: 'date' },
    ],
    detailPanel: CaseDecisionPanel,
    // Every decision carries a reason, so the panel owns these four buttons.
    panelActions: ['approve', 'reject', 'escalate', 'request_info'],
  });
}
