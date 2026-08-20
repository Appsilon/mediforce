'use client';

import { useEffect } from 'react';
import { useToast } from './command-palette/toast-provider';
import { API_ERROR_EVENT, type ApiErrorEventDetail } from '@/lib/api-error-events';

function toastCopy(status: number): { title: string; description: string } {
  if (status === 401) {
    return {
      title: 'Sign-in required',
      description: 'Your session may have expired. Sign in again and try once more.',
    };
  }
  if (status === 403) {
    return {
      title: 'Access denied',
      description: 'You do not have permission to do that in this workspace.',
    };
  }
  if (status === 404) {
    return {
      title: 'Item unavailable',
      description: 'We could not find that item, or you may not have access to it.',
    };
  }
  if (status === 409) {
    return {
      title: 'Change could not be saved',
      description: 'This conflicts with a change that already exists. Refresh and try again.',
    };
  }
  if (status === 429) {
    return {
      title: 'Too many requests',
      description: 'Please wait a moment and try again.',
    };
  }
  return {
    title: 'Request could not be completed',
    description: 'Please check the information and try again.',
  };
}

export function ApiErrorToastListener(): null {
  const { toast } = useToast();

  useEffect(() => {
    function handleApiError(event: Event): void {
      const detail = (event as CustomEvent<ApiErrorEventDetail>).detail;
      if (detail === undefined || typeof detail.status !== 'number') return;
      const copy = toastCopy(detail.status);
      toast({ ...copy, variant: 'error' });
    }

    window.addEventListener(API_ERROR_EVENT, handleApiError);
    return () => window.removeEventListener(API_ERROR_EVENT, handleApiError);
  }, [toast]);

  return null;
}
