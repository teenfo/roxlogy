import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    // 네이티브 APK("Roxlogy")와 홈 화면에서 구분되도록 PWA 는 "Web" 접미사 사용
    name: "Roxlogy Web",
    short_name: "Roxlogy Web",
    description: "The science of hybrid racing",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#141414",
    theme_color: "#141414",
    icons: [
      {
        src: "/roxlogy-appicon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/roxlogy-appicon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
