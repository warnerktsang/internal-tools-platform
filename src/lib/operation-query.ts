/**
 * How an operation result crosses a redirect. One writer, so every app's banner says the
 * same thing about the same outcome — an app that hand-rolled this would be one commit away
 * from reporting a denial as a generic error.
 */
import type { OperationResult } from '@/substrate/types';

export function operationQuery(result: OperationResult<unknown>): string {
  const params = new URLSearchParams({ status: result.status });
  if (result.status === 'denied' || result.status === 'invalid' || result.status === 'unknown') {
    params.set('message', result.reason);
  }
  if (result.status === 'pending') {
    params.set('message', `policy: ${result.policy}`);
    params.set('reference', `approval ${result.approvalRequestId}`);
  }
  if (result.status === 'unknown') params.set('reference', `effect ${result.effectId}`);
  return params.toString();
}

export function messageQuery(status: OperationResult['status'], message: string): string {
  return new URLSearchParams({ status, message }).toString();
}
