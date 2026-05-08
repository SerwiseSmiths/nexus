import axios from "axios";
import { config } from "@/configs";

export interface AddressPrediction {
  placeId: string;
  description: string;
  mainText: string;
  secondaryText: string;
  lat: number;
  lng: number;
  types: string[];
}

export const autocompleteAddress = async (input: string): Promise<AddressPrediction[]> => {
  const apiKey = config.olaMapsApiKey;

  const response = await axios.get("https://api.olamaps.io/places/v1/autocomplete", {
    params: { input, api_key: apiKey },
  });

  const predictions: any[] = response.data?.predictions ?? [];

  return predictions.map((p) => ({
    placeId: p.place_id ?? "",
    description: p.description ?? "",
    mainText: p.structured_formatting?.main_text ?? "",
    secondaryText: p.structured_formatting?.secondary_text ?? "",
    lat: p.geometry?.location?.lat ?? 0,
    lng: p.geometry?.location?.lng ?? 0,
    types: p.types ?? [],
  }));
};
