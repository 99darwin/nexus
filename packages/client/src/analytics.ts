/**
 * Cloudflare Web Analytics beacon — cookieless page views, no consent banner.
 *
 * The token is public by design (it ships in every page), so it comes from a
 * build-time env var rather than a secret store. Unset means no beacon: local
 * dev and preview builds don't pollute production numbers.
 */

const BEACON_SRC = "https://static.cloudflareinsights.com/beacon.min.js";

export function loadAnalytics(): void {
  const token = import.meta.env.VITE_CF_BEACON_TOKEN;
  if (!token) return;

  const script = document.createElement("script");
  script.defer = true;
  script.src = BEACON_SRC;
  // spa: true reports client-side route changes, not just the first load.
  script.dataset.cfBeacon = JSON.stringify({ token, spa: true });
  document.head.appendChild(script);
}
