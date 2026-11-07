import { Platform } from 'react-native';

let initStarted = false;

export function initPostHog(): void {
  if (
    initStarted ||
    Platform.OS !== 'web' ||
    typeof window === 'undefined' ||
    window === window.parent
  ) {
    return;
  }

  const params = new URLSearchParams(window.location.search);
  const key = params.get('__ph_key');
  const host = params.get('__ph_host');
  if (!key || !host) return;

  initStarted = true;

  void import('posthog-js')
    .then(({ posthog }) => {
      posthog.init(key, {
        api_host: host,
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        // Screens show sales, cash and fiscal data: never record sessions.
        disable_session_recording: true,
        mask_all_text: true,
        mask_all_element_attributes: true,
      });
    })
    .catch(() => {
      initStarted = false;
    });
}
