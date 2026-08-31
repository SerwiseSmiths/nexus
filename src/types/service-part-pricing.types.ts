export interface UpsertPartPricingBody {
  servicePartId: string;
  providerTierId: string;
  salesPrice: number;
  expense?: number;
  labour?: number;
  maxDiscount?: number;
}

export interface UpsertPartPricingInput extends UpsertPartPricingBody {}

export interface RemovePartPricingInput {
  servicePartId: string;
  providerTierId: string;
}
