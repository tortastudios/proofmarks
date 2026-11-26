// proofmarks.dev's own visit counts, in the Proofmarks PostHog project beside the relay's install counts.
// Anonymous and cookieless: one random id per page view, kept in memory, no person profiles and no location lookup. It
// only sends from
// proofmarks.dev itself, never when the browser asks not to be tracked, and only when the build was given a key: the
// key and host come from PROOFMARKS_SITE_POSTHOG_KEY and PROOFMARKS_SITE_POSTHOG_HOST at build time.
declare const SITE_ANALYTICS: { key: string; host: string } | null;

const config = typeof SITE_ANALYTICS === 'undefined' ? null : SITE_ANALYTICS;
const hosts = ['proofmarks.dev', 'www.proofmarks.dev'];
const declined = () =>
  navigator.doNotTrack === '1' || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl;
const visit = crypto.randomUUID();

export function track(event: string, properties: Record<string, string | number | boolean> = {}) {
  if (!config || !hosts.includes(location.hostname) || declined()) return;
  const referrer = document.referrer;
  const body = JSON.stringify({
    api_key: config.key,
    event,
    distinct_id: visit,
    timestamp: new Date().toISOString(),
    properties: {
      $current_url: location.href,
      $host: location.host,
      $pathname: location.pathname,
      $referrer: referrer || '$direct',
      $referring_domain: referrer ? new URL(referrer).host : '$direct',
      $screen_width: screen.width,
      $viewport_width: innerWidth,
      $session_id: visit,
      $process_person_profile: false,
      $geoip_disable: true,
      $lib: 'proofmarks-site',
      ...properties,
    },
  });
  // A beacon survives the page closing, as when a click leaves for GitHub.
  navigator.sendBeacon(`${config.host}/i/v0/e/`, new Blob([body], { type: 'text/plain' }));
}
