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

export const reverseGeocodeAddress = async (lat: number, lng: number): Promise<AddressPrediction | null> => {
  const apiKey = config.olaMapsApiKey;

  const response = await axios.get("https://api.olamaps.io/places/v1/reverse-geocode", {
    params: { latlng: `${lat},${lng}`, api_key: apiKey },
  });

  const results: any[] = response.data?.results ?? [];
  if (!results.length) return null;

  const r = results[0];
  const formatted: string = r.formatted_address ?? "";
  const name: string = r.name ?? r.address_components?.[0]?.long_name ?? "";
  const secondary =
    name && formatted.startsWith(name)
      ? formatted.slice(name.length).replace(/^[,\s]+/, "")
      : formatted;

  return {
    placeId: r.place_id ?? `${lat},${lng}`,
    description: formatted,
    mainText: name || formatted,
    secondaryText: secondary,
    lat: r.geometry?.location?.lat ?? lat,
    lng: r.geometry?.location?.lng ?? lng,
    types: r.types ?? [],
  };
};
