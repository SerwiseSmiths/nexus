import { config } from '@/configs';
import { logger } from '@/utils/logger';

export interface RemoteDeviceType {
  documentId: string;
  key: string;
  label: string;
  iconUrl: string | null;
}

export interface DeviceTypeRef {
  id: number;
  documentId: string;
  key: string;
  label: string;
}

export interface ServicePart {
  id: number;
  documentId: string;
  name: string;
  category: 'Basic Filters' | 'Additional Filters' | 'Electrical Components' | 'Other Items' | 'Pipe & Fittings' | 'Core';
  type: 'Parts' | 'Repair' | 'Service';
  face_value: number;
  provider_cut: number | null;
  expense: number | null;
  description: string | null;
  visibility: 'ACTIVE' | 'DRAFT' | 'DISCONTINUED';
  device_types: DeviceTypeRef[] | null;
}

const SCALAR_FIELDS = ['name', 'category', 'type', 'face_value', 'provider_cut', 'expense', 'description', 'visibility'];

export class StrapiService {
  private static get baseUrl(): string {
    return config.strapiUrl ?? 'http://localhost:1337';
  }

  private static get headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.strapiApiToken) h['Authorization'] = `Bearer ${config.strapiApiToken}`;
    return h;
  }

  static async ping(): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/_health`);
      logger.info('[Strapi] CMS warmup ping succeeded');
    } catch {
      logger.warn('[Strapi] CMS warmup ping failed — CMS may be slow on first request');
    }
  }

  private static async gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/graphql`, {
        method: 'POST',
        headers: this.headers,
        body: JSON.stringify({ query, variables }),
      });
    } catch (err) {
      logger.error('Strapi GraphQL connection failed:', err);
      throw new Error('CMS unavailable');
    }

    const json = (await res.json()) as { data?: T; errors?: { message: string }[] };

    if (json.errors?.length) {
      logger.error('Strapi GraphQL error:', json.errors[0].message);
      throw new Error(json.errors[0].message);
    }

    if (!json.data) throw new Error('Empty GraphQL response');
    return json.data;
  }

  static async fetchParts(deviceType?: string): Promise<ServicePart[]> {
    const qs = new URLSearchParams({
      'pagination[pageSize]': '200',
      'filters[visibility][$eq]': 'ACTIVE',
      'status': 'published',
      // populate device_types relation with key + label only
      'populate[device_types][fields][0]': 'key',
      'populate[device_types][fields][1]': 'label',
    });
    SCALAR_FIELDS.forEach((f, i) => qs.set(`fields[${i}]`, f));

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/service-parts?${qs}`, { headers: this.headers });
    } catch (err) {
      logger.error('Strapi connection failed:', err);
      throw new Error('Parts catalogue unavailable');
    }

    if (!res.ok) {
      logger.error(`Strapi fetchParts error: ${res.status}`);
      throw new Error('Failed to fetch parts from catalogue');
    }

    const json = (await res.json()) as { data: Record<string, unknown>[] };
    let parts = json.data.map((item) => item as unknown as ServicePart);

    if (deviceType) {
      parts = parts.filter(
        (p) => !p.device_types?.length || p.device_types.some((dt) => dt.key === deviceType),
      );
    }

    return parts;
  }

  static async fetchDeviceTypes(): Promise<RemoteDeviceType[]> {
    const query = `
      query GetDeviceTypes {
        deviceTypes(pagination: { pageSize: 50 }) {
          documentId
          key
          label
          icon { url }
        }
      }
    `;

    const data = await this.gql<{ deviceTypes: Array<{ documentId: string; key: string; label: string; icon: { url: string } | null }> }>(query);

    return (data.deviceTypes ?? []).map((item) => {
      const rawUrl = item.icon?.url;
      const iconUrl = rawUrl
        ? rawUrl.startsWith('http') ? rawUrl : `${this.baseUrl}${rawUrl}`
        : null;
      return { documentId: item.documentId, key: item.key, label: item.label, iconUrl };
    });
  }

  static async fetchSubscriptionPlans(): Promise<import('@/types/subscription.types').CmsSubscriptionPlan[]> {
    const query = `
      query GetSubscriptionPlans {
        subscriptionPlans(
          filters: { is_active: { eq: true } }
          pagination: { pageSize: 50 }
          status: PUBLISHED
        ) {
          documentId
          key
          name
          badge
          badge_color
          annual_price
          monthly_price
          tagline
          max_services
          duration_months
          sort_order
          is_active
          visit_services {
            visit_number
            label
            service_parts { documentId name }
          }
          features {
            title
            description
            qty
          }
        }
      }
    `;

    const data = await this.gql<{ subscriptionPlans: import('@/types/subscription.types').CmsSubscriptionPlan[] }>(query);
    return data.subscriptionPlans ?? [];
  }

  static async fetchSubscriptionAddons(deviceTypeKey?: string): Promise<import('@/types/subscription.types').CmsSubscriptionAddon[]> {
    const query = `
      query GetSubscriptionAddons {
        subscriptionAddons(
          filters: { is_active: { eq: true } }
          pagination: { pageSize: 100 }
          status: PUBLISHED
        ) {
          documentId
          key
          name
          price
          description
          is_active
          sort_order
          image { url }
          device_types { documentId key label }
        }
      }
    `;

    const data = await this.gql<{
      subscriptionAddons: Array<
        Omit<import('@/types/subscription.types').CmsSubscriptionAddon, 'imageUrl'> & { image?: { url: string } }
      >;
    }>(query);

    let addons = (data.subscriptionAddons ?? []).map((item) => {
      const rawUrl = item.image?.url;
      const imageUrl = rawUrl
        ? rawUrl.startsWith('http') ? rawUrl : `${this.baseUrl}${rawUrl}`
        : null;
      const { image: _image, ...rest } = item;
      return { ...rest, imageUrl } as import('@/types/subscription.types').CmsSubscriptionAddon;
    });

    if (deviceTypeKey) {
      addons = addons.filter(
        (a) => !a.device_types?.length || a.device_types.some((dt) => dt.key === deviceTypeKey),
      );
    }

    return addons;
  }

  static async fetchPartByDocumentId(documentId: string): Promise<ServicePart | null> {
    const qs = new URLSearchParams({
      status: 'published',
      'populate[device_types][fields][0]': 'key',
      'populate[device_types][fields][1]': 'label',
    });
    SCALAR_FIELDS.forEach((f, i) => qs.set(`fields[${i}]`, f));

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/service-parts/${documentId}?${qs}`, { headers: this.headers });
    } catch (err) {
      logger.error('Strapi connection failed:', err);
      return null;
    }

    if (!res.ok) return null;

    const json = (await res.json()) as { data: Record<string, unknown> };
    return json.data as unknown as ServicePart;
  }
}
