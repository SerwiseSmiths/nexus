export interface CreateProviderTierBody {
  name: string;
  order?: number;
  isActive?: boolean;
  description?: string;
  color?: string;
}

export interface CreateProviderTierInput extends CreateProviderTierBody {}

export interface UpdateProviderTierBody {
  name?: string;
  order?: number;
  isActive?: boolean;
  description?: string;
  color?: string;
}

export interface UpdateProviderTierInput extends UpdateProviderTierBody {
  tierId: string;
}
