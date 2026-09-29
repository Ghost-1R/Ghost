import { AUTHORITY_ORDER, type Authority } from "./types";

export function authorityRank(authority: Authority): number {
  return AUTHORITY_ORDER.indexOf(authority);
}

export function higherAuthority(left: Authority, right: Authority): Authority {
  return authorityRank(left) <= authorityRank(right) ? left : right;
}
