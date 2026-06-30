// Best-effort VPN check before torrenting. Uses ip-api.com to read the current
// public IP's ISP/org and its hosting/proxy flags. Datacenter/proxy IPs are very
// likely a VPN; a residential ISP almost certainly means the VPN is *off*.

import { httpJson } from "../api/client.ts";

export interface VpnStatus {
  ip: string;
  isp: string;
  org: string;
  country: string;
  hosting: boolean;
  proxy: boolean;
  /** True when the IP looks like a datacenter/VPN/proxy rather than a home ISP. */
  likelyVpn: boolean;
}

export async function checkVpn(): Promise<VpnStatus | null> {
  try {
    const r = await httpJson<{
      query?: string;
      isp?: string;
      org?: string;
      country?: string;
      hosting?: boolean;
      proxy?: boolean;
    }>("http://ip-api.com/json/?fields=query,country,isp,org,hosting,proxy", { timeoutMs: 8000 });
    return {
      ip: r.query ?? "?",
      isp: r.isp ?? "?",
      org: r.org ?? "",
      country: r.country ?? "?",
      hosting: Boolean(r.hosting),
      proxy: Boolean(r.proxy),
      likelyVpn: Boolean(r.hosting || r.proxy),
    };
  } catch {
    return null;
  }
}
