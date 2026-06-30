export interface BrandingConfig {
  companyName: string;
  productName: string;
  logoUrl: string;
  darkLogoUrl: string;
  faviconUrl: string;
  footerText: string;
  supportEmail: string;
  themeColor: string;
  termsUrl: string;
  privacyUrl: string;
  seoTitleDefault: string;
  seoDescriptionDefault: string;
}

export const BRANDING_DEFAULTS: BrandingConfig = {
  companyName: 'CALDIM',
  productName: 'CAL-RIMS',
  logoUrl: '/calrims/logo.png',
  darkLogoUrl: '/calrims/logo-dark.png',
  faviconUrl: '/calrims/logo.png',
  footerText: 'Powered by CALDIM. Built for teams who care about who they hire.',
  supportEmail: 'support@caldimproducts.com',
  themeColor: '#2563eb', // Default blue color
  termsUrl: '/terms/',
  privacyUrl: '/privacy/',
  seoTitleDefault: 'CAL-RIMS - AI-Powered Recruitment Intelligence System',
  seoDescriptionDefault: 'CAL-RIMS is an AI-powered automated recruitment platform for seamless hiring, empowering teams to find, evaluate, and hire top-tier talent efficiently.',
};

export function getBranding(settings: any): BrandingConfig {
  const isInvalid = (val: any) => !val || val === '[UNREADABLE]' || val === '[DECRYPTION_ERROR]';

  // DB has highest priority (if valid), then env variables, then default constants
  const companyName = !isInvalid(settings?.company_name) ? settings.company_name : (process.env.NEXT_PUBLIC_COMPANY_NAME || BRANDING_DEFAULTS.companyName);
  const productName = !isInvalid(settings?.product_name) ? settings.product_name : (process.env.NEXT_PUBLIC_PRODUCT_NAME || BRANDING_DEFAULTS.productName);
  const logoUrl = !isInvalid(settings?.company_logo_url) ? settings.company_logo_url : (process.env.NEXT_PUBLIC_LOGO_URL || BRANDING_DEFAULTS.logoUrl);
  const darkLogoUrl = !isInvalid(settings?.dark_logo_url) ? settings.dark_logo_url : (process.env.NEXT_PUBLIC_DARK_LOGO_URL || BRANDING_DEFAULTS.darkLogoUrl);
  const faviconUrl = !isInvalid(settings?.favicon_url) ? settings.favicon_url : (process.env.NEXT_PUBLIC_FAVICON_URL || BRANDING_DEFAULTS.faviconUrl);
  const footerText = !isInvalid(settings?.footer_text) ? settings.footer_text : (process.env.NEXT_PUBLIC_FOOTER_TEXT || BRANDING_DEFAULTS.footerText);
  const supportEmail = !isInvalid(settings?.support_email) ? settings.support_email : (process.env.NEXT_PUBLIC_SUPPORT_EMAIL || BRANDING_DEFAULTS.supportEmail);
  const rawThemeColor = !isInvalid(settings?.theme_color) ? settings.theme_color : (process.env.NEXT_PUBLIC_THEME_COLOR || BRANDING_DEFAULTS.themeColor);
  const themeColor = /^#[0-9A-Fa-f]{3,8}$/.test(rawThemeColor) ? rawThemeColor : BRANDING_DEFAULTS.themeColor;
  
  let termsUrl = !isInvalid(settings?.terms_url) ? settings.terms_url : (process.env.NEXT_PUBLIC_TERMS_URL || BRANDING_DEFAULTS.termsUrl);
  let privacyUrl = !isInvalid(settings?.privacy_url) ? settings.privacy_url : (process.env.NEXT_PUBLIC_PRIVACY_URL || BRANDING_DEFAULTS.privacyUrl);
  
  if (termsUrl.startsWith('/calrims/')) {
    termsUrl = termsUrl.substring('/calrims'.length);
  }
  if (privacyUrl.startsWith('/calrims/')) {
    privacyUrl = privacyUrl.substring('/calrims'.length);
  }

  const seoTitleDefault = !isInvalid(settings?.seo_title_default) ? settings.seo_title_default : (process.env.NEXT_PUBLIC_SEO_TITLE_DEFAULT || BRANDING_DEFAULTS.seoTitleDefault);
  const seoDescriptionDefault = !isInvalid(settings?.seo_description_default) ? settings.seo_description_default : (process.env.NEXT_PUBLIC_SEO_DESCRIPTION_DEFAULT || BRANDING_DEFAULTS.seoDescriptionDefault);

  return {
    companyName,
    productName,
    logoUrl,
    darkLogoUrl,
    faviconUrl,
    footerText,
    supportEmail,
    themeColor,
    termsUrl,
    privacyUrl,
    seoTitleDefault,
    seoDescriptionDefault,
  };
}
