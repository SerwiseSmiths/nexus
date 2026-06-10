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
