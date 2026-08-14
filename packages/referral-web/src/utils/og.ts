/**
 * Link-preview (Open Graph) metadata. WhatsApp and other social apps fetch OG
 * tags via a server-side crawl, so these must be rendered server-side — a pure
 * client SPA cannot produce working previews. Use this from Next.js
 * `generateMetadata`, an Express view, or any SSR layer.
 */
export interface ReferralMetaInput {
  referrerName?: string;
  rewardText?: string;
  imageUrl?: string;
  url: string;
  appName?: string;
}

export interface OpenGraphMeta {
  title: string;
  description: string;
  image?: string;
  url: string;
}

export function buildReferralMeta(input: ReferralMetaInput): OpenGraphMeta {
  const app = input.appName ?? 'the app';
  const title = input.referrerName
    ? `${input.referrerName} invited you to ${app}`
    : `You've been invited to ${app}`;
  const description = input.rewardText ?? 'Sign up to claim your bonus.';

  return {
    title,
    description,
    image: input.imageUrl,
    url: input.url,
  };
}
