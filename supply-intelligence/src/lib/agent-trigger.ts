const STALE_THRESHOLD_MS = 4 * 60 * 60 * 1000; // 4 hours

let analysisInProgress = false;

/**
 * Triggers a supply-intelligence-analysis process via the platform API.
 * Returns the process instance ID, or an empty string if already in progress.
 */
export async function triggerAnalysis(): Promise<string> {
  const PLATFORM_URL = process.env.NEXT_PUBLIC_PLATFORM_URL;
  const PLATFORM_API_KEY = process.env.NEXT_PUBLIC_PLATFORM_API_KEY;

  if (!PLATFORM_URL) {
    throw new Error(
      'NEXT_PUBLIC_PLATFORM_URL is not set. Add it to .env.local (e.g. http://localhost:9003)',
    );
  }
  if (!PLATFORM_API_KEY) {
    throw new Error(
      'NEXT_PUBLIC_PLATFORM_API_KEY is not set. Add it to .env.local (must match platform-ui PLATFORM_API_KEY)',
    );
  }

  if (analysisInProgress) return '';

  analysisInProgress = true;
  try {
    const response = await fetch(`${PLATFORM_URL}/api/processes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': PLATFORM_API_KEY,
      },
      body: JSON.stringify({
        definitionName: 'supply-intelligence-analysis',
        version: '1.0.0',
        triggerName: 'start-analysis',
        triggeredBy: 'supply-intelligence-app',
        payload: {},
      }),
    });

    if (!response.ok) {
      throw new Error(`Trigger failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    return data.instanceId ?? '';
  } finally {
    analysisInProgress = false;
  }
}

/**
 * Returns true if the summary is stale (null or older than 4 hours).
 */
export function isSummaryStale(generatedAt: string | null): boolean {
  if (!generatedAt) return true;
  const age = Date.now() - new Date(generatedAt).getTime();
  return age > STALE_THRESHOLD_MS;
}
