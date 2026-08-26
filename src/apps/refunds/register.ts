/**
 * The refunds app's entire integration surface: two resource registrations and one port.
 * No routes, no CRUD screens, no authorization code, no audit code.
 */
import { registerPort } from '@/substrate/effects';
import { registerResource } from '@/substrate/registry';
import { paymentResource, refundResource } from '@/apps/refunds/resource';
import { processorPort } from '@/apps/refunds/processor';
import { RequestRefundPanel } from '@/apps/refunds/request-panel';

export function registerRefunds(): void {
  registerResource({
    def: paymentResource,
    path: 'payments',
    nav: 'Payments',
    app: 'Refunds',
    titleField: 'reference',
    orderBy: { capturedAt: 'desc' },
    columns: [
      { field: 'reference', label: 'Payment' },
      { field: 'customerName', label: 'Customer' },
      { field: 'capturedMinor', label: 'Captured', format: 'money_minor' },
      { field: 'businessUnitId', label: 'Business unit' },
      { field: 'capturedAt', label: 'Captured at', format: 'date' },
    ],
    detailPanel: RequestRefundPanel,
  });

  registerResource({
    def: refundResource,
    path: 'refunds',
    nav: 'Refunds',
    app: 'Refunds',
    titleField: 'reference',
    orderBy: { createdAt: 'desc' },
    columns: [
      { field: 'reference', label: 'Refund' },
      { field: 'customerName', label: 'Customer' },
      { field: 'paymentRef', label: 'Payment' },
      { field: 'amountMinor', label: 'Amount', format: 'money_minor' },
      { field: 'state', label: 'State', format: 'state' },
      { field: 'reason', label: 'Reason' },
      { field: 'createdAt', label: 'Requested', format: 'date' },
    ],
  });

  registerPort(processorPort);
}
