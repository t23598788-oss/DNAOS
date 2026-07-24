/**
 * DNA OS Communication Gateway
 *
 * Rule: Single outbound gateway for all LINE Messaging API calls.
 * This is the ONE place that calls the LINE API. All other modules/services
 * must route through this gateway.
 *
 * Prevents duplicate implementations and ensures consistent error handling
 * and logging for all outbound messages.
 */

const LINE_MESSAGING_API = 'https://api.line.me/v2/bot/message/push';

export interface SendMessageResponse {
  success: boolean;
  messageId?: string;
  error?: string;
}

export async function sendLineMessage(
  to: string,
  messages: any[]
): Promise<SendMessageResponse> {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!accessToken) {
    console.error('LINE_CHANNEL_ACCESS_TOKEN is not set.');
    return { success: false, error: 'LINE channel access token is not configured.' };
  }

  try {
    const response = await fetch(LINE_MESSAGING_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ to, messages }),
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error(`Failed to send LINE message: ${response.status} ${response.statusText}`, errorBody);
      return { success: false, error: `LINE API Error: ${errorBody}` };
    }

    // LINE push API returns {} on success, so we don't have a messageId here.
    return { success: true };
  } catch (error) {
    console.error('Error sending LINE message:', error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    return { success: false, error: errorMessage };
  }
}