import type { Metadata } from "next";

export const BRAND_DESCRIPTION = "The science of hybrid racing";

/** Images are supplied by the nearest opengraph-image file convention. */
export function shareMetadata(title = "Roxlogy", description = BRAND_DESCRIPTION): Metadata {
  return {
    title,
    description,
    openGraph: { title, description, type: "website", siteName: "Roxlogy" },
    twitter: { card: "summary_large_image", title, description },
  };
}
