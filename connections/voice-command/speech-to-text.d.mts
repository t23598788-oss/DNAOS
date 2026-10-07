export interface TranscriptionResult {
  ok: boolean;
  text: string | null;
  error: string | null;
}

export function transcribeAudio(wavPath: string, locale?: string, timeoutMs?: number): Promise<TranscriptionResult>;
