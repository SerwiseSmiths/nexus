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
  // Structured fields — only reverse geocode / place details return these (from Ola's address_components).
  area?: string;
  city?: string;
  state?: string;
  country?: string;
  pinCode?: string;
}

interface OlaAddressComponent {
  long_name?: string;
  short_name?: string;
  types?: string[];
}

const pickComponent = (components: OlaAddressComponent[], ...types: string[]): string | undefined => {
  for (const type of types) {
    const match = components.find((c) => c.types?.includes(type));
    if (match?.long_name) return match.long_name;
  }
  return undefined;
};

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

  return toStructuredPrediction(results[0], lat, lng);
};

/** Autocomplete coordinates are rounded to 4 decimals (~11 m); place details
 *  returns the place's full-precision point plus address_components. */
export const placeDetails = async (placeId: string): Promise<AddressPrediction | null> => {
  const apiKey = config.olaMapsApiKey;

  const response = await axios.get("https://api.olamaps.io/places/v1/details", {
    params: { place_id: placeId, api_key: apiKey },
  });

  const r = response.data?.result;
  if (!r?.geometry?.location) return null;

  return toStructuredPrediction(r, r.geometry.location.lat, r.geometry.location.lng);
};

const toStructuredPrediction = (r: any, lat: number, lng: number): AddressPrediction => {
  const formatted: string = r.formatted_address ?? "";
  const name: string = r.name ?? r.address_components?.[0]?.long_name ?? "";
  const secondary =
    name && formatted.startsWith(name)
      ? formatted.slice(name.length).replace(/^[,\s]+/, "")
      : formatted;
  const components: OlaAddressComponent[] = r.address_components ?? [];

  return {
    placeId: r.place_id ?? `${lat},${lng}`,
    description: formatted,
    mainText: name || formatted,
    secondaryText: secondary,
    lat: r.geometry?.location?.lat ?? lat,
    lng: r.geometry?.location?.lng ?? lng,
    types: r.types ?? [],
    area: pickComponent(components, "sublocality", "sublocality_level_1", "neighborhood"),
    city: pickComponent(components, "locality", "administrative_area_level_3", "administrative_area_level_2"),
    state: pickComponent(components, "administrative_area_level_1"),
    country: pickComponent(components, "country"),
    pinCode: pickComponent(components, "postal_code"),
  };
};
