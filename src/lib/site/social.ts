/** Social networks the website's footer can link to (only those with a URL set in Super Admin → Settings). */
export const SOCIAL_NETWORKS = ["facebook", "instagram", "linkedin", "x", "youtube", "tiktok"] as const;
export type SocialNetwork = (typeof SOCIAL_NETWORKS)[number];

export const SOCIAL_LABELS: Record<SocialNetwork, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  x: "X",
  youtube: "YouTube",
  tiktok: "TikTok",
};

/** The configured links, in a fixed order — only https URLs. */
export function socialLinks(raw: unknown): { network: SocialNetwork; url: string }[] {
  const links = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return SOCIAL_NETWORKS.flatMap((network) => {
    const url = links[network];
    return typeof url === "string" && /^https:\/\/\S+$/.test(url) ? [{ network, url }] : [];
  });
}
