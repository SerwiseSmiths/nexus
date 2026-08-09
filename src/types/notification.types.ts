import { NotificationType } from '@prisma/client';

// ---------------------------------------------------------------------------
// Service input interfaces
// ---------------------------------------------------------------------------

export interface SendNotificationInput {
  userId:       string;
  title:        string;
  body:         string;
  type?:        NotificationType;
  complaintId?: string;
  metadata?:    Record<string, unknown>;
  // Send as a data-only FCM message (no top-level `notification` field) so
  // the client's background message handler always runs — even when the app
  // is backgrounded/killed — instead of the OS auto-rendering a tray
  // notification and skipping our JS. Required for client-driven UI like a
  // full-screen incoming-job intent. title/body are passed through in `data`
  // instead, so the client can render its own notification.
  dataOnly?:    boolean;
}

export interface RegisterDeviceTokenInput {
  userId:   string;
  token:    string;
  platform: 'ANDROID' | 'IOS';
}

// ---------------------------------------------------------------------------
// Request body interfaces
// ---------------------------------------------------------------------------

export interface RegisterDeviceTokenBody {
  token:    string;
  platform: string;
}

export interface SendNotificationBody {
  userId:    string;
  title:     string;
  body:      string;
  type?:     string;
  metadata?: Record<string, unknown>;
}
