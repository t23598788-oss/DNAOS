export function speakQueued(text: string, timeoutMs?: number): Promise<boolean>;
export function isSpeaking(): boolean;
export function cancelActiveSpeech(): boolean;
