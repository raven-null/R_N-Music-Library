// src/services/coverRequestUrl.ts
// 读封面字节用的地址：桌面端直接请求原地址；网页端把不给自己 CORS 头的封面图床换成自家的代理，否则画布
// 读像素被浏览器拦掉、封面缓存也取不到字节。桌面端不受同源限制，不需要代理。

import { lyricProxyWebUrl } from './lyricProxy';

/**
 * 网页端不给自己 Access-Control-Allow-Origin 的封面图床。代理那边的白名单必须覆盖这里的每一个域名
 * （api-ts/lyric-proxy.ts 与 worker/lyric-proxy.ts 的 isAllowedLyricProxyHost）。
 */
const isRelayedCoverHost = (hostname: string): boolean => (
    hostname === 'y.gtimg.cn'
    || hostname === 'kugou.com' || hostname.endsWith('.kugou.com')
    || hostname === 'kgimg.com' || hostname.endsWith('.kgimg.com')
);

/**
 * 取封面字节、在画布上读封面像素时用这个地址，不要用封面原本的地址。
 * 认不出协议（blob:、data:、同源地址）或根本不是 URL 时原样返回。
 */
export const resolveCoverRequestUrl = (coverUrl: string): string => {
    if (typeof window !== 'undefined' && window.electron) return coverUrl;
    try {
        const url = new URL(coverUrl);
        if (url.protocol !== 'http:' && url.protocol !== 'https:') return coverUrl;
        if (isRelayedCoverHost(url.hostname)) return lyricProxyWebUrl(coverUrl);
    } catch {
        return coverUrl;
    }
    return coverUrl;
};
