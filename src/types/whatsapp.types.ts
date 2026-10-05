export interface StartPairingBody {
  phone: string;
}

export interface WhatsAppStatus {
  /** A number is linked and fully saved — nudges will send from it. */
  connected: boolean;
  /** Linked number, digits only with country code (e.g. "919876543210"). */
  number:    string | null;
  /** Set while a link started from watchtower is waiting for the code to be entered. */
  pairing:   { phone: string; startedAt: string } | null;
  /** Why the most recent link attempt failed, if it did. */
  lastError: string | null;
}

export interface StartPairingResult {
  /** 8-character code to enter on the phone. */
  code: string;
}
