'use client';

import { useEffect } from 'react';
import { useBranding } from '@/lib/branding-client';

export function DynamicBranding() {
  const { branding } = useBranding();

  useEffect(() => {
    if (!branding) return;

    // 1. Dynamic Favicon synchronization
    if (branding.faviconUrl) {
      let iconLink = document.querySelector("link[rel*='icon']") as HTMLLinkElement | null;
      if (!iconLink) {
        iconLink = document.createElement('link');
        iconLink.rel = 'icon';
        document.head.appendChild(iconLink);
      }
      if (iconLink.href !== branding.faviconUrl) {
        iconLink.href = branding.faviconUrl;
      }

      let shortcutLink = document.querySelector("link[rel='shortcut icon']") as HTMLLinkElement | null;
      if (shortcutLink && shortcutLink.href !== branding.faviconUrl) {
        shortcutLink.href = branding.faviconUrl;
      }
    }

    // 2. Dynamic Primary and Ring Theme Color synchronization
    if (branding.themeColor && /^#[0-9A-Fa-f]{3,8}$/.test(branding.themeColor)) {
      document.documentElement.style.setProperty('--primary', branding.themeColor);
      document.documentElement.style.setProperty('--ring', branding.themeColor);
    }
  }, [branding?.faviconUrl, branding?.themeColor]);

  return null;
}
