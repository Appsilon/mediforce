export const API_ERROR_EVENT = 'mediforce:api-error';

export type ApiErrorEventDetail = {
  status: number;
  message: string;
};

function isClientErrorStatus(status: number): boolean {
  return status >= 400 && status < 500;
}

function dispatchApiError(detail: ApiErrorEventDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<ApiErrorEventDetail>(API_ERROR_EVENT, { detail }));
}

export function reportApiResponseError(response: Pick<Response, 'status' | 'statusText'>): void {
  if (!isClientErrorStatus(response.status)) return;
  dispatchApiError({
    status: response.status,
    message: response.statusText || `Request failed with status ${response.status}`,
  });
}
